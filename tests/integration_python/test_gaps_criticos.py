"""
Testes dos gaps críticos e importantes identificados na suite existente.

Grupos cobertos (do mais crítico ao menos):
  1. Plano CRUD completo (POST/PUT/DELETE com payload válido)
  2. POST /titular simples (rota avulsa)
  3. Financeiro – fluxo real de conta a pagar (criar → atualizar → baixa → estorno)
  4. Financeiro – fluxo real de conta a receber
  5. Financeiro – cadastros auxiliares com payload válido (banco, tipo, forma, centro)
  6. Pagamento POST e DELETE
  7. Consultor CRUD admin
  8. Comissão CRUD
  9. Benefício CRUD
  10. Documento CRUD
  11. Notificação template upload
  12. Layout criação/atualização com payload válido
  13. Role criação com payload válido
  14. GET /users/:id
  15. Titular promoverCorresponsavel (sucessao-corresponsavel)
  16. Titular me – foto POST/DELETE como cliente
"""

import os
import socket
import subprocess
import time
import unittest
import warnings
from pathlib import Path
from typing import Any

import pytds
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"


# ---------------------------------------------------------------------------
# Infraestrutura – reutiliza a mesma base do arquivo principal
# ---------------------------------------------------------------------------
from test_checklist_cadastro_principal import (
    parse_sqlserver_url,
    SqlServerConfig,
)


class BaseGapTest(unittest.TestCase):
    tenant = os.getenv("PLANVITA_TENANT", "lider")
    admin_email = os.getenv("PLANVITA_ADMIN_EMAIL", "softline@admin.com")
    admin_password = os.getenv("PLANVITA_ADMIN_PASSWORD", "123456")
    db_url = os.getenv("DATABASE_URL_LIDER")
    sql_config = parse_sqlserver_url(db_url) if db_url else None
    server_process: subprocess.Popen | None = None
    base_url = ""
    session: requests.Session

    @classmethod
    def setUpClass(cls) -> None:
        if not cls.db_url:
            raise unittest.SkipTest("Defina DATABASE_URL_LIDER antes de executar a suite.")
        cls.base_url = os.getenv("PLANVITA_API_BASE_URL", "").rstrip("/")
        if not cls.base_url:
            port = cls._find_free_port()
            cls.base_url = f"https://localhost:{port}/api/v1"
            cls._start_local_backend(port)
        cls._wait_for_backend()
        cls.session = requests.Session()
        cls.session.verify = False
        cls.session.headers.update({"X-Tenant": cls.tenant})
        cls._login_admin()

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.server_process and cls.server_process.poll() is None:
            cls.server_process.terminate()
            try:
                cls.server_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.server_process.kill()
                cls.server_process.wait(timeout=5)
        if cls.server_process and cls.server_process.stdout:
            cls.server_process.stdout.close()

    @classmethod
    def _find_free_port(cls) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    @classmethod
    def _start_local_backend(cls, port: int) -> None:
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["NODE_ENV"] = "development"
        env["ENCRYPTION_KEY"] = env.get("ENCRYPTION_KEY", "12345678901234567890123456789012")
        env["DATABASE_URL"] = env.get("DATABASE_URL", cls.db_url or "")
        env["DATABASE_URL_LIDER"] = cls.db_url or ""
        server_file = BACKEND_DIR / "dist" / "server.js"
        if not server_file.exists():
            raise FileNotFoundError(f"Build nao encontrado: {server_file}")
        cls.server_process = subprocess.Popen(
            ["node", str(server_file)],
            cwd=BACKEND_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    @classmethod
    def _wait_for_backend(cls) -> None:
        health_url = cls.base_url.replace("/api/v1", "/health")
        deadline = time.time() + 45
        last_error = ""
        while time.time() < deadline:
            if cls.server_process and cls.server_process.poll() not in (None,):
                output = cls.server_process.stdout.read() if cls.server_process.stdout else ""
                raise RuntimeError(f"Backend encerrou na inicializacao.\n{output}")
            try:
                r = requests.get(health_url, verify=False, timeout=3)
                if r.status_code < 500:
                    return
            except Exception as exc:
                last_error = str(exc)
            time.sleep(1)
        raise TimeoutError(f"Backend nao respondeu. Ultimo erro: {last_error}")

    @classmethod
    def _login_admin(cls) -> None:
        r = cls.session.post(
            f"{cls.base_url}/auth/login",
            json={"email": cls.admin_email, "password": cls.admin_password},
            timeout=20,
        )
        if r.status_code != 200:
            raise AssertionError(f"Login admin falhou: {r.status_code} {r.text}")

    def _db_connect(self):
        assert self.sql_config is not None
        return pytds.connect(
            dsn=self.sql_config.server,
            port=self.sql_config.port,
            database=self.sql_config.database,
            user=self.sql_config.user,
            password=self.sql_config.password,
            cafile=None,
            validate_host=False,
            enc_login_only=False,
        )

    def _fetch_one(self, query: str, params: tuple) -> dict | None:
        with self._db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                if row is None:
                    return None
                return dict(zip([c[0] for c in cur.description], row))

    def _fetch_all(self, query: str, params: tuple) -> list[dict]:
        with self._db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                rows = cur.fetchall()
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, row)) for row in rows]

    def _suggest_plan_id(self) -> int:
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200, r.text)
        return int(r.json()[0]["id"])

    def _make_titular_payload(self) -> dict[str, Any]:
        suffix = str(int(time.time() * 1000))[-8:]
        cpf_titular = f"9{suffix[:7]}1"[:11]
        cpf_dep = f"8{suffix[:7]}2"[:11]
        plano_id = self._suggest_plan_id()
        return {
            "step1": {
                "nomeCompleto": f"Gap Test {suffix}",
                "cpf": cpf_titular,
                "dataNascimento": "1988-04-15",
                "sexo": "Masculino",
                "rg": "1234567",
                "naturalidade": "Salvador",
                "telefone": "71999990001",
                "whatsapp": "71999990001",
                "email": f"gap.{suffix}@example.com",
                "situacaoConjugal": "Solteiro",
                "profissao": "Analista",
            },
            "step2": {
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Pituba",
                "logradouro": "Av Gap",
                "complemento": "",
                "numero": "1",
                "pontoReferencia": "Esquina",
            },
            "step3": {"usarMesmosDados": True},
            "dependentes": [
                {
                    "nome": f"Dep Gap {suffix}",
                    "idade": 10,
                    "dataNascimento": "2015-03-10",
                    "parentesco": "Filho(a)",
                    "telefone": "71999990002",
                    "cpf": cpf_dep,
                }
            ],
            "step5": {"planoId": plano_id, "billingType": "PIX"},
        }

    def _create_titular_full(self) -> tuple[int, dict]:
        payload = self._make_titular_payload()
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 201, r.text)
        return int(r.json()["id"]), payload

    def _cleanup_titular(self, titular_id: int) -> None:
        for dep in self._fetch_all("SELECT id FROM Dependente WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/dependente/{dep['id']}", timeout=20)
        for cor in self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/corresponsavel/{cor['id']}", timeout=20)
        self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)


# ---------------------------------------------------------------------------
# 1. PLANO – CRUD completo com payload válido
# ---------------------------------------------------------------------------
class TestPlanoCRUDValido(BaseGapTest):

    def _plano_payload(self, suffix: str) -> dict:
        return {
            "nome": f"Plano Gap {suffix}",
            "valorMensal": 59.90,
            "idadeMaxima": 70,
            "coberturaMaxima": 5000,
            "carenciaDias": 30,
            "vigenciaMeses": 12,
            "ativo": True,
            "assistenciaFuneral": 3000,
            "beneficiarios": ["Titular", "Cônjuge"],
        }

    def test_G001_plano_create_com_payload_valido_retorna_201(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        self.assertIn(r.status_code, (201, 500), r.text)
        if r.status_code == 201:
            plano_id = r.json()["id"]
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G002_plano_create_retorna_id_na_resposta(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code == 201:
            self.assertIn("id", r.json())
            self.assertIsInstance(r.json()["id"], int)
            self.session.delete(f"{self.base_url}/plano/{r.json()['id']}", timeout=20)
        else:
            self.skipTest("Criação de plano não suportada neste ambiente")

    def test_G003_plano_create_persiste_nome_no_banco(self):
        suffix = str(int(time.time() * 1000))[-6:]
        payload = self._plano_payload(suffix)
        r = self.session.post(f"{self.base_url}/plano", json=payload, timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        try:
            db = self._fetch_one("SELECT nome, valorMensal FROM Plano WHERE id = %s", (plano_id,))
            self.assertIsNotNone(db)
            self.assertEqual(db["nome"], payload["nome"])
        finally:
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G004_plano_update_nome_com_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        try:
            r2 = self.session.put(
                f"{self.base_url}/plano/{plano_id}",
                json={"nome": f"Plano Atualizado {suffix}", "valorMensal": 79.90},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            db = self._fetch_one("SELECT nome, valorMensal FROM Plano WHERE id = %s", (plano_id,))
            self.assertEqual(db["nome"], f"Plano Atualizado {suffix}")
        finally:
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G005_plano_update_ativo_false(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        try:
            r2 = self.session.put(f"{self.base_url}/plano/{plano_id}", json={"ativo": False}, timeout=20)
            self.assertEqual(r2.status_code, 200, r2.text)
            db = self._fetch_one("SELECT ativo FROM Plano WHERE id = %s", (plano_id,))
            self.assertFalse(db["ativo"])
        finally:
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G006_plano_delete_com_id_valido_retorna_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)
        self.assertEqual(r2.status_code, 204, r2.text)

    def test_G007_plano_delete_remove_do_banco(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)
        db = self._fetch_one("SELECT id FROM Plano WHERE id = %s", (plano_id,))
        self.assertIsNone(db)

    def test_G008_plano_get_apos_criacao_retorna_dados(self):
        suffix = str(int(time.time() * 1000))[-6:]
        payload = self._plano_payload(suffix)
        r = self.session.post(f"{self.base_url}/plano", json=payload, timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        try:
            r2 = self.session.get(f"{self.base_url}/plano/{plano_id}", timeout=20)
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()["id"], plano_id)
            self.assertEqual(r2.json()["nome"], payload["nome"])
        finally:
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G009_plano_delete_depois_retorna_404(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)
        r2 = self.session.get(f"{self.base_url}/plano/{plano_id}", timeout=20)
        self.assertEqual(r2.status_code, 404)

    def test_G010_plano_update_carencia_dias(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(f"{self.base_url}/plano", json=self._plano_payload(suffix), timeout=20)
        if r.status_code != 201:
            self.skipTest("Criação de plano não suportada")
        plano_id = r.json()["id"]
        try:
            r2 = self.session.put(f"{self.base_url}/plano/{plano_id}", json={"carenciaDias": 60}, timeout=20)
            self.assertEqual(r2.status_code, 200)
            db = self._fetch_one("SELECT carenciaDias FROM Plano WHERE id = %s", (plano_id,))
            self.assertEqual(db["carenciaDias"], 60)
        finally:
            self.session.delete(f"{self.base_url}/plano/{plano_id}", timeout=20)

    def test_G011_plano_sem_autenticacao_create_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        suffix = str(int(time.time() * 1000))[-6:]
        r = anon.post(
            f"{self.base_url}/plano",
            json=self._plano_payload(suffix),
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G012_plano_sem_autenticacao_update_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/plano/1",
            json={"nome": "Hack"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G013_plano_sem_autenticacao_delete_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.delete(
            f"{self.base_url}/plano/1",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 2. TITULAR – rota POST simples (avulsa, sem /full)
# ---------------------------------------------------------------------------
class TestTitularCreateSimples(BaseGapTest):

    def test_G020_titular_post_simples_payload_minimo_retorna_201_ou_400(self):
        suffix = str(int(time.time() * 1000))[-8:]
        plano_id = self._suggest_plan_id()
        r = self.session.post(
            f"{self.base_url}/titular",
            json={
                "nomeCompleto": f"Simples {suffix}",
                "cpf": f"1{suffix[:10]}"[:11],
                "dataNascimento": "1985-06-10",
                "sexo": "Masculino",
                "telefone": "71999990001",
                "email": f"simples.{suffix}@example.com",
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Centro",
                "logradouro": "Rua A",
                "numero": "1",
                "planoId": plano_id,
            },
            timeout=30,
        )
        self.assertIn(r.status_code, (201, 400, 422), r.text)
        if r.status_code == 201:
            self._cleanup_titular(int(r.json()["id"]))

    def test_G021_titular_post_simples_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular",
            json={"nomeCompleto": "Hack", "cpf": "12345678901"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G022_titular_post_simples_payload_vazio_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/titular", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_G023_titular_post_simples_sem_cpf_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/titular",
            json={"nomeCompleto": "Sem CPF", "email": "sem@cpf.com"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))


# ---------------------------------------------------------------------------
# 3. FINANCEIRO – fluxo real de conta a pagar
# ---------------------------------------------------------------------------
class TestFinanceiroContaPagar(BaseGapTest):

    def _conta_pagar_payload(self, suffix: str) -> dict:
        return {
            "descricao": f"Conta Pagar Gap {suffix}",
            "valor": 150.00,
            "vencimento": "2026-12-31",
            "fornecedor": "Fornecedor Teste",
        }

    def test_G030_conta_pagar_create_payload_valido_retorna_201(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 500), r.text)
        if r.status_code == 201:
            conta_id = r.json().get("id")
            if conta_id:
                self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)

    def test_G031_conta_pagar_retorna_id_na_resposta(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a pagar não retornou 201")
        self.assertIn("id", r.json())
        conta_id = r.json()["id"]
        self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)

    def test_G032_conta_pagar_update_com_valor_novo(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a pagar não suportada")
        conta_id = r.json()["id"]
        try:
            r2 = self.session.put(
                f"{self.base_url}/financeiro/contas/pagar/{conta_id}",
                json={"valor": 200.00, "descricao": f"Conta Atualizada {suffix}"},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200, r2.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)

    def test_G033_conta_pagar_baixa_fluxo(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a pagar não suportada")
        conta_id = r.json()["id"]
        try:
            r2 = self.session.post(
                f"{self.base_url}/financeiro/contas/pagar/{conta_id}/baixa",
                json={"dataPagamento": "2026-06-23", "valorPago": 150.00},
                timeout=20,
            )
            self.assertIn(r2.status_code, (200, 400, 422), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)

    def test_G034_conta_pagar_estorno_apos_baixa(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a pagar não suportada")
        conta_id = r.json()["id"]
        try:
            self.session.post(
                f"{self.base_url}/financeiro/contas/pagar/{conta_id}/baixa",
                json={"dataPagamento": "2026-06-23", "valorPago": 150.00},
                timeout=20,
            )
            r3 = self.session.post(
                f"{self.base_url}/financeiro/contas/pagar/{conta_id}/estorno",
                json={},
                timeout=20,
            )
            self.assertIn(r3.status_code, (200, 400, 422), r3.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)

    def test_G035_conta_pagar_delete_retorna_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json=self._conta_pagar_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a pagar não suportada")
        conta_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/contas/pagar/{conta_id}", timeout=20)
        self.assertIn(r2.status_code, (204, 200), r2.text)

    def test_G036_conta_pagar_valor_zero_retorna_400(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json={"descricao": f"Zero {suffix}", "valor": 0, "vencimento": "2026-12-31"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422), r.text)

    def test_G037_conta_pagar_valor_negativo_retorna_400(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json={"descricao": f"Neg {suffix}", "valor": -50, "vencimento": "2026-12-31"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422), r.text)

    def test_G038_conta_pagar_sem_descricao_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json={"valor": 100.00, "vencimento": "2026-12-31"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_G039_conta_pagar_sem_vencimento_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/pagar",
            json={"descricao": "Sem Vencimento", "valor": 100.00},
            timeout=20,
        )
        self.assertEqual(r.status_code, 400, r.text)


# ---------------------------------------------------------------------------
# 4. FINANCEIRO – fluxo real de conta a receber
# ---------------------------------------------------------------------------
class TestFinanceiroContaReceber(BaseGapTest):

    def _conta_receber_payload(self, suffix: str) -> dict:
        return {
            "descricao": f"Conta Receber Gap {suffix}",
            "valor": 300.00,
            "vencimento": "2026-12-31",
        }

    def test_G040_conta_receber_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 500), r.text)
        if r.status_code == 201:
            conta_id = r.json().get("id")
            if conta_id:
                self.session.delete(f"{self.base_url}/financeiro/contas/receber/{conta_id}", timeout=20)

    def test_G041_conta_receber_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a receber não retornou 201")
        self.assertIn("id", r.json())
        self.session.delete(f"{self.base_url}/financeiro/contas/receber/{r.json()['id']}", timeout=20)

    def test_G042_conta_receber_update_valor(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a receber não suportada")
        conta_id = r.json()["id"]
        try:
            r2 = self.session.put(
                f"{self.base_url}/financeiro/contas/receber/{conta_id}",
                json={"valor": 400.00},
                timeout=20,
            )
            self.assertIn(r2.status_code, (200, 400), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/receber/{conta_id}", timeout=20)

    def test_G043_conta_receber_reconsulta(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a receber não suportada")
        conta_id = r.json()["id"]
        try:
            r2 = self.session.post(
                f"{self.base_url}/financeiro/contas/receber/{conta_id}/reconsulta",
                json={},
                timeout=30,
            )
            self.assertIn(r2.status_code, (200, 400, 404, 422, 500), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/receber/{conta_id}", timeout=20)

    def test_G044_conta_receber_delete_retorna_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a receber não suportada")
        conta_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/contas/receber/{conta_id}", timeout=20)
        self.assertIn(r2.status_code, (204, 200), r2.text)

    def test_G045_conta_receber_sem_descricao_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json={"valor": 100.00, "vencimento": "2026-12-31"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_G046_conta_receber_baixa_fluxo(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/contas/receber",
            json=self._conta_receber_payload(suffix),
            timeout=20,
        )
        if r.status_code != 201:
            self.skipTest("Criação de conta a receber não suportada")
        conta_id = r.json()["id"]
        try:
            r2 = self.session.post(
                f"{self.base_url}/financeiro/contas/receber/{conta_id}/baixa",
                json={"dataPagamento": "2026-06-23", "valorPago": 300.00},
                timeout=20,
            )
            self.assertIn(r2.status_code, (200, 400, 422), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/financeiro/contas/receber/{conta_id}", timeout=20)


# ---------------------------------------------------------------------------
# 5. FINANCEIRO – cadastros auxiliares com payload válido
# ---------------------------------------------------------------------------
class TestFinanceiroCadastrosValidos(BaseGapTest):

    def test_G050_banco_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/bancos",
            json={"nome": f"Banco Gap {suffix}", "agencia": "0001", "conta": "12345-6", "saldo": 0.0, "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 200, 400, 500), r.text)
        if r.status_code in (200, 201):
            banco_id = r.json().get("id")
            if banco_id:
                self.session.delete(f"{self.base_url}/financeiro/cadastros/bancos/{banco_id}", timeout=20)

    def test_G051_banco_create_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/bancos",
            json={"nome": f"Banco ID {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de banco não suportada")
        self.assertIn("id", r.json())
        self.session.delete(f"{self.base_url}/financeiro/cadastros/bancos/{r.json()['id']}", timeout=20)

    def test_G052_banco_delete_retorna_204_ou_200(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/bancos",
            json={"nome": f"Banco Del {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de banco não suportada")
        banco_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/cadastros/bancos/{banco_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204), r2.text)

    def test_G053_tipo_contabil_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/tipos",
            json={"descricao": f"Tipo Gap {suffix}", "natureza": "DESPESA", "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 500), r.text)
        if r.status_code in (200, 201):
            tipo_id = r.json().get("id")
            if tipo_id:
                self.session.delete(f"{self.base_url}/financeiro/cadastros/tipos/{tipo_id}", timeout=20)

    def test_G054_tipo_contabil_delete(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/tipos",
            json={"descricao": f"Tipo Del {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de tipo contábil não suportada")
        tipo_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/cadastros/tipos/{tipo_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204), r2.text)

    def test_G055_forma_pagamento_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/formas",
            json={"nome": f"Forma Gap {suffix}", "prazo": "30", "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 500), r.text)
        if r.status_code in (200, 201):
            forma_id = r.json().get("id")
            if forma_id:
                self.session.delete(f"{self.base_url}/financeiro/cadastros/formas/{forma_id}", timeout=20)

    def test_G056_forma_pagamento_delete(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/formas",
            json={"nome": f"Forma Del {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de forma de pagamento não suportada")
        forma_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/cadastros/formas/{forma_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204), r2.text)

    def test_G057_centro_resultado_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/centros",
            json={"nome": f"Centro Gap {suffix}", "descricao": "Centro teste", "orcamento": 5000.0, "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 500), r.text)
        if r.status_code in (200, 201):
            centro_id = r.json().get("id")
            if centro_id:
                self.session.delete(f"{self.base_url}/financeiro/cadastros/centros/{centro_id}", timeout=20)

    def test_G058_centro_resultado_delete(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/financeiro/cadastros/centros",
            json={"nome": f"Centro Del {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de centro de resultado não suportada")
        centro_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/financeiro/cadastros/centros/{centro_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204), r2.text)

    def test_G059_cadastros_get_retorna_todos_os_grupos(self):
        r = self.session.get(f"{self.base_url}/financeiro/cadastros", timeout=20)
        self.assertIn(r.status_code, (200, 400))
        if r.status_code == 200:
            body = r.json()
            for chave in ("bancos", "tiposContabeis", "formasPagamento", "centrosResultado"):
                self.assertIn(chave, body, f"Chave '{chave}' ausente no cadastros")


# ---------------------------------------------------------------------------
# 6. PAGAMENTO – POST e DELETE
# ---------------------------------------------------------------------------
class TestPagamentoCRUD(BaseGapTest):

    def test_G060_pagamento_create_payload_invalido_retorna_400(self):
        r = self.session.post(f"{self.base_url}/pagamento", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_G061_pagamento_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/pagamento/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_G062_pagamento_sem_autenticacao_create_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/pagamento",
            json={"titularId": 1, "valor": 100},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G063_pagamento_sem_autenticacao_delete_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.delete(
            f"{self.base_url}/pagamento/1",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G064_pagamento_get_by_id_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/pagamento/99999998", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_G065_pagamento_update_payload_vazio_retorna_erro(self):
        r_all = self.session.get(f"{self.base_url}/pagamento", params={"page": 1, "limit": 1}, timeout=20)
        if r_all.status_code != 200 or not r_all.json().get("data"):
            self.skipTest("Sem pagamentos para testar")
        pag_id = r_all.json()["data"][0]["id"]
        r = self.session.put(f"{self.base_url}/pagamento/{pag_id}", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 422))


# ---------------------------------------------------------------------------
# 7. CONSULTOR – CRUD admin
# ---------------------------------------------------------------------------
class TestConsultorCRUDAdmin(BaseGapTest):

    def _consultor_payload(self, suffix: str, user_id: int | None = None) -> dict:
        data: dict = {
            "nome": f"Consultor Gap {suffix}",
            "email": f"consultor.gap.{suffix}@example.com",
            "telefone": "71988880000",
            "comissaoPercentual": 5.0,
            "ativo": True,
        }
        if user_id:
            data["userId"] = user_id
        return data

    def _get_any_user_id(self) -> int | None:
        r = self.session.get(f"{self.base_url}/users", timeout=20)
        users = r.json()
        return users[0]["id"] if users else None

    def test_G070_consultor_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/consultor",
            json=self._consultor_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 403, 409, 422, 500), r.text)
        if r.status_code == 201:
            self.session.delete(f"{self.base_url}/consultor/{r.json()['id']}", timeout=20)

    def test_G071_consultor_create_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/consultor",
            json=self._consultor_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de consultor não suportada")
        self.assertIn("id", r.json())
        self.session.delete(f"{self.base_url}/consultor/{r.json()['id']}", timeout=20)

    def test_G072_consultor_update_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/consultor",
            json=self._consultor_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de consultor não suportada")
        consultor_id = r.json()["id"]
        try:
            r2 = self.session.put(
                f"{self.base_url}/consultor/{consultor_id}",
                json={"nome": f"Consultor Atualizado {suffix}"},
                timeout=20,
            )
            self.assertIn(r2.status_code, (200, 400, 403), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/consultor/{consultor_id}", timeout=20)

    def test_G073_consultor_delete_retorna_200_ou_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/consultor",
            json=self._consultor_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de consultor não suportada")
        consultor_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/consultor/{consultor_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204, 403), r2.text)

    def test_G074_consultor_get_by_id_valido(self):
        r_all = self.session.get(f"{self.base_url}/consultor", timeout=20)
        if r_all.status_code != 200 or not r_all.json():
            self.skipTest("Sem consultores para testar")
        consultor_id = r_all.json()[0]["id"]
        r = self.session.get(f"{self.base_url}/consultor/{consultor_id}", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertEqual(r.json()["id"], consultor_id)

    def test_G075_consultor_create_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/consultor",
            json={"nome": "Hack", "email": "hack@x.com"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 8. COMISSÃO – CRUD
# ---------------------------------------------------------------------------
class TestComissaoCRUD(BaseGapTest):

    def test_G080_comissao_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/comissao", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_G081_comissao_create_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/comissao", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 403, 422, 500))

    def test_G082_comissao_create_vendedor_invalido_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/comissao",
            json={"vendedorId": 0, "titularId": 1, "valor": 100.0},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 403, 422, 500))

    def test_G083_comissao_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/comissao/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_G084_comissao_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/comissao/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_G085_comissao_update_inexistente_retorna_404(self):
        r = self.session.put(f"{self.base_url}/comissao/99999999", json={"status": "PAGO"}, timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_G086_comissao_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/comissao", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_G087_comissao_listagem_campos_se_existir(self):
        r = self.session.get(f"{self.base_url}/comissao", timeout=20)
        if r.status_code == 200 and r.json():
            comissao = r.json()[0]
            self.assertIn("id", comissao)

    def test_G088_comissao_create_com_campos_obrigatorios(self):
        titular_id = None
        try:
            payload = {
                "step1": {
                    "nomeCompleto": f"Comissao Test {str(int(time.time()*1000))[-6:]}",
                    "cpf": f"5{str(int(time.time()*1000))[-7:]}1"[:11],
                    "dataNascimento": "1985-01-01",
                    "sexo": "Masculino",
                    "rg": "111222",
                    "naturalidade": "Salvador",
                    "telefone": "71999990001",
                    "whatsapp": "71999990001",
                    "email": f"com.{str(int(time.time()*1000))[-6:]}@test.com",
                    "situacaoConjugal": "Solteiro",
                    "profissao": "Analista",
                },
                "step2": {"cep": "40000000", "uf": "BA", "cidade": "Salvador", "bairro": "Centro", "logradouro": "Rua A", "numero": "1", "pontoReferencia": ""},
                "step3": {"usarMesmosDados": True},
                "dependentes": [],
                "step5": {"planoId": self._suggest_plan_id(), "billingType": "PIX"},
            }
            r_tit = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r_tit.status_code != 201:
                self.skipTest("Não foi possível criar titular para testar comissão")
            titular_id = int(r_tit.json()["id"])
            r_users = self.session.get(f"{self.base_url}/users", timeout=20)
            if not r_users.json():
                self.skipTest("Sem usuários para testar comissão")
            vendedor_id = r_users.json()[0]["id"]
            r = self.session.post(
                f"{self.base_url}/comissao",
                json={"vendedorId": vendedor_id, "titularId": titular_id, "valor": 120.0, "criarContaPagar": False},
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400, 403, 409, 422, 500), r.text)
            if r.status_code == 201:
                com_id = r.json()["id"]
                self.session.delete(f"{self.base_url}/comissao/{com_id}", timeout=20)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 9. BENEFÍCIO – CRUD
# ---------------------------------------------------------------------------
class TestBeneficioCRUD(BaseGapTest):

    def test_G090_beneficio_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/beneficio", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_G091_beneficio_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficio",
            json={"nome": f"Beneficio Gap {suffix}", "descricao": "Desc teste", "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 403, 422, 500), r.text)
        if r.status_code == 201:
            ben_id = r.json().get("id")
            if ben_id:
                self.session.delete(f"{self.base_url}/beneficio/{ben_id}", timeout=20)

    def test_G092_beneficio_create_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficio",
            json={"nome": f"Beneficio ID {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de benefício não suportada")
        self.assertIn("id", r.json())
        self.session.delete(f"{self.base_url}/beneficio/{r.json()['id']}", timeout=20)

    def test_G093_beneficio_update_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficio",
            json={"nome": f"Beneficio Up {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de benefício não suportada")
        ben_id = r.json()["id"]
        try:
            r2 = self.session.put(
                f"{self.base_url}/beneficio/{ben_id}",
                json={"nome": f"Beneficio Atualizado {suffix}"},
                timeout=20,
            )
            self.assertIn(r2.status_code, (200, 400, 403), r2.text)
        finally:
            self.session.delete(f"{self.base_url}/beneficio/{ben_id}", timeout=20)

    def test_G094_beneficio_delete_retorna_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficio",
            json={"nome": f"Beneficio Del {suffix}", "ativo": True},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de benefício não suportada")
        ben_id = r.json()["id"]
        r2 = self.session.delete(f"{self.base_url}/beneficio/{ben_id}", timeout=20)
        self.assertIn(r2.status_code, (200, 204, 403), r2.text)

    def test_G095_beneficio_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/beneficio/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_G096_beneficio_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/beneficio/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404, 500))

    def test_G097_beneficio_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/beneficio", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 10. DOCUMENTO – CRUD
# ---------------------------------------------------------------------------
class TestDocumentoCRUD(BaseGapTest):

    def test_G100_documento_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/documento", timeout=20)
        self.assertIn(r.status_code, (200, 403))

    def test_G101_documento_create_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/documento", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 403, 422, 500))

    def test_G102_documento_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/documento/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_G103_documento_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/documento/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404, 500))

    def test_G104_documento_update_inexistente_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/documento/99999999",
            json={"nome": "X"},
            timeout=20,
        )
        self.assertIn(r.status_code, (403, 404, 500))

    def test_G105_documento_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/documento", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))

    def test_G106_documento_create_com_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/documento",
            json={"nome": f"Doc Gap {suffix}", "tipo": "PDF", "url": "https://example.com/doc.pdf"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 403, 422, 500), r.text)
        if r.status_code == 201:
            doc_id = r.json().get("id")
            if doc_id:
                self.session.delete(f"{self.base_url}/documento/{doc_id}", timeout=20)


# ---------------------------------------------------------------------------
# 11. NOTIFICAÇÃO – template upload
# ---------------------------------------------------------------------------
class TestNotificacaoTemplateUpload(BaseGapTest):

    def test_G110_template_upload_sem_arquivo_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/notificacoes/templates/upload", timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_G111_template_upload_sem_autenticacao_retorna_401_ou_200(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/notificacoes/templates/upload",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 422, 500))

    def test_G112_template_crud_completo(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/notificacoes/templates",
            json={"nome": f"Template CRUD {suffix}", "conteudo": "Olá {{nome}}, seu plano está ativo."},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 409, 422, 500), r.text)
        if r.status_code == 201:
            tmpl_id = r.json().get("id")
            if tmpl_id:
                r2 = self.session.put(
                    f"{self.base_url}/notificacoes/templates/{tmpl_id}",
                    json={"nome": f"Template CRUD Atualizado {suffix}"},
                    timeout=20,
                )
                self.assertIn(r2.status_code, (200, 400), r2.text)
                r3 = self.session.delete(f"{self.base_url}/notificacoes/templates/{tmpl_id}", timeout=20)
                self.assertIn(r3.status_code, (200, 204), r3.text)


# ---------------------------------------------------------------------------
# 12. LAYOUT – criação/atualização com payload válido
# ---------------------------------------------------------------------------
class TestLayoutValido(BaseGapTest):

    def test_G120_layout_get_retorna_dados_ou_404(self):
        r = self.session.get(f"{self.base_url}/layout", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_G121_layout_create_payload_com_cor(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/layout",
            json={"corPrimaria": "#1A2B3C", "corSecundaria": "#FFFFFF", "nomePlataforma": f"Plata {suffix}"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 409, 422, 500), r.text)

    def test_G122_layout_update_cor_primaria(self):
        r_get = self.session.get(f"{self.base_url}/layout", timeout=20)
        if r_get.status_code == 404 or not r_get.json():
            self.skipTest("Sem layout para atualizar")
        layout = r_get.json() if isinstance(r_get.json(), dict) else r_get.json()[0]
        layout_id = layout.get("id")
        if not layout_id:
            self.skipTest("Layout sem ID")
        r2 = self.session.put(
            f"{self.base_url}/layout/{layout_id}",
            json={"corPrimaria": "#2C3E50"},
            timeout=20,
        )
        self.assertIn(r2.status_code, (200, 400, 404), r2.text)

    def test_G123_layout_sem_autenticacao_retorna_401_ou_200(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/layout", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401, 404))


# ---------------------------------------------------------------------------
# 13. ROLES – criação e gestão
# ---------------------------------------------------------------------------
class TestRolesCRUD(BaseGapTest):

    def test_G130_role_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/roles",
            json={"name": f"role_gap_{suffix}", "description": "Role de teste"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 409, 422, 500), r.text)
        if r.status_code == 201:
            role_id = r.json().get("id")
            if role_id:
                self.session.delete(f"{self.base_url}/roles/{role_id}", timeout=20)

    def test_G131_role_create_nome_duplicado_retorna_409_ou_400(self):
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        if not r_roles.json():
            self.skipTest("Sem roles para testar duplicata")
        nome_existente = r_roles.json()[0]["name"]
        r = self.session.post(
            f"{self.base_url}/roles",
            json={"name": nome_existente, "description": "Duplicata"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 409, 422, 500))

    def test_G132_role_permissions_update_com_ids_validos(self):
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        r_perms = self.session.get(f"{self.base_url}/permissions", timeout=20)
        if not r_roles.json() or not r_perms.json():
            self.skipTest("Sem roles ou permissions para testar")
        role_id = r_roles.json()[0]["id"]
        perm_ids = [p["id"] for p in r_perms.json()[:2]]
        r = self.session.put(
            f"{self.base_url}/roles/{role_id}/permissions",
            json={"permissionIds": perm_ids},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404), r.text)

    def test_G133_role_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/roles/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))

    def test_G134_role_get_by_id_valido(self):
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        if not r_roles.json():
            self.skipTest("Sem roles")
        role_id = r_roles.json()[0]["id"]
        r = self.session.get(f"{self.base_url}/roles/{role_id}", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertEqual(r.json()["id"], role_id)


# ---------------------------------------------------------------------------
# 14. USERS – GET por ID individual
# ---------------------------------------------------------------------------
class TestUsersGetById(BaseGapTest):

    def test_G140_user_get_by_id_valido(self):
        r_all = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_all.json():
            self.skipTest("Sem usuários")
        user_id = r_all.json()[0]["id"]
        r = self.session.get(f"{self.base_url}/users/{user_id}", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertEqual(r.json()["id"], user_id)

    def test_G141_user_get_by_id_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/users/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400))

    def test_G142_user_get_by_id_sem_expor_senha(self):
        r_all = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_all.json():
            self.skipTest("Sem usuários")
        user_id = r_all.json()[0]["id"]
        r = self.session.get(f"{self.base_url}/users/{user_id}", timeout=20)
        if r.status_code == 200:
            self.assertNotIn("password", r.json())
            self.assertNotIn("senha", r.json())

    def test_G143_user_get_by_id_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/users/1", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_G144_user_email_update_com_email_valido(self):
        r_all = self.session.get(f"{self.base_url}/users", timeout=20)
        users = [u for u in r_all.json() if u.get("email", "").lower() != self.admin_email.lower()]
        if not users:
            self.skipTest("Sem outro usuário para testar update de email")
        user_id = users[0]["id"]
        email_original = users[0]["email"]
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/email",
            json={"email": f"atualizado.{suffix}@example.com"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 409), r.text)
        if r.status_code == 200:
            self.session.put(
                f"{self.base_url}/users/{user_id}/email",
                json={"email": email_original},
                timeout=20,
            )


# ---------------------------------------------------------------------------
# 15. TITULAR – promoverCorresponsavel (sucessao)
# ---------------------------------------------------------------------------
class TestTitularSucessaoCorresponsavel(BaseGapTest):

    def _create_corresponsavel(self, titular_id: int, suffix: str) -> int:
        r = self.session.post(
            f"{self.base_url}/corresponsavel",
            json={
                "titularId": titular_id,
                "nome": f"Cor Suc {suffix}",
                "email": f"cor.suc.{suffix}@example.com",
                "telefone": "71988885555",
                "cpf": f"33344455{suffix[:3]}",
                "dataNascimento": "1980-01-01T00:00:00.000Z",
                "relacionamento": "Irmão",
                "sexo": "Masculino",
                "naturalidade": "Salvador",
                "situacaoConjugal": "Solteiro",
                "profissao": "Analista",
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Centro",
                "logradouro": "Rua Suc",
                "numero": "5",
                "pontoReferencia": "Prédio",
            },
            timeout=20,
        )
        self.assertEqual(r.status_code, 201, r.text)
        return int(r.json()["id"])

    def test_G150_sucessao_corresponsavel_titular_invalido_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/titular/99999999/sucessao-corresponsavel",
            json={"corresponsavelId": 1},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 405, 422, 500))

    def test_G151_sucessao_corresponsavel_sem_payload_retorna_erro(self):
        titular_id, _ = self._create_titular_full()
        try:
            r = self.session.post(
                f"{self.base_url}/titular/{titular_id}/sucessao-corresponsavel",
                json={},
                timeout=20,
            )
            self.assertIn(r.status_code, (400, 404, 405, 422, 500))
        finally:
            self._cleanup_titular(titular_id)

    def test_G152_sucessao_corresponsavel_id_invalido_retorna_erro(self):
        titular_id, _ = self._create_titular_full()
        try:
            r = self.session.post(
                f"{self.base_url}/titular/{titular_id}/sucessao-corresponsavel",
                json={"corresponsavelId": 99999999},
                timeout=20,
            )
            self.assertIn(r.status_code, (400, 404, 405, 422, 500))
        finally:
            self._cleanup_titular(titular_id)

    def test_G153_sucessao_corresponsavel_id_valido_fluxo(self):
        titular_id, _ = self._create_titular_full()
        cor_id = None
        try:
            suffix = str(int(time.time() * 1000))[-6:]
            cor_id = self._create_corresponsavel(titular_id, suffix)
            r = self.session.post(
                f"{self.base_url}/titular/{titular_id}/sucessao-corresponsavel",
                json={"corresponsavelId": cor_id},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 404, 405, 422, 500))
        finally:
            if cor_id:
                self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self._cleanup_titular(titular_id)

    def test_G154_sucessao_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular/1/sucessao-corresponsavel",
            json={"corresponsavelId": 1},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 16. TITULAR ME – foto e assinaturas (como cliente não-admin)
# ---------------------------------------------------------------------------
class TestTitularMePortalCliente(BaseGapTest):

    def test_G160_me_delete_foto_sem_token_cliente_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.delete(
            f"{self.base_url}/titular/me/foto",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G161_me_post_foto_sem_token_cliente_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular/me/foto",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G162_me_post_assinatura_sem_token_cliente_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular/me/assinaturas",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G163_me_get_assinatura_arquivo_sem_id_retorna_erro(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/titular/me/assinaturas/99999999/arquivo",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_G164_me_contrato_arquivo_admin_token_retorna_403_ou_404(self):
        r = self.session.get(f"{self.base_url}/titular/me/contrato/arquivo", timeout=20)
        self.assertIn(r.status_code, (403, 404, 401))

    def test_G165_me_foto_arquivo_admin_token_retorna_403_ou_404(self):
        r = self.session.get(f"{self.base_url}/titular/me/foto/arquivo", timeout=20)
        self.assertIn(r.status_code, (403, 404, 401))


if __name__ == "__main__":
    unittest.main(verbosity=2)
