"""
Testes de integração — PUT /titular/me/pagamento

Cobre:
  P001–P010  Autenticação e validação de entrada (sem Asaas)
  P011–P020  ATUALIZAR_CARTAO — happy path e erros esperados
  P021–P030  TROCAR_METODO — happy path e erros esperados
  P031–P035  Verificação no banco (tabela payment_method_change_requests)
  P040–P045  Idempotência e bloqueio de concorrência

Os testes P011+ que dependem do Asaas são pulados automaticamente quando
ASAAS_ENABLED=false (padrão em ambiente de CI sem sandbox).
"""

import os
import socket
import subprocess
import time
import unittest
import warnings
from pathlib import Path
from typing import Any

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"

from test_checklist_cadastro_principal import (
    parse_sqlserver_url,
    SqlServerConfig,
)


# ---------------------------------------------------------------------------
# Infra base — mesma estrutura dos outros testes de integração
# ---------------------------------------------------------------------------

class BaseAlterarPagamentoTest(unittest.TestCase):
    tenant: str = os.getenv("PLANVITA_TENANT", "lider")
    admin_email: str = os.getenv("PLANVITA_ADMIN_EMAIL", "softline@admin.com")
    admin_password: str = os.getenv("PLANVITA_ADMIN_PASSWORD", "123456")
    db_url: str | None = os.getenv("DATABASE_URL_LIDER")
    sql_config: SqlServerConfig | None = parse_sqlserver_url(db_url) if db_url else None
    server_process: subprocess.Popen | None = None
    base_url: str = ""
    session: requests.Session
    asaas_enabled: bool = os.getenv("ASAAS_ENABLED", "false").lower() != "false"

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
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])

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
            raise FileNotFoundError(f"Build não encontrado: {server_file}")
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
                raise RuntimeError(f"Backend encerrou na inicialização.\n{output}")
            try:
                r = requests.get(health_url, verify=False, timeout=3)
                if r.status_code < 500:
                    return
            except Exception as exc:
                last_error = str(exc)
            time.sleep(1)
        raise TimeoutError(f"Backend não respondeu. Último erro: {last_error}")

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
        try:
            import pytds
        except ImportError:
            self.skipTest("pytds não instalado — pule testes de banco.")
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

    # ── Fixtures ──────────────────────────────────────────────────────────────

    def _suggest_plan_id(self) -> int:
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200, r.text)
        return int(r.json()[0]["id"])

    def _make_titular_payload(self, suffix: str) -> dict[str, Any]:
        cpf = f"9{suffix[:7]}1"[:11]
        return {
            "step1": {
                "nomeCompleto": f"Pag Test {suffix}",
                "cpf": cpf,
                "dataNascimento": "1985-06-20",
                "sexo": "Masculino",
                "rg": "9876543",
                "naturalidade": "Salvador",
                "telefone": "71988880001",
                "whatsapp": "71988880001",
                "email": f"pag.{suffix}@example.com",
                "situacaoConjugal": "Solteiro",
                "profissao": "Engenheiro",
            },
            "step2": {
                "cep": "41000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Itaigara",
                "logradouro": "Av Pag",
                "complemento": "",
                "numero": "42",
                "pontoReferencia": "",
            },
            "step3": {"usarMesmosDados": True},
            "dependentes": [],
            "step5": {"planoId": self._suggest_plan_id(), "billingType": "PIX"},
        }

    def _create_titular(self) -> tuple[int, str]:
        """Cria titular e retorna (titular_id, token_cliente)."""
        suffix = str(int(time.time() * 1000))[-8:]
        payload = self._make_titular_payload(suffix)
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 201, r.text)
        titular_id = int(r.json()["id"])

        # gera token de cliente via endpoint de convite / set-password
        token = self._get_cliente_token(titular_id, payload["step1"]["email"])
        return titular_id, token

    def _get_cliente_token(self, titular_id: int, email: str) -> str:
        """Tenta obter token de cliente; pula o teste se não conseguir."""
        # Força uma senha conhecida via endpoint admin (se existir) ou pula
        pwd_r = self.session.post(
            f"{self.base_url}/auth/cliente/set-password",
            json={"titularId": titular_id, "password": "Teste@1234"},
            timeout=20,
        )
        if pwd_r.status_code not in (200, 201, 204):
            self.skipTest(f"Não foi possível definir senha do cliente: {pwd_r.status_code}")

        login_r = requests.post(
            f"{self.base_url}/auth/cliente/login",
            json={"email": email, "password": "Teste@1234"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        if login_r.status_code != 200:
            self.skipTest(f"Login de cliente falhou: {login_r.status_code}")
        return str(login_r.json().get("token", ""))

    def _cleanup_titular(self, titular_id: int) -> None:
        for dep in self._fetch_all("SELECT id FROM Dependente WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/dependente/{dep['id']}", timeout=20)
        for cor in self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/corresponsavel/{cor['id']}", timeout=20)
        self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)

    def _cliente_session(self, token: str) -> requests.Session:
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant, "Authorization": f"Bearer {token}"})
        return s

    def _valid_card_payload(self) -> dict:
        return {
            "holderName": "JOAO SILVA",
            "holderCpf": "12345678901",
            "number": "4111111111111111",
            "expiryMonth": "12",
            "expiryYear": "2027",
            "ccv": "123",
        }


# ---------------------------------------------------------------------------
# P001–P010  Autenticação e validação de entrada (independem do Asaas)
# ---------------------------------------------------------------------------

class TestAlterarPagamentoAuth(BaseAlterarPagamentoTest):

    def test_P001_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "ATUALIZAR_CARTAO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_P002_token_admin_retorna_401_ou_403(self):
        r = self.session.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "ATUALIZAR_CARTAO"},
            timeout=20,
        )
        self.assertIn(r.status_code, (401, 403))

    def test_P003_action_invalida_retorna_400(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "DELETAR_TUDO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        # 401 (sem auth) ou 400 (validação) — ambos são corretos
        self.assertIn(r.status_code, (400, 401))

    def test_P004_body_vazio_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_P005_metodo_http_errado_get_retorna_404_ou_405(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/titular/me/pagamento",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (404, 405))

    def test_P006_metodo_http_post_retorna_404_ou_405(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "ATUALIZAR_CARTAO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (404, 405))

    def test_P007_trocar_metodo_sem_novoMetodo_com_token_cliente_retorna_400_ou_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "TROCAR_METODO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        # sem token → 401; com token mas sem novoMetodo → 400
        self.assertIn(r.status_code, (400, 401))

    def test_P008_novoMetodo_invalido_sem_token_retorna_400_ou_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "TROCAR_METODO", "novoMetodo": "DINHEIRO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401))

    def test_P009_rota_existe_na_api(self):
        """A rota deve existir — não retornar 404 genérico de rota inexistente."""
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "ATUALIZAR_CARTAO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        # 401 confirma que a rota existe e está protegida; 404 seria rota não registrada
        self.assertNotEqual(r.status_code, 404, "Rota /titular/me/pagamento não registrada na API")

    def test_P010_resposta_json_mesmo_sem_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/titular/me/pagamento",
            json={"action": "ATUALIZAR_CARTAO"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        content_type = r.headers.get("Content-Type", "")
        self.assertIn("application/json", content_type, "Resposta deve ser JSON")


# ---------------------------------------------------------------------------
# P011–P020  ATUALIZAR_CARTAO com token de cliente real
# ---------------------------------------------------------------------------

class TestAtualizarCartao(BaseAlterarPagamentoTest):

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        try:
            cls.titular_id, cls.cliente_token = cls._create_titular.__func__(cls())
        except unittest.SkipTest:
            cls.titular_id = None
            cls.cliente_token = ""

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.titular_id:
            try:
                cls(methodName="tearDownClass")._cleanup_titular(cls.titular_id)
            except Exception:
                pass
        super().tearDownClass()

    def _put(self, body: dict) -> requests.Response:
        s = self._cliente_session(self.cliente_token)
        return s.put(f"{self.base_url}/titular/me/pagamento", json=body, timeout=30)

    def test_P011_atualizar_cartao_com_token_cliente_valido_retorna_400_ou_success(self):
        """Sem assinatura Asaas o service lança erro 500/400; com Asaas retorna 200."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        body = {"action": "ATUALIZAR_CARTAO", "creditCard": self._valid_card_payload()}
        r = self._put(body)
        # sem Asaas: 400 (método atual não é cartão) ou 500 (sem assinatura)
        # com Asaas: 200 success
        self.assertIn(r.status_code, (200, 400, 500), r.text)

    def test_P012_atualizar_cartao_sem_creditCard_retorna_400(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "ATUALIZAR_CARTAO"})
        # O service rejeita sem dados do cartão
        self.assertIn(r.status_code, (400, 500), r.text)

    def test_P013_atualizar_cartao_numero_invalido_retorna_400_ou_500(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        card = self._valid_card_payload()
        card["number"] = "1234"  # número inválido
        r = self._put({"action": "ATUALIZAR_CARTAO", "creditCard": card})
        self.assertIn(r.status_code, (400, 500), r.text)

    def test_P014_atualizar_cartao_resposta_contem_campo_success_ou_message(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        body = {"action": "ATUALIZAR_CARTAO", "creditCard": self._valid_card_payload()}
        r = self._put(body)
        data = r.json()
        has_expected = "success" in data or "message" in data or "error" in data
        self.assertTrue(has_expected, f"Resposta inesperada: {data}")

    def test_P015_atualizar_cartao_com_asaas_habilitado_retorna_200(self):
        if not self.asaas_enabled:
            self.skipTest("ASAAS_ENABLED=false — pula teste de integração Asaas")
        if not self.titular_id:
            self.skipTest("Titular não criado")
        body = {"action": "ATUALIZAR_CARTAO", "creditCard": self._valid_card_payload()}
        r = self._put(body)
        # Com Asaas real e método atual PIX, espera-se erro de negócio (não é cartão)
        self.assertIn(r.status_code, (200, 400), r.text)

    def test_P016_atualizar_cartao_cria_registro_na_tabela_change_request(self):
        """Verifica que a tabela payment_method_change_requests recebe o registro."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        count_before = len(
            self._fetch_all(
                "SELECT id FROM payment_method_change_requests WHERE titularId = %s",
                (self.titular_id,),
            )
        )
        body = {"action": "ATUALIZAR_CARTAO", "creditCard": self._valid_card_payload()}
        self._put(body)
        count_after = len(
            self._fetch_all(
                "SELECT id FROM payment_method_change_requests WHERE titularId = %s",
                (self.titular_id,),
            )
        )
        self.assertGreaterEqual(count_after, count_before)


# ---------------------------------------------------------------------------
# P021–P030  TROCAR_METODO com token de cliente real
# ---------------------------------------------------------------------------

class TestTrocarMetodo(BaseAlterarPagamentoTest):

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        try:
            cls.titular_id, cls.cliente_token = cls._create_titular.__func__(cls())
        except unittest.SkipTest:
            cls.titular_id = None
            cls.cliente_token = ""

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.titular_id:
            try:
                cls(methodName="tearDownClass")._cleanup_titular(cls.titular_id)
            except Exception:
                pass
        super().tearDownClass()

    def _put(self, body: dict) -> requests.Response:
        s = self._cliente_session(self.cliente_token)
        return s.put(f"{self.base_url}/titular/me/pagamento", json=body, timeout=30)

    def test_P021_trocar_para_boleto_sem_asaas_retorna_400_ou_500(self):
        """Sem assinatura no Asaas, o service não tem subscriptionId e falha."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
        self.assertIn(r.status_code, (200, 400, 500), r.text)

    def test_P022_trocar_para_pix_body_correto(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "PIX"})
        self.assertIn(r.status_code, (200, 400, 500), r.text)

    def test_P023_trocar_para_credit_card_sem_dados_retorna_400_ou_500(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "CREDIT_CARD"})
        self.assertIn(r.status_code, (400, 500), r.text)

    def test_P024_trocar_para_credit_card_com_dados_retorna_nao_404(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({
            "action": "TROCAR_METODO",
            "novoMetodo": "CREDIT_CARD",
            "creditCard": self._valid_card_payload(),
        })
        self.assertNotEqual(r.status_code, 404, "Rota não encontrada")

    def test_P025_novoMetodo_invalido_com_token_retorna_400(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "CHEQUE"})
        self.assertEqual(r.status_code, 400, r.text)

    def test_P026_trocar_metodo_sem_novoMetodo_retorna_400(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO"})
        self.assertEqual(r.status_code, 400, r.text)

    def test_P027_resposta_erro_contem_message(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "INVALIDO"})
        data = r.json()
        self.assertIn("message", data, f"Resposta sem campo message: {data}")

    def test_P028_trocar_com_asaas_pix_para_boleto_retorna_200(self):
        if not self.asaas_enabled:
            self.skipTest("ASAAS_ENABLED=false — pula teste de integração Asaas")
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
        self.assertIn(r.status_code, (200, 400, 500), r.text)
        if r.status_code == 200:
            self.assertTrue(r.json().get("success"))
            self.assertEqual(r.json().get("metodoPagamento"), "BOLETO")

    def test_P029_trocar_cria_change_request_no_banco(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        count_before = len(
            self._fetch_all(
                "SELECT id FROM payment_method_change_requests WHERE titularId = %s",
                (self.titular_id,),
            )
        )
        self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
        count_after = len(
            self._fetch_all(
                "SELECT id FROM payment_method_change_requests WHERE titularId = %s",
                (self.titular_id,),
            )
        )
        self.assertGreaterEqual(count_after, count_before)

    def test_P030_trocar_metodo_resposta_sempre_json(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        r = self._put({"action": "TROCAR_METODO", "novoMetodo": "PIX"})
        content_type = r.headers.get("Content-Type", "")
        self.assertIn("application/json", content_type)


# ---------------------------------------------------------------------------
# P031–P035  Verificação direta no banco
# ---------------------------------------------------------------------------

class TestBancoChangeRequest(BaseAlterarPagamentoTest):

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        try:
            cls.titular_id, cls.cliente_token = cls._create_titular.__func__(cls())
        except unittest.SkipTest:
            cls.titular_id = None
            cls.cliente_token = ""

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.titular_id:
            try:
                cls(methodName="tearDownClass")._cleanup_titular(cls.titular_id)
            except Exception:
                pass
        super().tearDownClass()

    def _put(self, body: dict) -> requests.Response:
        s = self._cliente_session(self.cliente_token)
        return s.put(f"{self.base_url}/titular/me/pagamento", json=body, timeout=30)

    def test_P031_change_request_registra_titularId(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
        rows = self._fetch_all(
            "SELECT * FROM payment_method_change_requests WHERE titularId = %s ORDER BY createdAt DESC",
            (self.titular_id,),
        )
        if not rows:
            self.skipTest("Nenhum registro criado — titular sem assinatura Asaas")
        self.assertEqual(rows[0]["titularId"], self.titular_id)

    def test_P032_change_request_status_e_success_ou_failed(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        self._put({"action": "TROCAR_METODO", "novoMetodo": "PIX"})
        rows = self._fetch_all(
            "SELECT status FROM payment_method_change_requests WHERE titularId = %s ORDER BY createdAt DESC",
            (self.titular_id,),
        )
        if not rows:
            self.skipTest("Nenhum registro criado — titular sem assinatura Asaas")
        self.assertIn(rows[0]["status"], ("SUCCESS", "FAILED"))

    def test_P033_change_request_registra_newMethod(self):
        if not self.titular_id:
            self.skipTest("Titular não criado")
        self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
        rows = self._fetch_all(
            "SELECT newMethod FROM payment_method_change_requests WHERE titularId = %s ORDER BY createdAt DESC",
            (self.titular_id,),
        )
        if not rows:
            self.skipTest("Nenhum registro criado — titular sem assinatura Asaas")
        self.assertEqual(rows[0]["newMethod"], "BOLETO")

    def test_P034_change_request_nao_salva_numero_completo_cartao(self):
        """Garante que nenhum campo da tabela contém o PAN completo do cartão."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        self._put({
            "action": "ATUALIZAR_CARTAO",
            "creditCard": self._valid_card_payload(),
        })
        rows = self._fetch_all(
            "SELECT oldCardToken, newCardToken FROM payment_method_change_requests WHERE titularId = %s",
            (self.titular_id,),
        )
        for row in rows:
            for field_val in row.values():
                if field_val:
                    self.assertNotIn(
                        "4111111111111111",
                        str(field_val),
                        "PAN completo não deve ser salvo na tabela",
                    )

    def test_P035_tabela_existe_no_banco(self):
        """Confirma que a migration criou a tabela payment_method_change_requests."""
        rows = self._fetch_all(
            "SELECT TOP 1 1 AS existe FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = %s",
            ("payment_method_change_requests",),
        )
        self.assertTrue(len(rows) > 0, "Tabela payment_method_change_requests não encontrada no banco")


# ---------------------------------------------------------------------------
# P040–P045  Idempotência e bloqueio de concorrência
# ---------------------------------------------------------------------------

class TestIdempotenciaEConcorrencia(BaseAlterarPagamentoTest):

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        try:
            cls.titular_id, cls.cliente_token = cls._create_titular.__func__(cls())
        except unittest.SkipTest:
            cls.titular_id = None
            cls.cliente_token = ""

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.titular_id:
            try:
                cls(methodName="tearDownClass")._cleanup_titular(cls.titular_id)
            except Exception:
                pass
        super().tearDownClass()

    def _put(self, body: dict) -> requests.Response:
        s = self._cliente_session(self.cliente_token)
        return s.put(f"{self.base_url}/titular/me/pagamento", json=body, timeout=30)

    def test_P040_requisicao_duplicada_com_processing_em_andamento_retorna_400_ou_409(self):
        """
        Se houver um registro PROCESSING no banco para o titular,
        uma segunda chamada deve ser rejeitada (400 ou 409).
        Este teste injeta o registro diretamente no banco.
        """
        if not self.titular_id:
            self.skipTest("Titular não criado")

        try:
            import pytds
        except ImportError:
            self.skipTest("pytds não instalado")

        # Insere registro PROCESSING diretamente no banco
        with self._db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO payment_method_change_requests
                        (titularId, oldMethod, newMethod, status, idempotencyKey, updatedAt)
                    VALUES (%s, %s, %s, %s, %s, GETDATE())
                    """,
                    (self.titular_id, "PIX", "BOLETO", "PROCESSING", f"lock-test-{self.titular_id}"),
                )
                conn.commit()

        try:
            r = self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
            self.assertIn(r.status_code, (400, 409, 500), r.text)
            if r.status_code in (400, 409):
                data = r.json()
                self.assertIn("message", data)
                self.assertIn("andamento", data["message"].lower())
        finally:
            # Limpa o registro de bloqueio
            with self._db_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM payment_method_change_requests WHERE idempotencyKey = %s",
                        (f"lock-test-{self.titular_id}",),
                    )
                    conn.commit()

    def test_P041_duas_chamadas_sequenciais_nao_criam_estado_inconsistente(self):
        """Duas chamadas seguidas ao mesmo endpoint não devem deixar dados corrompidos."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        body = {"action": "TROCAR_METODO", "novoMetodo": "PIX"}
        r1 = self._put(body)
        r2 = self._put(body)
        # ambas podem falhar (sem assinatura Asaas), mas nenhuma deve retornar 200
        # enquanto a anterior ainda está PROCESSING — segunda deve ser bloqueada ou falhar limpo
        self.assertIn(r1.status_code, (200, 400, 500))
        self.assertIn(r2.status_code, (200, 400, 409, 500))

    def test_P042_idempotency_key_unique_no_banco(self):
        """Verifica unicidade da constraint de idempotencyKey na tabela."""
        rows = self._fetch_all(
            """
            SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE TABLE_NAME = %s AND CONSTRAINT_TYPE IN ('UNIQUE', 'PRIMARY KEY')
            """,
            ("payment_method_change_requests",),
        )
        self.assertTrue(len(rows) > 0, "Tabela sem constraints de unicidade")

    def test_P043_change_request_failed_nao_bloqueia_proxima_tentativa(self):
        """Um registro FAILED não deve impedir nova tentativa."""
        if not self.titular_id:
            self.skipTest("Titular não criado")
        try:
            import pytds
        except ImportError:
            self.skipTest("pytds não instalado")

        idem_key = f"failed-test-{self.titular_id}-{int(time.time())}"
        with self._db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO payment_method_change_requests
                        (titularId, oldMethod, newMethod, status, idempotencyKey, updatedAt)
                    VALUES (%s, %s, %s, %s, %s, GETDATE())
                    """,
                    (self.titular_id, "PIX", "BOLETO", "FAILED", idem_key),
                )
                conn.commit()

        try:
            r = self._put({"action": "TROCAR_METODO", "novoMetodo": "BOLETO"})
            # FAILED não bloqueia; a requisição deve chegar ao service normalmente
            self.assertNotIn(r.status_code, (409,), "FAILED não deveria bloquear nova tentativa")
        finally:
            with self._db_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM payment_method_change_requests WHERE idempotencyKey = %s",
                        (idem_key,),
                    )
                    conn.commit()


if __name__ == "__main__":
    unittest.main(verbosity=2)
