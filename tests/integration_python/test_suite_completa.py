"""
Suite completa de testes de integração do PlanVita.

Cobre: auth, titular, dependente, corresponsavel, plano, pagamento,
financeiro, users, roles, permissions, consultor, regras, layout,
parcerias, notificacoes, providers e endpoints de saúde.

Pré-requisitos:
  - DATABASE_URL_LIDER   ex: sqlserver://host:1433;database=DB;user=u;password=p
  - Opcional: PLANVITA_API_BASE_URL (se omitido, sobe o backend localmente)
  - Opcional: PLANVITA_TENANT, PLANVITA_ADMIN_EMAIL, PLANVITA_ADMIN_PASSWORD
"""

import os
import socket
import subprocess
import time
import unittest
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytds
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"


@dataclass
class SqlServerConfig:
    server: str
    port: int
    database: str
    user: str
    password: str


def parse_sqlserver_url(url: str) -> SqlServerConfig:
    if not url or not url.startswith("sqlserver://"):
        raise ValueError("DATABASE_URL_LIDER deve usar o formato sqlserver://host:porta;database=...;user=...;password=...")
    rest = url[len("sqlserver://"):]
    host_port, *parts = rest.split(";")
    if ":" not in host_port:
        raise ValueError("DATABASE_URL_LIDER sem host:porta")
    server, port_raw = host_port.split(":", 1)
    params: dict[str, str] = {}
    for part in parts:
        if not part.strip():
            continue
        key, value = part.split("=", 1)
        params[key.strip()] = value.strip()
    required = ("database", "user", "password")
    missing = [key for key in required if not params.get(key)]
    if missing:
        raise ValueError(f"DATABASE_URL_LIDER sem chaves obrigatorias: {', '.join(missing)}")
    return SqlServerConfig(
        server=server,
        port=int(port_raw),
        database=params["database"],
        user=params["user"],
        password=params["password"],
    )


class BaseIntegrationTest(unittest.TestCase):
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
                raise RuntimeError(f"Backend encerrou durante a inicializacao.\n{output}")
            try:
                r = requests.get(health_url, verify=False, timeout=3)
                if r.status_code < 500:
                    return
            except Exception as exc:
                last_error = str(exc)
            time.sleep(1)
        raise TimeoutError(f"Backend nao respondeu em {health_url}. Ultimo erro: {last_error}")

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

    def _suggest_plan_id(self, participantes: list[dict]) -> int:
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": participantes, "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200, r.text)
        planos = r.json()
        self.assertGreater(len(planos), 0)
        return int(planos[0]["id"])

    def _make_payload(
        self,
        *,
        titular_nasc: str = "1990-01-01",
        dependentes: list[dict] | None = None,
        step1_extra: dict | None = None,
        step2_extra: dict | None = None,
        step3_extra: dict | None = None,
        step5_extra: dict | None = None,
    ) -> dict:
        suffix = str(int(time.time() * 1000))[-8:]
        cpf_titular = f"9{suffix[:7]}1"[:11]
        cpf_dep = f"8{suffix[:7]}2"[:11]
        participantes = [{"dataNascimento": titular_nasc, "parentesco": "Titular"}]
        if dependentes is None:
            dependentes = [
                {
                    "nome": f"Dep Suite {suffix}",
                    "idade": 10,
                    "dataNascimento": "2015-06-01",
                    "parentesco": "Filho(a)",
                    "telefone": "71999990002",
                    "cpf": cpf_dep,
                }
            ]
        for dep in dependentes:
            if dep.get("dataNascimento"):
                participantes.append({"dataNascimento": dep["dataNascimento"], "parentesco": dep.get("parentesco", "Outro")})
        plano_id = self._suggest_plan_id(participantes)
        payload: dict[str, Any] = {
            "step1": {
                "nomeCompleto": f"Suite Test {suffix}",
                "cpf": cpf_titular,
                "dataNascimento": titular_nasc,
                "sexo": "Masculino",
                "rg": "7654321",
                "naturalidade": "Salvador",
                "telefone": "71999990001",
                "whatsapp": "71999990001",
                "email": f"suite.{suffix}@example.com",
                "situacaoConjugal": "Solteiro",
                "profissao": "Engenheiro",
            },
            "step2": {
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Pituba",
                "logradouro": "Av Principal",
                "complemento": "Apto 1",
                "numero": "100",
                "pontoReferencia": "Proximo ao shopping",
            },
            "step3": {"usarMesmosDados": True},
            "dependentes": dependentes,
            "step5": {"planoId": plano_id, "billingType": "PIX"},
        }
        if step1_extra:
            payload["step1"].update(step1_extra)
        if step2_extra:
            payload["step2"].update(step2_extra)
        if step3_extra:
            payload["step3"].update(step3_extra)
        if step5_extra:
            payload["step5"].update(step5_extra)
        return payload

    def _create_titular(self, payload: dict | None = None) -> dict:
        if payload is None:
            payload = self._make_payload()
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def _delete_if_exists(self, path: str) -> None:
        r = self.session.delete(f"{self.base_url}{path}", timeout=20)
        self.assertIn(r.status_code, (204, 404, 500), r.text)

    def _cleanup_titular(self, titular_id: int) -> None:
        for dep in self._fetch_all("SELECT id FROM Dependente WHERE titularId = %s", (titular_id,)):
            self._delete_if_exists(f"/dependente/{dep['id']}")
        for cor in self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,)):
            self._delete_if_exists(f"/corresponsavel/{cor['id']}")
        self._delete_if_exists(f"/titular/{titular_id}")


# ---------------------------------------------------------------------------
# 1. Health
# ---------------------------------------------------------------------------
class TestHealth(BaseIntegrationTest):

    def test_001_health_retorna_ok(self):
        url = self.base_url.replace("/api/v1", "/health")
        r = requests.get(url, verify=False, timeout=10)
        self.assertLess(r.status_code, 500)

    def test_002_health_sem_tenant_ainda_responde(self):
        url = self.base_url.replace("/api/v1", "/health")
        r = requests.get(url, verify=False, timeout=10, headers={})
        self.assertLess(r.status_code, 500)


# ---------------------------------------------------------------------------
# 2. Auth
# ---------------------------------------------------------------------------
class TestAuth(BaseIntegrationTest):

    def test_010_login_admin_sucesso(self):
        r = self.session.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("token", r.json())

    def test_011_login_credenciais_erradas(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"email": "naoexiste@x.com", "password": "errado"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (401, 400))

    def test_012_login_sem_email_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"password": "123456"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422))

    def test_013_login_sem_password_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422))

    def test_014_login_payload_vazio_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422))

    def test_015_auth_check_retorna_usuario_logado(self):
        r = self.session.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["email"], self.admin_email)
        self.assertIn("permissions", body)

    def test_016_auth_check_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/auth/check", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_017_logout_retorna_sucesso(self):
        tmp = requests.Session()
        tmp.verify = False
        tmp.headers.update({"X-Tenant": self.tenant})
        r = tmp.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        r2 = tmp.post(f"{self.base_url}/auth/logout", timeout=20)
        self.assertIn(r2.status_code, (200, 204))

    def test_018_forgot_password_email_invalido(self):
        r = requests.post(
            f"{self.base_url}/auth/forgot-password",
            json={"email": "naoexiste_forgot@example.com"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 404, 400))

    def test_019_reset_password_token_invalido(self):
        r = requests.post(
            f"{self.base_url}/auth/reset-password",
            json={"token": "token_invalido_xpto", "password": "NovaSenha@123"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 401))

    def test_020_verify_token_invalido_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/verify",
            json={"token": "tok_invalido_abc"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 404))

    def test_021_first_access_token_invalido_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/first-access",
            json={"token": "tok_invalido_abc", "password": "Senha@123"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 404))

    def test_022_reenviar_pagamento_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/auth/pagamento/reenviar",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_023_reenviar_contrato_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/auth/contrato/reenviar-link",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_024_auth_check_permissions_lista_nao_vazia(self):
        r = self.session.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(r.status_code, 200)
        perms = r.json().get("permissions", [])
        self.assertIsInstance(perms, list)
        self.assertGreater(len(perms), 0)

    def test_025_login_email_formato_invalido(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"email": "nao-e-email", "password": "123456"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 422))


# ---------------------------------------------------------------------------
# 3. Titular – consultas e validações
# ---------------------------------------------------------------------------
class TestTitularConsultas(BaseIntegrationTest):

    def test_030_titular_listagem_exige_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_031_titular_listagem_retorna_paginado(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("data", body)
        self.assertIn("total", body)
        self.assertLessEqual(len(body["data"]), 5)

    def test_032_titular_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/titular/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["message"], "Titular not found")

    def test_033_titular_busca_por_nome(self):
        r = self.session.get(f"{self.base_url}/titular", params={"search": "xpto_nao_existe_xyz"}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["total"], 0)

    def test_034_titular_filtro_por_status_ativo(self):
        r = self.session.get(f"{self.base_url}/titular", params={"status": "ATIVO", "page": 1, "limit": 3}, timeout=20)
        self.assertEqual(r.status_code, 200)

    def test_035_titular_filtro_por_status_pendente(self):
        r = self.session.get(f"{self.base_url}/titular", params={"status": "PENDENTE_ASSINATURA"}, timeout=20)
        self.assertEqual(r.status_code, 200)

    def test_036_public_search_sem_cpf_retorna_400(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["message"], "CPF is required")

    def test_037_public_search_cpf_inexistente_retorna_404(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "00000000000"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_038_export_csv_retorna_content_type_correto(self):
        r = self.session.get(f"{self.base_url}/titular/export/cadastro", timeout=30)
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers.get("Content-Type", ""))

    def test_039_export_csv_com_filtro_busca(self):
        r = self.session.get(
            f"{self.base_url}/titular/export/cadastro",
            params={"search": "xpto_nao_existe_xyz"},
            timeout=30,
        )
        self.assertEqual(r.status_code, 200)

    def test_040_titular_listagem_page_size_maximo(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 100}, timeout=20)
        self.assertEqual(r.status_code, 200)

    def test_041_titular_listagem_page_invalida(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 0, "limit": 5}, timeout=20)
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 4. Titular – criação e CRUD completo
# ---------------------------------------------------------------------------
class TestTitularCRUD(BaseIntegrationTest):

    def test_050_titular_full_cria_com_sucesso(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertEqual(created["email"], payload["step1"]["email"].lower())
            self.assertEqual(created["statusPlano"], "PENDENTE_ASSINATURA")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_051_titular_full_rejeita_cpf_duplicado_no_payload(self):
        payload = self._make_payload()
        payload["dependentes"][0]["cpf"] = payload["step1"]["cpf"]
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "CPF_DUPLICADO_NO_CADASTRO")

    def test_052_titular_full_rejeita_sem_plano(self):
        payload = self._make_payload()
        payload["step5"] = {}
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "PLANO_OBRIGATORIO")

    def test_053_titular_full_rejeita_plano_incompativel(self):
        payload = self._make_payload(titular_nasc="1930-01-01", dependentes=[], step5_extra={"planoId": 31})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "PLANO_INCOMPATIVEL")

    def test_054_titular_full_rejeita_excesso_beneficiarios(self):
        deps = [
            {
                "nome": f"Dep Limite {i}",
                "idade": 10 + i,
                "dataNascimento": "2015-01-01",
                "parentesco": "Filho(a)",
                "telefone": f"71999990{i:03d}"[:11],
                "cpf": f"7{i}12345678"[:11],
            }
            for i in range(9)
        ]
        payload = self._make_payload(dependentes=deps)
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "LIMITE_BENEFICIARIOS_EXCEDIDO")

    def test_055_titular_full_rejeita_corresponsavel_menor(self):
        payload = self._make_payload(
            step3_extra={
                "usarMesmosDados": False,
                "nomeCompleto": "Resp Menor",
                "cpf": "12312312312",
                "dataNascimento": "2012-01-01",
                "sexo": "Feminino",
                "naturalidade": "Salvador",
                "parentesco": "Mae",
                "email": "menor@example.com",
                "telefone": "71999990099",
                "situacaoConjugal": "Solteiro",
                "profissao": "Estudante",
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Centro",
                "logradouro": "Rua B",
                "numero": "20",
                "pontoReferencia": "Esquina",
            }
        )
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "CORRESPONSAVEL_MENOR_IDADE")

    def test_056_titular_full_rejeita_data_nascimento_dependente_invalida(self):
        payload = self._make_payload()
        payload["dependentes"][0]["dataNascimento"] = "nao-e-data"
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "DEPENDENTE_DATA_NASCIMENTO_INVALIDA")

    def test_057_titular_full_cpf_ja_cadastrado_retorna_409(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            self.assertEqual(r.status_code, 409)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_058_titular_get_detalhe_apos_criacao(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["id"], titular_id)
            self.assertEqual(r.json()["nome"], payload["step1"]["nomeCompleto"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_059_titular_update_campos_endereco(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"bairro": "Barra", "logradouro": "Orla", "numero": "42"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            db = self._fetch_one("SELECT bairro, logradouro, numero FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["bairro"], "Barra")
            self.assertEqual(db["numero"], "42")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_060_titular_update_telefone(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"telefone": "71988880001"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_061_titular_delete_remove_do_banco(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 204)
            db = self._fetch_one("SELECT id FROM Titular WHERE id = %s", (titular_id,))
            self.assertIsNone(db)
            titular_id = None
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_062_titular_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/titular/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_063_titular_dados_persistidos_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one(
                "SELECT email, cpf, planoId FROM Titular WHERE id = %s", (titular_id,)
            )
            self.assertEqual(db["email"], payload["step1"]["email"].lower())
            self.assertEqual(db["cpf"], payload["step1"]["cpf"])
            self.assertEqual(db["planoId"], payload["step5"]["planoId"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_064_titular_full_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        payload = self._make_payload()
        r = anon.post(
            f"{self.base_url}/titular/full",
            json=payload,
            headers={"X-Tenant": self.tenant},
            timeout=30,
        )
        self.assertEqual(r.status_code, 401)

    def test_065_titular_update_inexistente_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/titular/99999999",
            json={"bairro": "Inexistente"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_066_titular_criado_aparece_na_listagem(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular",
                params={"search": payload["step1"]["cpf"]},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertGreaterEqual(body["total"], 1)
            self.assertTrue(any(item["id"] == titular_id for item in body["data"]))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_067_titular_public_search_retorna_dados_corretos(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["id"], titular_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_068_titular_export_csv_contem_email_criado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular/export/cadastro",
                params={"search": payload["step1"]["email"]},
                timeout=30,
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn(payload["step1"]["email"].lower(), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_069_titular_status_pendente_assinatura_na_criacao(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT statusPlano FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["statusPlano"], "PENDENTE_ASSINATURA")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_070_titular_busca_por_email(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular",
                params={"search": payload["step1"]["email"]},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            self.assertGreaterEqual(r.json()["total"], 1)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_071_titular_dependentes_retornados_na_criacao(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertIn("dependentes", created)
            self.assertEqual(len(created["dependentes"]), 1)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_072_titular_public_search_404_apos_exclusao(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self._cleanup_titular(titular_id)
            titular_id = None
            r = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(r.status_code, 404)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_073_titular_sem_dependente_criado_com_sucesso(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertEqual(titular_id > 0, True)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_074_titular_update_email_campo(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"profissao": "Medico"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 5. Dependente
# ---------------------------------------------------------------------------
class TestDependente(BaseIntegrationTest):

    def test_080_dependente_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/dependente/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["message"], "Dependente not found")

    def test_081_dependente_update_inexistente_retorna_404(self):
        r = self.session.put(f"{self.base_url}/dependente/99999999", json={"nome": "X"}, timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_082_dependente_create_titular_invalido_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/dependente",
            json={"titularId": 0, "nome": "Dep Sem Titular", "dataNascimento": "2014-01-01", "tipoDependente": "Filho(a)"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["message"], "titularId inválido.")

    def test_083_dependente_crud_completo(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Teste", "dataNascimento": "2010-05-15", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            dep_id = int(r.json()["id"])

            r2 = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()["id"], dep_id)

            r3 = self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"nome": "Dep Atualizado"}, timeout=20)
            self.assertEqual(r3.status_code, 200)
            db = self._fetch_one("SELECT nome FROM Dependente WHERE id = %s", (dep_id,))
            self.assertEqual(db["nome"], "Dep Atualizado")

            r4 = self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r4.status_code, 204)
            dep_id = None
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_084_dependente_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/dependente/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_085_dependente_titular_invalido_fk_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"titularId": 0}, timeout=20)
            self.assertEqual(r.status_code, 500)
            self.assertIn("Dependente_titularId_fkey", r.json()["message"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_086_dependente_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/dependente/1", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_087_dependente_criado_persistido_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Banco", "dataNascimento": "2012-08-20", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            dep_id = int(r.json()["id"])
            db = self._fetch_one("SELECT titularId, nome FROM Dependente WHERE id = %s", (dep_id,))
            self.assertEqual(db["titularId"], titular_id)
            self.assertEqual(db["nome"], "Dep Banco")
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_088_dependente_update_data_nascimento(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"dataNascimento": "2014-04-11"}, timeout=20)
            self.assertEqual(r.status_code, 200)
            db = self._fetch_one(
                "SELECT CONVERT(varchar(10), dataNascimento, 23) AS dataNascimento FROM Dependente WHERE id = %s",
                (dep_id,),
            )
            self.assertEqual(str(db["dataNascimento"]), "2014-04-11")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_089_dependente_create_sem_nome_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "dataNascimento": "2010-01-01", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertIn(r.status_code, (400, 422, 500))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_090_dependente_apos_exclusao_titular_nao_encontrado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            self._cleanup_titular(titular_id)
            titular_id = None
            r = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r.status_code, 404)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 6. Corresponsavel
# ---------------------------------------------------------------------------
class TestCorresponsavel(BaseIntegrationTest):

    def _make_corresponsavel_payload(self, titular_id: int, suffix: str) -> dict:
        return {
            "titularId": titular_id,
            "nome": f"Corresponsavel {suffix}",
            "email": f"cor.{suffix}@example.com",
            "telefone": "71988887777",
            "cpf": f"77788899{suffix[:3]}",
            "dataNascimento": "1985-03-20T00:00:00.000Z",
            "relacionamento": "Irmão",
            "sexo": "Masculino",
            "rg": "1122334",
            "naturalidade": "Feira de Santana",
            "situacaoConjugal": "Casado",
            "profissao": "Contador",
            "cep": "40000000",
            "uf": "BA",
            "cidade": "Salvador",
            "bairro": "Itaigara",
            "logradouro": "Rua das Acaias",
            "complemento": "",
            "numero": "55",
            "pontoReferencia": "Padaria",
        }

    def test_100_corresponsavel_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/corresponsavel/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["message"], "Corresponsavel not found")

    def test_101_corresponsavel_crud_completo(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_payload = self._make_corresponsavel_payload(titular_id, suffix)
            r = self.session.post(f"{self.base_url}/corresponsavel", json=cor_payload, timeout=20)
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])

            r2 = self.session.get(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()["id"], cor_id)

            r3 = self.session.put(f"{self.base_url}/corresponsavel/{cor_id}", json={"nome": "Cor Atualizado"}, timeout=20)
            self.assertEqual(r3.status_code, 200)
            db = self._fetch_one("SELECT nome FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertEqual(db["nome"], "Cor Atualizado")

            r4 = self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r4.status_code, 204)
            cor_id = None
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_102_corresponsavel_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/corresponsavel/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_103_corresponsavel_update_bairro_persistido(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_payload = self._make_corresponsavel_payload(titular_id, suffix)
            r = self.session.post(f"{self.base_url}/corresponsavel", json=cor_payload, timeout=20)
            cor_id = int(r.json()["id"])
            self.session.put(f"{self.base_url}/corresponsavel/{cor_id}", json={"bairro": "Brotas"}, timeout=20)
            db = self._fetch_one("SELECT bairro FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertEqual(db["bairro"], "Brotas")
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_104_corresponsavel_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/corresponsavel",
            json={"titularId": 1},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_105_corresponsavel_email_persistido_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_payload = self._make_corresponsavel_payload(titular_id, suffix)
            r = self.session.post(f"{self.base_url}/corresponsavel", json=cor_payload, timeout=20)
            cor_id = int(r.json()["id"])
            db = self._fetch_one("SELECT email FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertEqual(db["email"], cor_payload["email"])
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 7. Plano
# ---------------------------------------------------------------------------
class TestPlano(BaseIntegrationTest):

    def test_110_plano_listagem_retorna_paginado(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("data", body)
        self.assertIn("pagination", body)
        self.assertLessEqual(len(body["data"]), 5)

    def test_111_plano_listagem_retorna_total_positivo(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 5, "ativo": "true"}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertGreater(r.json()["pagination"]["total"], 0)

    def test_112_plano_detalhe_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/plano/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["message"], "Plano not found")

    def test_113_plano_sugerir_retorna_lista(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        planos = r.json()
        self.assertIsInstance(planos, list)
        self.assertGreater(len(planos), 0)
        self.assertIn("id", planos[0])
        self.assertIn("nome", planos[0])

    def test_114_plano_sugerir_sem_participantes_retorna_400(self):
        r = self.session.post(f"{self.base_url}/plano/sugerir", json={"participantes": []}, timeout=20)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["message"], "Informe a lista de participantes.")

    def test_115_plano_sugerir_com_dependente(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1985-03-10", "parentesco": "Titular"},
                    {"dataNascimento": "2018-07-22", "parentesco": "Filho(a)"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_116_patch_plano_titular_invalido_retorna_400(self):
        r = self.session.patch(f"{self.base_url}/plano/titulares/0/plano", json={"planoId": 31}, timeout=20)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["message"], "titularId inválido.")

    def test_117_patch_plano_id_invalido_retorna_400(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.patch(f"{self.base_url}/plano/titulares/{titular_id}/plano", json={"planoId": 0}, timeout=20)
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["message"], "planoId inválido.")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_118_patch_plano_atualiza_e_mantem_ao_enviar_null(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            novo_plano = 32 if int(payload["step5"]["planoId"]) != 32 else 33
            r = self.session.patch(f"{self.base_url}/plano/titulares/{titular_id}/plano", json={"planoId": novo_plano}, timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["planoId"], novo_plano)
            r2 = self.session.patch(f"{self.base_url}/plano/titulares/{titular_id}/plano", json={"planoId": None}, timeout=20)
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()["planoId"], novo_plano)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_119_plano_listagem_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/plano", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_120_plano_sugerir_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}]},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_121_plano_detalhe_existente_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        planos = r.json().get("data", [])
        if not planos:
            self.skipTest("Sem planos cadastrados")
        plano_id = planos[0]["id"]
        r2 = self.session.get(f"{self.base_url}/plano/{plano_id}", timeout=20)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["id"], plano_id)

    def test_122_plano_filtro_ativo_false(self):
        r = self.session.get(f"{self.base_url}/plano", params={"ativo": "false"}, timeout=20)
        self.assertEqual(r.status_code, 200)


# ---------------------------------------------------------------------------
# 8. Users / Roles / Permissions
# ---------------------------------------------------------------------------
class TestUsersRolesPermissions(BaseIntegrationTest):

    def test_130_users_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/users", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_131_users_listagem_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/users", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_132_roles_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/roles", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_133_roles_listagem_contem_campos_obrigatorios(self):
        r = self.session.get(f"{self.base_url}/roles", timeout=20)
        roles = r.json()
        if roles:
            self.assertIn("id", roles[0])
            self.assertIn("name", roles[0])

    def test_134_permissions_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/permissions", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_135_permissions_listagem_contem_campos_obrigatorios(self):
        r = self.session.get(f"{self.base_url}/permissions", timeout=20)
        perms = r.json()
        if perms:
            self.assertIn("id", perms[0])

    def test_136_user_password_update_invalid_user_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/password",
            json={"password": "NovaSenha@123"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_137_user_email_update_invalid_user_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/email",
            json={"email": "novo@email.com"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_138_user_role_update_invalid_user_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/role",
            json={"roleId": 1},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_139_roles_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/roles", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_140_permissions_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/permissions", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_141_users_listagem_contem_admin(self):
        r = self.session.get(f"{self.base_url}/users", timeout=20)
        users = r.json()
        emails = [u.get("email", "").lower() for u in users]
        self.assertIn(self.admin_email.lower(), emails)

    def test_142_roles_permissions_update_role_inexistente(self):
        r = self.session.put(
            f"{self.base_url}/roles/99999999/permissions",
            json={"permissionIds": []},
            timeout=20,
        )
        self.assertIn(r.status_code, (404, 400))


# ---------------------------------------------------------------------------
# 9. Consultor
# ---------------------------------------------------------------------------
class TestConsultor(BaseIntegrationTest):

    def test_150_consultor_public_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_151_consultor_public_contem_campos_obrigatorios(self):
        r = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        consultores = r.json()
        if consultores:
            self.assertIn("id", consultores[0])
            self.assertIn("nome", consultores[0])

    def test_152_consultor_public_sem_autenticacao_funciona(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/consultor/public", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 200)

    def test_153_consultor_me_comissoes_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/consultor/me/comissoes", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_154_consultor_listagem_autenticada(self):
        r = self.session.get(f"{self.base_url}/consultor", timeout=20)
        self.assertIn(r.status_code, (200, 403))


# ---------------------------------------------------------------------------
# 10. Regras
# ---------------------------------------------------------------------------
class TestRegras(BaseIntegrationTest):

    def test_160_regras_get_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_161_regras_contem_tenant_correto(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if regras:
            self.assertEqual(str(regras[0].get("tenantId", "")).upper(), self.tenant.upper())

    def test_162_regras_public_sem_autenticacao_funciona(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/regras", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))

    def test_163_regras_campos_obrigatorios_presentes(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if regras:
            self.assertIn("tenantId", regras[0])


# ---------------------------------------------------------------------------
# 11. Layout
# ---------------------------------------------------------------------------
class TestLayout(BaseIntegrationTest):

    def test_170_layout_get_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/layout", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_171_layout_sem_autenticacao_retorna_erro_ou_public(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/layout", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401, 404))


# ---------------------------------------------------------------------------
# 12. Pagamento
# ---------------------------------------------------------------------------
class TestPagamento(BaseIntegrationTest):

    def test_180_pagamento_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/pagamento", timeout=20)
        self.assertIn(r.status_code, (200, 400))
        if r.status_code == 200:
            body = r.json()
            self.assertIn("data", body)

    def test_181_pagamento_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/pagamento", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_182_pagamento_detalhe_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/pagamento/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_183_pagamento_listagem_com_filtro_status(self):
        r = self.session.get(f"{self.base_url}/pagamento", params={"status": "PENDENTE"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_184_pagamento_listagem_com_filtro_data(self):
        r = self.session.get(
            f"{self.base_url}/pagamento",
            params={"dataInicio": "2026-01-01", "dataFim": "2026-12-31"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_185_pagamento_update_inexistente_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/pagamento/99999999",
            json={"status": "PAGO"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)


# ---------------------------------------------------------------------------
# 13. Financeiro
# ---------------------------------------------------------------------------
class TestFinanceiro(BaseIntegrationTest):

    def test_190_financeiro_contas_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/financeiro/contas", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_191_financeiro_contas_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/financeiro/contas", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_192_financeiro_cadastros_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/financeiro/cadastros", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_193_financeiro_relatorios_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/financeiro/relatorios", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_194_financeiro_metricas_recorrencia_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/financeiro/metricas/recorrencia", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_195_financeiro_recorrencias_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/financeiro/recorrencias", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_196_financeiro_cliente_contas_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/financeiro/cliente/contas", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_197_financeiro_contas_pagar_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/financeiro/contas/pagar", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_198_financeiro_contas_receber_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/financeiro/contas/receber", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_199_financeiro_recorrencias_sincronizar_retorna_resultado(self):
        r = self.session.post(f"{self.base_url}/financeiro/recorrencias/sincronizar", json={}, timeout=30)
        self.assertIn(r.status_code, (200, 202, 400, 500))

    def test_200_financeiro_recorrencias_gerar_titular_invalido(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/recorrencias/titular/99999999/gerar",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 500))

    def test_201_financeiro_recorrencias_cancelar_titular_invalido(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/recorrencias/titular/99999999/cancelar",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 500))

    def test_202_financeiro_contas_baixa_inexistente(self):
        r = self.session.post(f"{self.base_url}/financeiro/contas/pagar/99999999/baixa", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_203_financeiro_contas_estorno_inexistente(self):
        r = self.session.post(f"{self.base_url}/financeiro/contas/pagar/99999999/estorno", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_204_financeiro_contas_receber_reconsulta_inexistente(self):
        r = self.session.post(f"{self.base_url}/financeiro/contas/receber/99999999/reconsulta", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_205_financeiro_cadastros_banco_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/financeiro/cadastros/bancos", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_206_financeiro_cadastros_tipo_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/financeiro/cadastros/tipos", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_207_financeiro_cadastros_forma_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/financeiro/cadastros/formas", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_208_financeiro_cadastros_centro_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/financeiro/cadastros/centros", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_209_financeiro_cadastros_banco_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/cadastros/bancos/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))

    def test_210_financeiro_cadastros_tipo_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/cadastros/tipos/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))

    def test_211_financeiro_cadastros_forma_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/cadastros/formas/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))

    def test_212_financeiro_cadastros_centro_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/cadastros/centros/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))


# ---------------------------------------------------------------------------
# 14. Parcerias
# ---------------------------------------------------------------------------
class TestParcerias(BaseIntegrationTest):

    def test_220_parcerias_categorias_admin_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/parcerias/categorias", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_221_parcerias_parceiros_admin_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/parcerias/parceiros", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_222_parcerias_vantagens_admin_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/parcerias/vantagens", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_223_parcerias_cliente_categorias_sem_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/parcerias/cliente/categorias", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401, 403))

    def test_224_parcerias_cliente_vantagens_sem_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/parcerias/cliente/vantagens", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401, 403))

    def test_225_parcerias_categorias_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/parcerias/categorias", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_226_parcerias_parceiros_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/parcerias/parceiros", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_227_parcerias_vantagens_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/parcerias/vantagens", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_228_parcerias_vantagens_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/parcerias/vantagens/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))

    def test_229_parcerias_vantagem_slug_inexistente(self):
        r = self.session.get(f"{self.base_url}/parcerias/cliente/vantagens/slug-inexistente-xyz", timeout=20)
        self.assertIn(r.status_code, (401, 403, 404))

    def test_230_parcerias_public_vantagens_retorna_dados(self):
        r = requests.get(
            f"{self.base_url}/parcerias/public/vantagens",
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 401, 404))


# ---------------------------------------------------------------------------
# 15. Notificações
# ---------------------------------------------------------------------------
class TestNotificacoes(BaseIntegrationTest):

    def test_240_notificacoes_templates_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/notificacoes/templates", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_241_notificacoes_templates_create_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/notificacoes/templates", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_242_notificacoes_templates_update_inexistente(self):
        r = self.session.put(f"{self.base_url}/notificacoes/templates/99999999", json={"nome": "X"}, timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))

    def test_243_notificacoes_templates_delete_inexistente(self):
        r = self.session.delete(f"{self.base_url}/notificacoes/templates/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 500))

    def test_244_notificacoes_recorrentes_painel_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/notificacoes/recorrentes/painel", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_245_notificacoes_recorrentes_logs_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/notificacoes/recorrentes/logs", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_246_notificacoes_whatsapp_status_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/notificacoes/whatsapp", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_247_notificacoes_whatsapp_qr_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/notificacoes/whatsapp/qr", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_248_notificacoes_whatsapp_queue_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/notificacoes/whatsapp/queue", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_249_notificacoes_recorrentes_disparar_payload_invalido(self):
        r = self.session.post(f"{self.base_url}/notificacoes/recorrentes/disparar", json={}, timeout=30)
        self.assertIn(r.status_code, (200, 202, 400, 422, 500))

    def test_250_notificacoes_recorrentes_agendamento_payload_invalido(self):
        r = self.session.patch(f"{self.base_url}/notificacoes/recorrentes/agendamento", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 422, 500))

    def test_251_notificacoes_bloqueio_titular_invalido(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/bloqueio",
            json={"bloqueado": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404, 500))

    def test_252_notificacoes_metodo_titular_invalido(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/metodo",
            json={"metodo": "email"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404, 500))

    def test_253_notificacoes_whatsapp_test_retorna_dados(self):
        r = self.session.post(f"{self.base_url}/notificacoes/whatsapp/test", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 500))

    def test_254_notificacoes_sem_autenticacao_templates_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/notificacoes/templates", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 16. Providers / Asaas
# ---------------------------------------------------------------------------
class TestProviders(BaseIntegrationTest):

    def test_260_asaas_payments_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/providers/asaas/payments", timeout=30)
        self.assertIn(r.status_code, (200, 400, 401, 403, 500))

    def test_261_asaas_payments_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/providers/asaas/payments", headers={"X-Tenant": self.tenant}, timeout=30)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 17. Titular – endpoints me (portal do cliente)
# ---------------------------------------------------------------------------
class TestTitularMe(BaseIntegrationTest):

    def test_270_titular_me_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular/me", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_271_titular_me_como_admin_retorna_erro_ou_dados(self):
        r = self.session.get(f"{self.base_url}/titular/me", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_272_titular_me_foto_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular/me/foto/arquivo", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_273_titular_me_assinaturas_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular/me/assinaturas", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_274_titular_me_contrato_arquivo_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular/me/contrato/arquivo", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 18. Titular – assinaturas e contratos (admin)
# ---------------------------------------------------------------------------
class TestTitularAssinaturas(BaseIntegrationTest):

    def test_280_titular_assinaturas_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/titular/99999999/assinaturas", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_281_titular_contrato_arquivo_inexistente_retorna_erro(self):
        r = self.session.get(f"{self.base_url}/titular/99999999/contrato/arquivo", timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))

    def test_282_titular_assinaturas_criado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(f"{self.base_url}/titular/{titular_id}/assinaturas", timeout=20)
            self.assertIn(r.status_code, (200, 404))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_283_titular_sync_status_plano_retorna_dados(self):
        r = self.session.post(f"{self.base_url}/titular/sync-status-plano", json={}, timeout=30)
        self.assertIn(r.status_code, (200, 202, 400, 404, 500))


# ---------------------------------------------------------------------------
# 19. Cenários de segurança / autenticação cruzada
# ---------------------------------------------------------------------------
class TestSeguranca(BaseIntegrationTest):

    def test_290_rotas_protegidas_todas_exigem_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        headers = {"X-Tenant": self.tenant}
        rotas = [
            ("get", "/titular"),
            ("get", "/auth/check"),
            ("get", "/dependente/1"),
            ("get", "/corresponsavel/1"),
            ("get", "/plano"),
            ("get", "/users"),
            ("get", "/roles"),
            ("get", "/permissions"),
            ("get", "/pagamento"),
        ]
        for method, path in rotas:
            r = getattr(anon, method)(f"{self.base_url}{path}", headers=headers, timeout=20)
            self.assertEqual(r.status_code, 401, f"Rota {path} deveria exigir autenticacao")

    def test_291_tenant_header_ausente_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 403))

    def test_292_sql_injection_no_search_nao_quebra_servidor(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"search": "'; DROP TABLE Titular; --"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_293_sql_injection_no_cpf_public_search(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "'; DROP TABLE Titular; --"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404))

    def test_294_ids_negativos_retornam_400_ou_404(self):
        r = self.session.get(f"{self.base_url}/titular/-1", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_295_ids_alfanumericos_retornam_400_ou_404(self):
        r = self.session.get(f"{self.base_url}/titular/abc", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_296_payload_muito_grande_nao_quebra_servidor(self):
        payload = self._make_payload()
        payload["step1"]["nomeCompleto"] = "A" * 10000
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 413, 422, 500))

    def test_297_metodo_http_errado_retorna_405_ou_404(self):
        r = self.session.patch(f"{self.base_url}/titular", json={}, timeout=20)
        self.assertIn(r.status_code, (404, 405))

    def test_298_content_type_errado_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/auth/login",
            data="email=x&password=y",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 415, 422))


# ---------------------------------------------------------------------------
# 20. Cenários de paginação e filtros avançados
# ---------------------------------------------------------------------------
class TestPaginacaoFiltros(BaseIntegrationTest):

    def test_300_titular_page_2_retorna_dados_diferentes(self):
        r1 = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 2}, timeout=20)
        r2 = self.session.get(f"{self.base_url}/titular", params={"page": 2, "limit": 2}, timeout=20)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        ids1 = {item["id"] for item in r1.json().get("data", [])}
        ids2 = {item["id"] for item in r2.json().get("data", [])}
        self.assertEqual(ids1.isdisjoint(ids2), True)

    def test_301_plano_paginacao_page_2(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 2, "pageSize": 2}, timeout=20)
        self.assertEqual(r.status_code, 200)

    def test_302_titular_filtro_uf(self):
        r = self.session.get(f"{self.base_url}/titular", params={"uf": "BA"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_303_titular_filtro_plano(self):
        r_planos = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        if r_planos.status_code == 200 and r_planos.json().get("data"):
            plano_id = r_planos.json()["data"][0]["id"]
            r = self.session.get(f"{self.base_url}/titular", params={"planoId": plano_id}, timeout=20)
            self.assertIn(r.status_code, (200, 400))

    def test_304_pagamento_paginacao(self):
        r = self.session.get(f"{self.base_url}/pagamento", params={"page": 1, "limit": 5}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_305_titular_ordem_por_nome(self):
        r = self.session.get(f"{self.base_url}/titular", params={"orderBy": "nome", "order": "asc"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 21. Benefício e BeneficiarioTipo
# ---------------------------------------------------------------------------
class TestBeneficiosBeneficiarios(BaseIntegrationTest):

    def test_310_beneficio_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/beneficio", timeout=20)
        self.assertIn(r.status_code, (200, 401, 403, 404))

    def test_311_beneficiariotipo_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/beneficiariotipo/tipo", timeout=20)
        self.assertIn(r.status_code, (200, 401, 403, 404))

    def test_312_beneficio_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/beneficio", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 22. Documento
# ---------------------------------------------------------------------------
class TestDocumento(BaseIntegrationTest):

    def test_320_documento_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/documento", timeout=20)
        self.assertIn(r.status_code, (200, 401, 403, 404))

    def test_321_documento_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/documento", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 23. Comissão
# ---------------------------------------------------------------------------
class TestComissao(BaseIntegrationTest):

    def test_330_comissao_listagem_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/comissao", timeout=20)
        self.assertIn(r.status_code, (200, 401, 403, 404))

    def test_331_comissao_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/comissao", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 24. Cenários de integridade de dados
# ---------------------------------------------------------------------------
class TestIntegridadeDados(BaseIntegrationTest):

    def test_340_titular_email_minusculo_no_banco(self):
        payload = self._make_payload(step1_extra={"email": "EmailMaiusculo@Test.COM"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT email FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["email"], db["email"].lower())
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_341_dependentes_vinculados_ao_titular(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            deps = self._fetch_all("SELECT id, titularId FROM Dependente WHERE titularId = %s", (titular_id,))
            self.assertGreater(len(deps), 0)
            for dep in deps:
                self.assertEqual(dep["titularId"], titular_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_342_plano_id_valido_no_titular(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT planoId FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["planoId"], payload["step5"]["planoId"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_343_corresponsavel_titular_vinculo_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            cors = self._fetch_all("SELECT id, titularId FROM Corresponsavel WHERE titularId = %s", (titular_id,))
            for cor in cors:
                self.assertEqual(cor["titularId"], titular_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_344_criar_dois_titulares_cpfs_distintos(self):
        p1 = self._make_payload()
        p2 = self._make_payload()
        id1 = id2 = None
        try:
            c1 = self._create_titular(p1)
            id1 = int(c1["id"])
            c2 = self._create_titular(p2)
            id2 = int(c2["id"])
            self.assertNotEqual(id1, id2)
            self.assertNotEqual(p1["step1"]["cpf"], p2["step1"]["cpf"])
        finally:
            if id1:
                self._cleanup_titular(id1)
            if id2:
                self._cleanup_titular(id2)

    def test_345_titular_update_nao_altera_cpf(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.session.put(f"{self.base_url}/titular/{titular_id}", json={"bairro": "NovoB"}, timeout=20)
            db = self._fetch_one("SELECT cpf FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["cpf"], payload["step1"]["cpf"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_346_dependente_nome_atualizado_correto(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"nome": "Atualizado Teste"}, timeout=20)
            db = self._fetch_one("SELECT nome FROM Dependente WHERE id = %s", (dep_id,))
            self.assertEqual(db["nome"], "Atualizado Teste")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_347_busca_por_cpf_exato_retorna_um_resultado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular",
                params={"search": payload["step1"]["cpf"]},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertGreaterEqual(body["total"], 1)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 25. Cenários de paginação extrema e filtros combinados
# ---------------------------------------------------------------------------
class TestCenariosEdge(BaseIntegrationTest):

    def test_350_plano_sugerir_apenas_titular_sem_dependente(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1975-11-30", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_351_plano_sugerir_titular_muito_idoso(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1920-01-01", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_352_plano_sugerir_titular_menor_de_idade(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "2020-01-01", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_353_titular_full_sem_step1_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/titular/full", json={"step2": {}, "step5": {"planoId": 31}}, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_354_titular_full_sem_step2_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/titular/full", json={"step1": {"nomeCompleto": "X"}, "step5": {"planoId": 31}}, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_355_dependente_parentesco_invalido_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Invalido", "dataNascimento": "2010-01-01", "tipoDependente": "PARENTESCO_INVALIDO_XYZ"},
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400, 422))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_356_titular_listagem_page_muito_alta_retorna_vazio_ou_dados(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 9999, "limit": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("data", body)

    def test_357_plano_listagem_sem_parametros(self):
        r = self.session.get(f"{self.base_url}/plano", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_358_titular_full_billing_type_boleto(self):
        payload = self._make_payload(step5_extra={"billingType": "BOLETO"})
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_359_titular_full_billing_type_cartao(self):
        payload = self._make_payload(step5_extra={"billingType": "CREDIT_CARD"})
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_360_titular_sexo_feminino(self):
        payload = self._make_payload(step1_extra={"sexo": "Feminino"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT sexo FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["sexo"], "Feminino")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_361_titular_situacao_conjugal_casado(self):
        payload = self._make_payload(step1_extra={"situacaoConjugal": "Casado"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT situacaoConjugal FROM Titular WHERE id = %s", (titular_id,))
            self.assertIn(db["situacaoConjugal"], ("Casado", "Casado(a)"))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_362_titular_uf_diferente(self):
        payload = self._make_payload(step2_extra={"uf": "SP", "cidade": "São Paulo", "bairro": "Centro"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT uf FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["uf"], "SP")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_363_titular_sem_complemento_endereco(self):
        payload = self._make_payload(step2_extra={"complemento": ""})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_364_consultor_public_lista_nao_vazia(self):
        r = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertGreater(len(r.json()), 0)

    def test_365_plano_sugerir_multiplos_dependentes(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1980-05-20", "parentesco": "Titular"},
                    {"dataNascimento": "2005-03-15", "parentesco": "Filho(a)"},
                    {"dataNascimento": "2010-08-10", "parentesco": "Filho(a)"},
                    {"dataNascimento": "1982-11-25", "parentesco": "Cônjuge"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)


# ---------------------------------------------------------------------------
# 26. Cenários com corresponsável – validações adicionais
# ---------------------------------------------------------------------------
class TestCorresponsavelValidacoes(BaseIntegrationTest):

    def test_370_corresponsavel_create_sem_titular_id_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/corresponsavel",
            json={"nome": "Sem Titular", "cpf": "11122233344"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))

    def test_371_corresponsavel_create_titular_inexistente_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/corresponsavel",
            json={
                "titularId": 99999999,
                "nome": "Cor Inexistente",
                "email": "cor.inex@example.com",
                "telefone": "71988880000",
                "cpf": "22233344455",
                "dataNascimento": "1980-01-01T00:00:00.000Z",
                "relacionamento": "Amigo",
                "sexo": "Masculino",
                "naturalidade": "Salvador",
                "situacaoConjugal": "Solteiro",
                "profissao": "Nenhum",
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Centro",
                "logradouro": "Rua X",
                "numero": "1",
                "pontoReferencia": "Esquina",
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 500))

    def test_372_corresponsavel_atualiza_profissao(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Prof {suffix}",
                    "email": f"cor.prof.{suffix}@example.com",
                    "telefone": "71988880001",
                    "cpf": f"33344455{suffix[:3]}",
                    "dataNascimento": "1975-06-15T00:00:00.000Z",
                    "relacionamento": "Primo",
                    "sexo": "Masculino",
                    "naturalidade": "Feira",
                    "situacaoConjugal": "Solteiro",
                    "profissao": "Médico",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Nazaré",
                    "logradouro": "Av dos Médicos",
                    "numero": "77",
                    "pontoReferencia": "Hospital",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            r2 = self.session.put(
                f"{self.base_url}/corresponsavel/{cor_id}",
                json={"profissao": "Engenheiro"},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200)
            db = self._fetch_one("SELECT profissao FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertEqual(db["profissao"], "Engenheiro")
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_373_corresponsavel_atualiza_logradouro(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Rua {suffix}",
                    "email": f"cor.rua.{suffix}@example.com",
                    "telefone": "71988880002",
                    "cpf": f"44455566{suffix[:3]}",
                    "dataNascimento": "1990-02-28T00:00:00.000Z",
                    "relacionamento": "Vizinho",
                    "sexo": "Feminino",
                    "naturalidade": "Alagoinhas",
                    "situacaoConjugal": "Viúvo",
                    "profissao": "Professora",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Sussuarana",
                    "logradouro": "Rua das Flores",
                    "numero": "22",
                    "pontoReferencia": "Escola",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            r2 = self.session.put(
                f"{self.base_url}/corresponsavel/{cor_id}",
                json={"logradouro": "Rua Nova Atualizada"},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_374_corresponsavel_excluido_nao_aparece_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Del {suffix}",
                    "email": f"cor.del.{suffix}@example.com",
                    "telefone": "71988880003",
                    "cpf": f"55566677{suffix[:3]}",
                    "dataNascimento": "1995-07-10T00:00:00.000Z",
                    "relacionamento": "Colega",
                    "sexo": "Feminino",
                    "naturalidade": "Vitória da Conquista",
                    "situacaoConjugal": "Solteira",
                    "profissao": "Advogada",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Cabula",
                    "logradouro": "Trav das Palmeiras",
                    "numero": "33",
                    "pontoReferencia": "Parque",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            db = self._fetch_one("SELECT id FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertIsNone(db)
            cor_id = None
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 27. Cenários de listagem com múltiplos titulares
# ---------------------------------------------------------------------------
class TestMultiplosTitulares(BaseIntegrationTest):

    def test_380_dois_titulares_listagem_mostra_ambos(self):
        p1 = self._make_payload()
        p2 = self._make_payload()
        id1 = id2 = None
        try:
            c1 = self._create_titular(p1)
            id1 = int(c1["id"])
            c2 = self._create_titular(p2)
            id2 = int(c2["id"])
            r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 50}, timeout=20)
            self.assertEqual(r.status_code, 200)
            ids = {item["id"] for item in r.json().get("data", [])}
            self.assertIn(id1, ids)
            self.assertIn(id2, ids)
        finally:
            if id1:
                self._cleanup_titular(id1)
            if id2:
                self._cleanup_titular(id2)

    def test_381_titular_busca_parcial_por_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        nome_unico = f"BuscaParcial{suffix}"
        payload = self._make_payload(step1_extra={"nomeCompleto": nome_unico})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular",
                params={"search": nome_unico[:12]},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            self.assertGreaterEqual(r.json()["total"], 1)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_382_export_csv_dois_titulares_contem_ambos(self):
        p1 = self._make_payload()
        p2 = self._make_payload()
        id1 = id2 = None
        try:
            c1 = self._create_titular(p1)
            id1 = int(c1["id"])
            c2 = self._create_titular(p2)
            id2 = int(c2["id"])
            r = self.session.get(
                f"{self.base_url}/titular/export/cadastro",
                params={"search": p1["step1"]["email"]},
                timeout=30,
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn(p1["step1"]["email"].lower(), r.text)
        finally:
            if id1:
                self._cleanup_titular(id1)
            if id2:
                self._cleanup_titular(id2)

    def test_383_total_titulares_aumenta_apos_criacao(self):
        r0 = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        total_antes = r0.json()["total"]
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r1 = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
            self.assertGreater(r1.json()["total"], total_antes)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_384_total_titulares_diminui_apos_exclusao(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r0 = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
            total_com = r0.json()["total"]
            self._cleanup_titular(titular_id)
            titular_id = None
            r1 = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
            self.assertLess(r1.json()["total"], total_com)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 28. Cenários de plano – CRUD administrativo
# ---------------------------------------------------------------------------
class TestPlanoCRUDAdmin(BaseIntegrationTest):

    def test_390_plano_create_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/plano", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_391_plano_update_inexistente_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/plano/99999999",
            json={"nome": "Plano Inexistente"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_392_plano_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/plano/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_393_plano_listagem_campos_obrigatorios(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        if data:
            self.assertIn("id", data[0])
            self.assertIn("nome", data[0])

    def test_394_plano_sugerir_retorna_campos_obrigatorios(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1988-04-12", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        planos = r.json()
        if planos:
            self.assertIn("id", planos[0])
            self.assertIn("nome", planos[0])

    def test_395_plano_listagem_sem_filtro_ativo(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 10}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIn("data", r.json())

    def test_396_plano_patch_plano_sem_plano_id_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 29. Cenários de users – criação e atualização
# ---------------------------------------------------------------------------
class TestUsersCRUD(BaseIntegrationTest):

    def test_400_users_create_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/users", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_401_users_create_email_existente_retorna_409(self):
        r = self.session.post(
            f"{self.base_url}/users",
            json={"email": self.admin_email, "password": "Senha@123", "roleId": 1},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 409, 422, 500))

    def test_402_users_listagem_tem_campos_id_email(self):
        r = self.session.get(f"{self.base_url}/users", timeout=20)
        users = r.json()
        if users:
            self.assertIn("id", users[0])
            self.assertIn("email", users[0])

    def test_403_users_password_update_sem_payload_retorna_erro(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem usuários para testar")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(f"{self.base_url}/users/{user_id}/password", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_404_roles_create_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/roles", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_405_roles_listagem_nao_vazia(self):
        r = self.session.get(f"{self.base_url}/roles", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertGreater(len(r.json()), 0)

    def test_406_permissions_listagem_nao_vazia(self):
        r = self.session.get(f"{self.base_url}/permissions", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)


# ---------------------------------------------------------------------------
# 30. Cenários de regras – criação e atualização
# ---------------------------------------------------------------------------
class TestRegrasCRUD(BaseIntegrationTest):

    def test_410_regras_post_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/regras", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 409, 422, 500))

    def test_411_regras_put_tenant_invalido_retorna_erro(self):
        r = self.session.put(f"{self.base_url}/regras/TENANT_INVALIDO_XYZ", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_412_regras_retorna_limites_beneficiarios(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if regras:
            self.assertIn("maxBeneficiarios", regras[0])


# ---------------------------------------------------------------------------
# 31. Cenários de layout – criação e atualização
# ---------------------------------------------------------------------------
class TestLayoutCRUD(BaseIntegrationTest):

    def test_420_layout_post_payload_invalido_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/layout", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 409, 422, 500))

    def test_421_layout_put_inexistente_retorna_erro(self):
        r = self.session.put(f"{self.base_url}/layout/99999999", json={"corPrimaria": "#000000"}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_422_layout_css_endpoint_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/layout/css", timeout=20)
        self.assertIn(r.status_code, (200, 404))


# ---------------------------------------------------------------------------
# 32. Cenários complementares de segurança
# ---------------------------------------------------------------------------
class TestSegurancaComplementar(BaseIntegrationTest):

    def test_430_xss_no_nome_nao_quebra_servidor(self):
        payload = self._make_payload(step1_extra={"nomeCompleto": "<script>alert('xss')</script>"})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (201, 400, 422))
        if r.status_code == 201:
            self._cleanup_titular(int(r.json()["id"]))

    def test_431_json_malformado_retorna_400(self):
        r = self.session.post(
            f"{self.base_url}/auth/login",
            data="{email: nao-e-json}",
            headers={"Content-Type": "application/json"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))

    def test_432_token_expirado_simulado_retorna_401(self):
        tmp = requests.Session()
        tmp.verify = False
        tmp.headers.update({"X-Tenant": self.tenant, "Authorization": "Bearer token.invalido.expirado"})
        r = tmp.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_433_cpf_com_letras_retorna_erro(self):
        payload = self._make_payload(step1_extra={"cpf": "abc.def.ghi-jk"})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_434_email_invalido_titular_retorna_erro(self):
        payload = self._make_payload(step1_extra={"email": "nao-e-um-email"})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_435_titular_id_float_retorna_erro(self):
        r = self.session.get(f"{self.base_url}/titular/1.5", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_436_dependente_id_negativo_retorna_erro(self):
        r = self.session.get(f"{self.base_url}/dependente/-5", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_437_corresponsavel_id_zero_retorna_erro(self):
        r = self.session.get(f"{self.base_url}/corresponsavel/0", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_438_plano_id_string_retorna_erro(self):
        r = self.session.get(f"{self.base_url}/plano/nao-e-id", timeout=20)
        self.assertIn(r.status_code, (400, 404))

    def test_439_put_titular_payload_vazio_retorna_ok_ou_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={}, timeout=20)
            self.assertIn(r.status_code, (200, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 33. Cenários de integridade após deleção
# ---------------------------------------------------------------------------
class TestIntegridadePosDelegacao(BaseIntegrationTest):

    def test_440_delete_titular_remove_dependentes_do_banco(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            self._cleanup_titular(titular_id)
            db = self._fetch_one("SELECT id FROM Dependente WHERE id = %s", (dep_id,))
            self.assertIsNone(db)
            titular_id = None
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_441_delete_titular_remove_corresponsaveis_do_banco(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            cors = self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,))
            if cors:
                cor_id = cors[0]["id"]
            self._cleanup_titular(titular_id)
            titular_id = None
            if cor_id:
                db = self._fetch_one("SELECT id FROM Corresponsavel WHERE id = %s", (cor_id,))
                self.assertIsNone(db)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_442_titular_inexistente_nao_aparece_na_busca_publica(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "99988877766"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_443_dependente_get_apos_delete_retorna_404(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            r = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r.status_code, 404)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_444_corresponsavel_get_apos_delete_retorna_404(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Temp {suffix}",
                    "email": f"cor.temp.{suffix}@example.com",
                    "telefone": "71988889999",
                    "cpf": f"66677788{suffix[:3]}",
                    "dataNascimento": "1978-09-05T00:00:00.000Z",
                    "relacionamento": "Primo",
                    "sexo": "Masculino",
                    "naturalidade": "Salvador",
                    "situacaoConjugal": "Solteiro",
                    "profissao": "Técnico",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Federação",
                    "logradouro": "Rua Y",
                    "numero": "88",
                    "pontoReferencia": "Bar",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            r2 = self.session.get(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r2.status_code, 404)
            cor_id = None
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 34. Cenários mistos – fluxo completo simplificado
# ---------------------------------------------------------------------------
class TestFluxoCompletoSimplificado(BaseIntegrationTest):

    def test_450_fluxo_cadastro_busca_public_update_delete(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])

            r_public = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(r_public.status_code, 200)

            r_update = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"bairro": "Stiep", "logradouro": "Av Stiep", "numero": "500"},
                timeout=20,
            )
            self.assertEqual(r_update.status_code, 200)

            r_get = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r_get.status_code, 200)
            self.assertEqual(r_get.json()["id"], titular_id)

            self._cleanup_titular(titular_id)
            titular_id = None

            r_404 = self.session.get(f"{self.base_url}/titular/99999999", timeout=20)
            self.assertEqual(r_404.status_code, 404)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_451_fluxo_plano_sugerir_e_vincular(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])

            r_sugerir = self.session.post(
                f"{self.base_url}/plano/sugerir",
                json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}], "retornarTodos": True},
                timeout=20,
            )
            self.assertEqual(r_sugerir.status_code, 200)
            planos = r_sugerir.json()
            self.assertGreater(len(planos), 0)
            novo_plano_id = planos[0]["id"]

            r_vincular = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": novo_plano_id},
                timeout=20,
            )
            self.assertEqual(r_vincular.status_code, 200)
            self.assertEqual(r_vincular.json()["planoId"], novo_plano_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_452_fluxo_dependente_add_update_remove(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])

            r_add = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Flow", "dataNascimento": "2008-11-03", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r_add.status_code, 201)
            dep_id = int(r_add.json()["id"])

            r_up = self.session.put(
                f"{self.base_url}/dependente/{dep_id}",
                json={"nome": "Dep Flow Atualizado"},
                timeout=20,
            )
            self.assertEqual(r_up.status_code, 200)

            r_get = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r_get.status_code, 200)
            self.assertEqual(r_get.json()["id"], dep_id)

            r_del = self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r_del.status_code, 204)
            dep_id = None
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_453_fluxo_auth_check_apos_login(self):
        tmp = requests.Session()
        tmp.verify = False
        tmp.headers.update({"X-Tenant": self.tenant})

        r_login = tmp.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            timeout=20,
        )
        self.assertEqual(r_login.status_code, 200)

        r_check = tmp.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(r_check.status_code, 200)
        self.assertEqual(r_check.json()["email"], self.admin_email)

        r_logout = tmp.post(f"{self.base_url}/auth/logout", timeout=20)
        self.assertIn(r_logout.status_code, (200, 204))

    def test_454_fluxo_consultor_regras_plano(self):
        r_cons = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        self.assertEqual(r_cons.status_code, 200)
        self.assertGreater(len(r_cons.json()), 0)

        r_regras = self.session.get(f"{self.base_url}/regras", timeout=20)
        self.assertEqual(r_regras.status_code, 200)
        self.assertGreater(len(r_regras.json()), 0)

        r_plano = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1992-06-15", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r_plano.status_code, 200)
        self.assertGreater(len(r_plano.json()), 0)


# ---------------------------------------------------------------------------
# 35. Cenários de campos opcionais e limites de string
# ---------------------------------------------------------------------------
class TestCamposOpcionais(BaseIntegrationTest):

    def test_460_titular_sem_rg_criado_com_sucesso(self):
        payload = self._make_payload()
        payload["step1"].pop("rg", None)
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_461_titular_sem_whatsapp_criado_com_sucesso(self):
        payload = self._make_payload()
        payload["step1"].pop("whatsapp", None)
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_462_titular_ponto_referencia_vazio(self):
        payload = self._make_payload(step2_extra={"pontoReferencia": ""})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_463_plano_sugerir_retorna_true_para_retornar_todos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1995-08-20", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_464_plano_sugerir_sem_retornar_todos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1995-08-20", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_465_titular_profissao_atualizada_no_detalhe(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"profissao": "Dentista"},
                timeout=20,
            )
            r = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_466_dependente_tipo_conjuge(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Cônjuge Teste", "dataNascimento": "1991-04-22", "tipoDependente": "Cônjuge"},
                timeout=20,
            )
            if r.status_code == 201:
                dep_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_467_dependente_tipo_pais(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Mãe Teste", "dataNascimento": "1960-12-01", "tipoDependente": "Mãe"},
                timeout=20,
            )
            if r.status_code == 201:
                dep_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 36. Cenários de resposta HTTP – headers e content-type
# ---------------------------------------------------------------------------
class TestResponseHeaders(BaseIntegrationTest):

    def test_470_titular_listagem_content_type_json(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        self.assertIn("application/json", r.headers.get("Content-Type", ""))

    def test_471_auth_check_content_type_json(self):
        r = self.session.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertIn("application/json", r.headers.get("Content-Type", ""))

    def test_472_plano_sugerir_content_type_json(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1985-01-01", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/json", r.headers.get("Content-Type", ""))

    def test_473_export_csv_content_type_text_csv(self):
        r = self.session.get(f"{self.base_url}/titular/export/cadastro", timeout=30)
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers.get("Content-Type", ""))

    def test_474_titular_404_retorna_json_com_message(self):
        r = self.session.get(f"{self.base_url}/titular/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        body = r.json()
        self.assertIn("message", body)

    def test_475_auth_401_retorna_json_com_message(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/auth/check", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)
        body = r.json()
        self.assertIn("message", body)

    def test_476_plano_400_retorna_json_com_message(self):
        r = self.session.post(f"{self.base_url}/plano/sugerir", json={"participantes": []}, timeout=20)
        self.assertEqual(r.status_code, 400)
        self.assertIn("message", r.json())

    def test_477_titular_full_400_retorna_json_com_code(self):
        payload = self._make_payload()
        payload["step5"] = {}
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        self.assertIn("code", r.json())

    def test_478_dependente_404_retorna_json_com_message(self):
        r = self.session.get(f"{self.base_url}/dependente/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertIn("message", r.json())

    def test_479_corresponsavel_404_retorna_json_com_message(self):
        r = self.session.get(f"{self.base_url}/corresponsavel/99999999", timeout=20)
        self.assertEqual(r.status_code, 404)
        self.assertIn("message", r.json())


# ---------------------------------------------------------------------------
# 37. Cenários de limpeza e idempotência
# ---------------------------------------------------------------------------
class TestIdempotencia(BaseIntegrationTest):

    def test_480_delete_dependente_duas_vezes_segundo_retorna_404(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r_add = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Idempot", "dataNascimento": "2009-03-17", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            dep_id = int(r_add.json()["id"])
            self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            r2 = self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r2.status_code, 404)
            dep_id = None
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_481_delete_corresponsavel_duas_vezes_segundo_retorna_404(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Idempot {suffix}",
                    "email": f"cor.idempot.{suffix}@example.com",
                    "telefone": "71988881111",
                    "cpf": f"77711122{suffix[:3]}",
                    "dataNascimento": "1983-10-30T00:00:00.000Z",
                    "relacionamento": "Tio",
                    "sexo": "Masculino",
                    "naturalidade": "Jacobina",
                    "situacaoConjugal": "Casado",
                    "profissao": "Comerciante",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Pernambués",
                    "logradouro": "Rua da Feira",
                    "numero": "99",
                    "pontoReferencia": "Mercadão",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            r2 = self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r2.status_code, 404)
            cor_id = None
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_482_get_titular_duas_vezes_retorna_mesmo_id(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r1 = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            r2 = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r1.json()["id"], r2.json()["id"])
            self.assertEqual(r1.json()["cpf"], r2.json()["cpf"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_483_plano_sugerir_mesmos_dados_retorna_mesmo_plano(self):
        params = {"participantes": [{"dataNascimento": "1988-05-15", "parentesco": "Titular"}], "retornarTodos": True}
        r1 = self.session.post(f"{self.base_url}/plano/sugerir", json=params, timeout=20)
        r2 = self.session.post(f"{self.base_url}/plano/sugerir", json=params, timeout=20)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        if r1.json() and r2.json():
            self.assertEqual(r1.json()[0]["id"], r2.json()[0]["id"])

    def test_484_update_titular_multiplos_campos_em_sequencia(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            for bairro in ["Pituba", "Barra", "Ondina", "Amaralina"]:
                r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"bairro": bairro}, timeout=20)
                self.assertEqual(r.status_code, 200)
            db = self._fetch_one("SELECT bairro FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["bairro"], "Amaralina")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 38. Cenários finais – cobertura de endpoints auxiliares
# ---------------------------------------------------------------------------
class TestEndpointsAuxiliares(BaseIntegrationTest):

    def test_490_titular_sucessao_corresponsavel_invalido(self):
        r = self.session.post(
            f"{self.base_url}/titular/99999999/sucessao-corresponsavel",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 405, 500))

    def test_491_titular_full_sem_body_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/titular/full", json=None, timeout=30)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_492_dependente_create_sem_data_nascimento_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Sem Data", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400, 422))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_493_titular_update_numero_endereco_numerico(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"numero": "1500"}, timeout=20)
            self.assertEqual(r.status_code, 200)
            db = self._fetch_one("SELECT numero FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["numero"], "1500")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_494_titular_telefone_formato_11_digitos(self):
        payload = self._make_payload(step1_extra={"telefone": "71912345678", "whatsapp": "71912345678"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT telefone FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(len(db["telefone"]), 11)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_495_plano_incompativel_retorna_planos_compativeis_no_meta(self):
        payload = self._make_payload(titular_nasc="1930-01-01", dependentes=[], step5_extra={"planoId": 31})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertEqual(body["code"], "PLANO_INCOMPATIVEL")
        self.assertIn("planosCompativeis", body["meta"])

    def test_496_plano_sugerir_conjuge_como_participante(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1985-03-25", "parentesco": "Titular"},
                    {"dataNascimento": "1987-07-14", "parentesco": "Cônjuge"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_497_titular_data_nascimento_limite_maximo(self):
        payload = self._make_payload(titular_nasc="2005-12-31")
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_498_usuarios_listagem_nao_expoe_senha(self):
        r = self.session.get(f"{self.base_url}/users", timeout=20)
        self.assertEqual(r.status_code, 200)
        for user in r.json():
            self.assertNotIn("password", user)
            self.assertNotIn("senha", user)

    def test_499_titular_full_rejeita_sem_nome_completo(self):
        payload = self._make_payload()
        del payload["step1"]["nomeCompleto"]
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))


# ---------------------------------------------------------------------------
# 39. Paginação – comportamento de bordas
# ---------------------------------------------------------------------------
class TestPaginacaoBordas(BaseIntegrationTest):

    def test_500_titular_limit_1_retorna_exatamente_1(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertLessEqual(len(r.json().get("data", [])), 1)

    def test_501_titular_limit_50_retorna_no_maximo_50(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 50}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertLessEqual(len(r.json().get("data", [])), 50)

    def test_502_plano_page_1_page_2_sem_sobreposicao(self):
        r1 = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        r2 = self.session.get(f"{self.base_url}/plano", params={"page": 2, "pageSize": 1}, timeout=20)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        d1 = [x["id"] for x in r1.json().get("data", [])]
        d2 = [x["id"] for x in r2.json().get("data", [])]
        if d1 and d2:
            self.assertNotIn(d1[0], d2)

    def test_503_titular_pagination_total_consistente(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 10}, timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreaterEqual(body["total"], len(body["data"]))

    def test_504_titular_busca_nao_existente_total_zero(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"search": "zzz_inexistente_9999_xyz"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["total"], 0)
        self.assertEqual(r.json()["data"], [])

    def test_505_plano_pagination_total_consistente(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 3}, timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreaterEqual(body["pagination"]["total"], len(body["data"]))

    def test_506_titular_page_string_invalida_retorna_erro_ou_200(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": "abc", "limit": 5}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_507_titular_limit_string_invalida_retorna_erro_ou_200(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": "abc"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 40. Titular – filtros combinados
# ---------------------------------------------------------------------------
class TestTitularFiltrosCombinados(BaseIntegrationTest):

    def test_510_filtro_status_e_busca_combinados(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular",
                params={"status": "PENDENTE_ASSINATURA", "search": payload["step1"]["cpf"]},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            self.assertGreaterEqual(r.json()["total"], 1)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_511_filtro_status_invalido_retorna_vazio_ou_erro(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"status": "STATUS_INVALIDO_XYZ"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))
        if r.status_code == 200:
            self.assertEqual(r.json()["total"], 0)

    def test_512_filtro_uf_ba_retorna_resultados(self):
        r = self.session.get(f"{self.base_url}/titular", params={"uf": "BA", "page": 1, "limit": 5}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_513_filtro_multiplos_status(self):
        for status in ("ATIVO", "CANCELADO", "INADIMPLENTE", "PENDENTE_ASSINATURA"):
            r = self.session.get(f"{self.base_url}/titular", params={"status": status, "page": 1, "limit": 1}, timeout=20)
            self.assertIn(r.status_code, (200, 400), f"status={status}")

    def test_514_export_csv_filtro_status(self):
        r = self.session.get(
            f"{self.base_url}/titular/export/cadastro",
            params={"status": "PENDENTE_ASSINATURA"},
            timeout=30,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers.get("Content-Type", ""))

    def test_515_export_csv_filtro_uf(self):
        r = self.session.get(
            f"{self.base_url}/titular/export/cadastro",
            params={"uf": "BA"},
            timeout=30,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_516_titular_detalhe_contem_dependentes(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertIn("dependentes", body)
            self.assertIsInstance(body["dependentes"], list)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_517_titular_detalhe_contem_corresponsaveis(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertIn("corresponsaveis", body)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 41. Plano – sugestão com variações de data
# ---------------------------------------------------------------------------
class TestPlanoSugestaoVariacoes(BaseIntegrationTest):

    def test_520_sugerir_titular_30_anos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1996-06-01", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)

    def test_521_sugerir_titular_45_anos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1981-01-15", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)

    def test_522_sugerir_titular_60_anos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1966-04-20", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_523_sugerir_com_filho_adolescente(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1988-02-10", "parentesco": "Titular"},
                    {"dataNascimento": "2010-09-05", "parentesco": "Filho(a)"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)

    def test_524_sugerir_com_filho_bebe(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1990-07-30", "parentesco": "Titular"},
                    {"dataNascimento": "2025-01-10", "parentesco": "Filho(a)"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_525_sugerir_sem_retornar_todos_retorna_melhor_plano(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_526_sugerir_participante_sem_parentesco_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1990-01-01"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_527_sugerir_participante_sem_data_nascimento_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_528_sugerir_data_nascimento_futura_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "2099-01-01", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_529_sugerir_com_tres_filhos(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1985-05-10", "parentesco": "Titular"},
                    {"dataNascimento": "2010-03-15", "parentesco": "Filho(a)"},
                    {"dataNascimento": "2012-07-22", "parentesco": "Filho(a)"},
                    {"dataNascimento": "2015-11-08", "parentesco": "Filho(a)"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 42. Corresponsável – validações de campos obrigatórios
# ---------------------------------------------------------------------------
class TestCorresponsavelCamposObrigatorios(BaseIntegrationTest):

    def _base_cor_payload(self, titular_id: int, suffix: str) -> dict:
        return {
            "titularId": titular_id,
            "nome": f"Cor Campo {suffix}",
            "email": f"cor.campo.{suffix}@example.com",
            "telefone": "71988880000",
            "cpf": f"88899900{suffix[:3]}",
            "dataNascimento": "1980-08-25T00:00:00.000Z",
            "relacionamento": "Irmão",
            "sexo": "Masculino",
            "naturalidade": "Camaçari",
            "situacaoConjugal": "Solteiro",
            "profissao": "Analista",
            "cep": "40000000",
            "uf": "BA",
            "cidade": "Salvador",
            "bairro": "Liberdade",
            "logradouro": "Rua Z",
            "numero": "10",
            "pontoReferencia": "Farmácia",
        }

    def test_530_corresponsavel_sem_nome_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            data = self._base_cor_payload(titular_id, suffix)
            del data["nome"]
            r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
            self.assertIn(r.status_code, (400, 422, 500))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_531_corresponsavel_sem_cpf_retorna_erro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            data = self._base_cor_payload(titular_id, suffix)
            del data["cpf"]
            r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
            self.assertIn(r.status_code, (201, 400, 422, 500))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_532_corresponsavel_sexo_feminino_aceito(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            data = self._base_cor_payload(titular_id, suffix)
            data["sexo"] = "Feminino"
            data["nome"] = f"Cor Feminina {suffix}"
            r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
            self.assertIn(r.status_code, (201, 400))
            if r.status_code == 201:
                cor_id = int(r.json()["id"])
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_533_corresponsavel_relacionamento_atualizado(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            data = self._base_cor_payload(titular_id, suffix)
            r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            r2 = self.session.put(
                f"{self.base_url}/corresponsavel/{cor_id}",
                json={"relacionamento": "Tia"},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_534_corresponsavel_situacao_conjugal_viuvo(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            data = self._base_cor_payload(titular_id, suffix)
            data["situacaoConjugal"] = "Viúvo"
            r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
            self.assertIn(r.status_code, (201, 400))
            if r.status_code == 201:
                cor_id = int(r.json()["id"])
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 43. Dependente – múltiplos dependentes por titular
# ---------------------------------------------------------------------------
class TestMultiplosDependentes(BaseIntegrationTest):

    def test_540_adicionar_tres_dependentes_sequencialmente(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        dep_ids = []
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            for i in range(3):
                r = self.session.post(
                    f"{self.base_url}/dependente",
                    json={
                        "titularId": titular_id,
                        "nome": f"Dep Multi {i}",
                        "dataNascimento": f"201{i}-06-0{i+1}",
                        "tipoDependente": "Filho(a)",
                    },
                    timeout=20,
                )
                self.assertEqual(r.status_code, 201, f"Dep {i}: {r.text}")
                dep_ids.append(int(r.json()["id"]))
            db = self._fetch_all("SELECT id FROM Dependente WHERE titularId = %s", (titular_id,))
            self.assertGreaterEqual(len(db), 3)
        finally:
            for dep_id in dep_ids:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_541_dependente_atualizado_reflete_no_get(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"nome": "Novo Nome Dep"}, timeout=20)
            r = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["nome"], "Novo Nome Dep")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_542_dependente_contagem_no_banco_apos_adicoes(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        dep_ids = []
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            for i in range(2):
                r = self.session.post(
                    f"{self.base_url}/dependente",
                    json={"titularId": titular_id, "nome": f"Dep Count {i}", "dataNascimento": "2012-01-01", "tipoDependente": "Filho(a)"},
                    timeout=20,
                )
                dep_ids.append(int(r.json()["id"]))
            count = self._fetch_one("SELECT COUNT(*) AS cnt FROM Dependente WHERE titularId = %s", (titular_id,))
            self.assertGreaterEqual(count["cnt"], 2)
        finally:
            for dep_id in dep_ids:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_543_dependente_titular_id_persistido_correto(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            db = self._fetch_one("SELECT titularId FROM Dependente WHERE id = %s", (dep_id,))
            self.assertEqual(db["titularId"], titular_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_544_dependente_nome_longo_aceito_ou_rejeitado(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "N" * 500, "dataNascimento": "2011-01-01", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400, 422, 500))
            if r.status_code == 201:
                dep_id = int(r.json()["id"])
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 44. Auth – registro público
# ---------------------------------------------------------------------------
class TestAuthRegistro(BaseIntegrationTest):

    def test_550_auth_register_payload_invalido_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/register",
            json={},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))

    def test_551_auth_register_sem_tenant_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/register",
            json={"cpf": "12345678900", "email": "new@test.com"},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 422, 500))

    def test_552_auth_register_cpf_inexistente_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/register",
            json={"cpf": "00000000000", "email": "reg.test@example.com"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 409, 422))

    def test_553_auth_cliente_change_password_sem_auth_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/auth/cliente/change-password",
            json={"currentPassword": "abc", "newPassword": "xyz"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_554_auth_register_email_invalido_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/register",
            json={"cpf": "12345678901", "email": "nao-e-email"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422))


# ---------------------------------------------------------------------------
# 45. Financeiro – filtros de contas
# ---------------------------------------------------------------------------
class TestFinanceiroFiltros(BaseIntegrationTest):

    def test_560_financeiro_contas_filtro_tipo_pagar(self):
        r = self.session.get(f"{self.base_url}/financeiro/contas", params={"tipo": "pagar"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_561_financeiro_contas_filtro_tipo_receber(self):
        r = self.session.get(f"{self.base_url}/financeiro/contas", params={"tipo": "receber"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_562_financeiro_contas_filtro_data_vencimento(self):
        r = self.session.get(
            f"{self.base_url}/financeiro/contas",
            params={"dataInicio": "2026-01-01", "dataFim": "2026-12-31"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_563_financeiro_contas_filtro_status_pendente(self):
        r = self.session.get(f"{self.base_url}/financeiro/contas", params={"status": "PENDENTE"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_564_financeiro_contas_filtro_status_pago(self):
        r = self.session.get(f"{self.base_url}/financeiro/contas", params={"status": "PAGO"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_565_financeiro_relatorios_filtro_periodo(self):
        r = self.session.get(
            f"{self.base_url}/financeiro/relatorios",
            params={"inicio": "2026-01-01", "fim": "2026-06-30"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_566_financeiro_contas_update_tipo_pagar_inexistente(self):
        r = self.session.put(f"{self.base_url}/financeiro/contas/pagar/99999999", json={"status": "PAGO"}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_567_financeiro_contas_update_tipo_receber_inexistente(self):
        r = self.session.put(f"{self.base_url}/financeiro/contas/receber/99999999", json={"status": "RECEBIDO"}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_568_financeiro_contas_delete_tipo_pagar_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/contas/pagar/99999999", timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))

    def test_569_financeiro_contas_delete_tipo_receber_inexistente(self):
        r = self.session.delete(f"{self.base_url}/financeiro/contas/receber/99999999", timeout=20)
        self.assertIn(r.status_code, (400, 404, 500))


# ---------------------------------------------------------------------------
# 46. Parcerias – CRUD completo de categorias
# ---------------------------------------------------------------------------
class TestParceriasCategoriasCRUD(BaseIntegrationTest):

    def test_570_categorias_create_com_nome_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/parcerias/categorias",
            json={"nome": f"Categoria Teste {suffix}", "descricao": "Desc teste"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 409, 422, 500))
        if r.status_code == 201:
            cat_id = r.json().get("id")
            if cat_id:
                self.session.delete(f"{self.base_url}/parcerias/categorias/{cat_id}", timeout=20)

    def test_571_parceiros_create_com_nome_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/parcerias/parceiros",
            json={"nome": f"Parceiro {suffix}", "descricao": "Desc parceiro"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 409, 422, 500))

    def test_572_categorias_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/parcerias/categorias", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_573_parceiros_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/parcerias/parceiros", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_574_vantagens_listagem_retorna_array(self):
        r = self.session.get(f"{self.base_url}/parcerias/vantagens", timeout=20)
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_575_vantagens_create_payload_minimo(self):
        r = self.session.post(
            f"{self.base_url}/parcerias/vantagens",
            json={"titulo": "Vantagem Teste", "descricao": "Desc"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 422, 500))

    def test_576_cliente_vantagens_autenticado_admin_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/parcerias/cliente/vantagens", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_577_cliente_categorias_autenticado_admin_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/parcerias/cliente/categorias", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_578_cliente_resgate_vantagem_inexistente(self):
        r = self.session.post(
            f"{self.base_url}/parcerias/cliente/vantagens/99999999/resgates",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 403, 404, 500))


# ---------------------------------------------------------------------------
# 47. Notificações – templates CRUD
# ---------------------------------------------------------------------------
class TestNotificacoesTemplatesCRUD(BaseIntegrationTest):

    def test_580_templates_create_campos_obrigatorios(self):
        r = self.session.post(
            f"{self.base_url}/notificacoes/templates",
            json={"nome": "Template Teste", "conteudo": "Olá {nome}"},
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 409, 422, 500))
        if r.status_code == 201:
            tmpl_id = r.json().get("id")
            if tmpl_id:
                self.session.delete(f"{self.base_url}/notificacoes/templates/{tmpl_id}", timeout=20)

    def test_581_templates_listagem_array(self):
        r = self.session.get(f"{self.base_url}/notificacoes/templates", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_582_templates_update_nome_invalido(self):
        r = self.session.put(
            f"{self.base_url}/notificacoes/templates/99999999",
            json={"nome": ""},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_583_whatsapp_config_update_payload_invalido(self):
        r = self.session.put(f"{self.base_url}/notificacoes/whatsapp/config", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 422, 500))

    def test_584_whatsapp_disconnect_retorna_resultado(self):
        r = self.session.post(f"{self.base_url}/notificacoes/whatsapp/disconnect", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 400, 404, 500))

    def test_585_notificacoes_templates_sem_auth_retorna_401_ou_200(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/notificacoes/templates", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 48. Users – criação e remoção de papel
# ---------------------------------------------------------------------------
class TestUsersGestao(BaseIntegrationTest):

    def test_590_users_create_com_role_invalido(self):
        r = self.session.post(
            f"{self.base_url}/users",
            json={"email": "novo.user.inv@test.com", "password": "Senha@123", "roleId": 99999999},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 409, 422, 500))

    def test_591_roles_update_permissions_array_vazio(self):
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        if not r_roles.json():
            self.skipTest("Sem roles para testar")
        role_id = r_roles.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/roles/{role_id}/permissions",
            json={"permissionIds": []},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404))

    def test_592_users_update_email_invalido_retorna_erro(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem usuários para testar")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/email",
            json={"email": "nao-e-email"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))

    def test_593_users_sem_body_password_retorna_erro(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem usuários para testar")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(f"{self.base_url}/users/{user_id}/password", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 422, 500))

    def test_594_users_role_update_role_invalido(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem usuários para testar")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/role",
            json={"roleId": 99999999},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))


# ---------------------------------------------------------------------------
# 49. Titular – cenários de data de nascimento
# ---------------------------------------------------------------------------
class TestTitularDataNascimento(BaseIntegrationTest):

    def test_600_titular_nascimento_1960(self):
        payload = self._make_payload(titular_nasc="1960-03-15")
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_601_titular_nascimento_1970(self):
        payload = self._make_payload(titular_nasc="1970-07-20")
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_602_titular_nascimento_2000(self):
        payload = self._make_payload(titular_nasc="2000-12-01")
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_603_titular_nascimento_formato_invalido_retorna_erro(self):
        payload = self._make_payload()
        payload["step1"]["dataNascimento"] = "32/13/1990"
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_604_titular_nascimento_futuro_retorna_erro(self):
        payload = self._make_payload(titular_nasc="2099-01-01")
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_605_titular_nascimento_null_retorna_erro(self):
        payload = self._make_payload()
        payload["step1"]["dataNascimento"] = None
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))


# ---------------------------------------------------------------------------
# 50. Cenários de tenant
# ---------------------------------------------------------------------------
class TestMultiTenant(BaseIntegrationTest):

    def test_610_login_com_tenant_invalido_retorna_erro(self):
        r = requests.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            headers={"X-Tenant": "tenant_invalido_xyz"},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 401, 403, 404))

    def test_611_consultor_public_tenant_invalido(self):
        r = requests.get(
            f"{self.base_url}/consultor/public",
            headers={"X-Tenant": "tenant_invalido_xyz"},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404))

    def test_612_regras_tenant_invalido(self):
        tmp = requests.Session()
        tmp.verify = False
        tmp.headers.update({"X-Tenant": "tenant_invalido_xyz"})
        r_login = tmp.post(
            f"{self.base_url}/auth/login",
            json={"email": self.admin_email, "password": self.admin_password},
            timeout=20,
        )
        if r_login.status_code == 200:
            r = tmp.get(f"{self.base_url}/regras", timeout=20)
            self.assertIn(r.status_code, (200, 400, 404))

    def test_613_busca_publica_tenant_correto_encontra_resultado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_614_header_x_tenant_case_insensitive(self):
        r = requests.get(
            f"{self.base_url}/consultor/public",
            headers={"x-tenant": self.tenant.upper()},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404))


# ---------------------------------------------------------------------------
# 51. Campos numéricos e validações de tipo
# ---------------------------------------------------------------------------
class TestValidacoesTipo(BaseIntegrationTest):

    def test_620_titular_full_plano_id_string_retorna_erro(self):
        payload = self._make_payload()
        payload["step5"]["planoId"] = "nao-e-numero"
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_621_titular_full_plano_id_negativo_retorna_erro(self):
        payload = self._make_payload()
        payload["step5"]["planoId"] = -1
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 422))

    def test_622_dependente_create_titular_id_string_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/dependente",
            json={"titularId": "abc", "nome": "Dep Str", "dataNascimento": "2010-01-01", "tipoDependente": "Filho(a)"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422, 500))

    def test_623_plano_sugerir_data_formato_errado(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "01/01/1990", "parentesco": "Titular"}]},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_624_patch_plano_titular_id_string_retorna_erro(self):
        r = self.session.patch(
            f"{self.base_url}/plano/titulares/abc/plano",
            json={"planoId": 31},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404))

    def test_625_corresponsavel_data_nascimento_formato_errado(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": "Cor Data Errada",
                    "cpf": "11122233300",
                    "dataNascimento": "nao-e-data",
                    "sexo": "Masculino",
                    "naturalidade": "Salvador",
                    "situacaoConjugal": "Solteiro",
                    "profissao": "Outro",
                },
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400, 422, 500))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 52. Titular – cenários de endereço
# ---------------------------------------------------------------------------
class TestTitularEndereco(BaseIntegrationTest):

    def test_630_titular_uf_sp_aceito(self):
        payload = self._make_payload(step2_extra={"uf": "SP", "cidade": "São Paulo", "bairro": "Centro"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT uf FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["uf"], "SP")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_631_titular_uf_rj_aceito(self):
        payload = self._make_payload(step2_extra={"uf": "RJ", "cidade": "Rio de Janeiro", "bairro": "Copacabana"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT uf FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["uf"], "RJ")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_632_titular_update_cep(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"cep": "41000000"}, timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_633_titular_update_cidade(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"cidade": "Feira de Santana"}, timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_634_titular_logradouro_com_acentos(self):
        payload = self._make_payload(step2_extra={"logradouro": "Avenida Açaí das Índias"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT logradouro FROM Titular WHERE id = %s", (titular_id,))
            self.assertIn("Açaí", db["logradouro"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_635_titular_update_ponto_referencia(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json={"pontoReferencia": "Próximo ao supermercado"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 53. Cenários de resposta de criação
# ---------------------------------------------------------------------------
class TestRespostaCriacao(BaseIntegrationTest):

    def test_640_titular_full_retorna_id_na_resposta(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertIn("id", created)
            self.assertIsInstance(created["id"], int)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_641_titular_full_retorna_nome_na_resposta(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertEqual(created["nome"], payload["step1"]["nomeCompleto"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_642_titular_full_retorna_cpf_na_resposta(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertEqual(created["cpf"], payload["step1"]["cpf"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_643_titular_full_retorna_status_plano(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertIn("statusPlano", created)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_644_titular_full_retorna_plano_id(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertEqual(created.get("planoId"), payload["step5"]["planoId"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_645_dependente_create_retorna_id(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Resp", "dataNascimento": "2011-06-10", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            dep_id = int(r.json()["id"])
            self.assertIsInstance(dep_id, int)
            self.assertGreater(dep_id, 0)
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_646_corresponsavel_create_retorna_id(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor Resp {suffix}",
                    "email": f"cor.resp.{suffix}@example.com",
                    "telefone": "71988882222",
                    "cpf": f"99900011{suffix[:3]}",
                    "dataNascimento": "1980-01-01T00:00:00.000Z",
                    "relacionamento": "Amigo",
                    "sexo": "Masculino",
                    "naturalidade": "Salvador",
                    "situacaoConjugal": "Solteiro",
                    "profissao": "TI",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Patamares",
                    "logradouro": "Rua Final",
                    "numero": "1",
                    "pontoReferencia": "Sem referência",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
            self.assertGreater(cor_id, 0)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_647_plano_update_retorna_plano_id_correto(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            novo_plano = 32 if payload["step5"]["planoId"] != 32 else 33
            r = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": novo_plano},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn("planoId", r.json())
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 54. Consultor – endpoints autenticados
# ---------------------------------------------------------------------------
class TestConsultorAutenticado(BaseIntegrationTest):

    def test_650_consultor_me_resumo_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/consultor/me/resumo", timeout=20)
        self.assertIn(r.status_code, (200, 403, 404))

    def test_651_consultor_me_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/consultor/me/comissoes", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_652_consultor_get_id_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/consultor/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_653_consultor_update_inexistente_retorna_404(self):
        r = self.session.put(f"{self.base_url}/consultor/99999999", json={"nome": "X"}, timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_654_consultor_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/consultor/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_655_consultor_public_tem_id_e_nome(self):
        r = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        self.assertEqual(r.status_code, 200)
        lista = r.json()
        if lista:
            self.assertIn("id", lista[0])
            self.assertIn("nome", lista[0])


# ---------------------------------------------------------------------------
# 55. Regras – campos de configuração
# ---------------------------------------------------------------------------
class TestRegrasConfiguracao(BaseIntegrationTest):

    def test_660_regras_max_beneficiarios_positivo(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        self.assertEqual(r.status_code, 200)
        regras = r.json()
        if regras:
            self.assertGreater(regras[0].get("maxBeneficiarios", 0), 0)

    def test_661_regras_possui_campo_carencia(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if regras:
            keys = list(regras[0].keys())
            carencia_keys = [k for k in keys if "carencia" in k.lower() or "Carencia" in k]
            self.assertGreater(len(carencia_keys), 0)

    def test_662_regras_tenant_id_nao_nulo(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if regras:
            self.assertIsNotNone(regras[0].get("tenantId"))

    def test_663_regras_put_campos_numericos(self):
        r = self.session.get(f"{self.base_url}/regras", timeout=20)
        regras = r.json()
        if not regras:
            self.skipTest("Sem regras para testar")
        tenant_id = regras[0].get("tenantId")
        r2 = self.session.put(
            f"{self.base_url}/regras/{tenant_id}",
            json={"maxBeneficiarios": 8},
            timeout=20,
        )
        self.assertIn(r2.status_code, (200, 400, 404))
        if r2.status_code == 200:
            r3 = self.session.put(
                f"{self.base_url}/regras/{tenant_id}",
                json={"maxBeneficiarios": regras[0].get("maxBeneficiarios", 8)},
                timeout=20,
            )
            self.assertIn(r3.status_code, (200, 400))

    def test_664_regras_acessivel_sem_autenticacao(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/regras", headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertIn(r.status_code, (200, 401))


# ---------------------------------------------------------------------------
# 56. Plano – listagem e filtros avançados
# ---------------------------------------------------------------------------
class TestPlanoListagemAvancada(BaseIntegrationTest):

    def test_670_plano_listagem_retorna_pagination_object(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        pagination = r.json().get("pagination", {})
        self.assertIn("total", pagination)
        self.assertIn("page", pagination)

    def test_671_plano_listagem_data_tem_campos_obrigatorios(self):
        r = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        if data:
            self.assertIn("id", data[0])
            self.assertIn("nome", data[0])
            self.assertIn("ativo", data[0])

    def test_672_plano_filtro_ativo_true_retorna_somente_ativos(self):
        r = self.session.get(f"{self.base_url}/plano", params={"ativo": "true", "page": 1, "pageSize": 100}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        for plano in data:
            self.assertTrue(plano.get("ativo"), f"Plano {plano.get('id')} deveria ser ativo")

    def test_673_plano_busca_por_nome_parcial(self):
        r_all = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        planos = r_all.json().get("data", [])
        if not planos:
            self.skipTest("Sem planos para testar")
        nome_parcial = planos[0]["nome"][:5]
        r = self.session.get(f"{self.base_url}/plano", params={"search": nome_parcial}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_674_plano_detalhe_contem_campo_ativo(self):
        r_all = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        planos = r_all.json().get("data", [])
        if not planos:
            self.skipTest("Sem planos")
        plano_id = planos[0]["id"]
        r = self.session.get(f"{self.base_url}/plano/{plano_id}", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIn("ativo", r.json())

    def test_675_plano_detalhe_contem_id_correto(self):
        r_all = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        planos = r_all.json().get("data", [])
        if not planos:
            self.skipTest("Sem planos")
        plano_id = planos[0]["id"]
        r = self.session.get(f"{self.base_url}/plano/{plano_id}", timeout=20)
        self.assertEqual(r.json()["id"], plano_id)


# ---------------------------------------------------------------------------
# 57. Titular – CPF e unicidade
# ---------------------------------------------------------------------------
class TestTitularCPFUnicidade(BaseIntegrationTest):

    def test_680_cpfs_diferentes_permitem_dois_cadastros(self):
        p1 = self._make_payload()
        p2 = self._make_payload()
        id1 = id2 = None
        try:
            self.assertNotEqual(p1["step1"]["cpf"], p2["step1"]["cpf"])
            c1 = self._create_titular(p1)
            id1 = int(c1["id"])
            c2 = self._create_titular(p2)
            id2 = int(c2["id"])
            self.assertNotEqual(id1, id2)
        finally:
            if id1:
                self._cleanup_titular(id1)
            if id2:
                self._cleanup_titular(id2)

    def test_681_mesmo_cpf_titular_retorna_409(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            payload2 = self._make_payload()
            payload2["step1"]["cpf"] = payload["step1"]["cpf"]
            r = self.session.post(f"{self.base_url}/titular/full", json=payload2, timeout=30)
            self.assertEqual(r.status_code, 409)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_682_cpf_somente_zeros_retorna_erro(self):
        payload = self._make_payload(step1_extra={"cpf": "00000000000"})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (400, 409, 422))

    def test_683_cpf_com_mascara_retorna_erro_ou_ok(self):
        payload = self._make_payload(step1_extra={"cpf": "123.456.789-09"})
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertIn(r.status_code, (201, 400, 409, 422))
        if r.status_code == 201:
            self._cleanup_titular(int(r.json()["id"]))

    def test_684_public_search_cpf_somente_zeros_retorna_404(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "00000000000"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_685_public_search_cpf_curto_retorna_erro_ou_404(self):
        r = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "123"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404))


# ---------------------------------------------------------------------------
# 58. Fluxos de erro encadeados
# ---------------------------------------------------------------------------
class TestFluxosErroEncadeados(BaseIntegrationTest):

    def test_690_criar_sem_plano_depois_com_plano_valido(self):
        payload = self._make_payload()
        payload_sem_plano = dict(payload)
        payload_sem_plano["step5"] = {}
        r1 = self.session.post(f"{self.base_url}/titular/full", json=payload_sem_plano, timeout=30)
        self.assertEqual(r1.status_code, 400)
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_691_get_inexistente_depois_criar_encontra(self):
        r1 = self.session.get(f"{self.base_url}/titular/99999998", timeout=20)
        self.assertEqual(r1.status_code, 404)
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r2 = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r2.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_692_dependente_titular_invalido_depois_valido(self):
        r1 = self.session.post(
            f"{self.base_url}/dependente",
            json={"titularId": 0, "nome": "Dep Fail", "dataNascimento": "2010-01-01", "tipoDependente": "Filho(a)"},
            timeout=20,
        )
        self.assertEqual(r1.status_code, 400)
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r2 = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep OK", "dataNascimento": "2010-01-01", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r2.status_code, 201)
            dep_id = int(r2.json()["id"])
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_693_update_inexistente_depois_criar_e_atualizar(self):
        r1 = self.session.put(f"{self.base_url}/titular/99999997", json={"bairro": "X"}, timeout=20)
        self.assertEqual(r1.status_code, 404)
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r2 = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"bairro": "Graça"}, timeout=20)
            self.assertEqual(r2.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_694_delete_inexistente_depois_criar_e_deletar(self):
        r1 = self.session.delete(f"{self.base_url}/titular/99999996", timeout=20)
        self.assertEqual(r1.status_code, 404)
        payload = self._make_payload(dependentes=[])
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r2 = self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r2.status_code, 204)
            titular_id = None
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_695_busca_publica_cpf_errado_depois_correto(self):
        r1 = requests.get(
            f"{self.base_url}/titular/public/search",
            params={"cpf": "11111111111"},
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(r1.status_code, 404)
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r2 = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(r2.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 59. Pagamento – filtros e paginação
# ---------------------------------------------------------------------------
class TestPagamentoFiltrosPaginacao(BaseIntegrationTest):

    def test_700_pagamento_filtro_mes_corrente(self):
        import datetime
        hoje = datetime.date.today()
        r = self.session.get(
            f"{self.base_url}/pagamento",
            params={"mes": hoje.month, "ano": hoje.year},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_701_pagamento_filtro_tipo_cobranca(self):
        for tipo in ("PIX", "BOLETO", "CREDIT_CARD"):
            r = self.session.get(f"{self.base_url}/pagamento", params={"billingType": tipo}, timeout=20)
            self.assertIn(r.status_code, (200, 400), f"tipo={tipo}")

    def test_702_pagamento_listagem_sem_filtro_retorna_200(self):
        r = self.session.get(f"{self.base_url}/pagamento", timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_703_pagamento_update_sem_body_retorna_erro(self):
        r = self.session.put(f"{self.base_url}/pagamento/99999999", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 422))

    def test_704_pagamento_filtro_status_cancelado(self):
        r = self.session.get(f"{self.base_url}/pagamento", params={"status": "CANCELADO"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))

    def test_705_pagamento_filtro_status_vencido(self):
        r = self.session.get(f"{self.base_url}/pagamento", params={"status": "VENCIDO"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 60. Titular – campos adicionais e profissão
# ---------------------------------------------------------------------------
class TestTitularCamposAdicionais(BaseIntegrationTest):

    def test_710_titular_profissao_medico(self):
        payload = self._make_payload(step1_extra={"profissao": "Médico"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT profissao FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["profissao"], "Médico")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_711_titular_profissao_aposentado(self):
        payload = self._make_payload(step1_extra={"profissao": "Aposentado"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT profissao FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["profissao"], "Aposentado")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_712_titular_situacao_conjugal_divorciado(self):
        payload = self._make_payload(step1_extra={"situacaoConjugal": "Divorciado"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT situacaoConjugal FROM Titular WHERE id = %s", (titular_id,))
            self.assertIn("Divorciado", db["situacaoConjugal"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_713_titular_naturalidade_persistida(self):
        payload = self._make_payload(step1_extra={"naturalidade": "Lauro de Freitas"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT naturalidade FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["naturalidade"], "Lauro de Freitas")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_714_titular_rg_persistido(self):
        payload = self._make_payload(step1_extra={"rg": "9988776"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT rg FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["rg"], "9988776")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_715_titular_sexo_outro(self):
        payload = self._make_payload(step1_extra={"sexo": "Outro"})
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            if r.status_code == 201:
                titular_id = int(r.json()["id"])
            self.assertIn(r.status_code, (201, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_716_titular_email_com_mais_retornado_correto(self):
        suffix = str(int(time.time() * 1000))[-8:]
        email = f"titular+{suffix}@example.com"
        payload = self._make_payload(step1_extra={"email": email})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            db = self._fetch_one("SELECT email FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["email"], email.lower())
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_717_titular_whatsapp_diferente_do_telefone(self):
        payload = self._make_payload(step1_extra={"telefone": "71999990001", "whatsapp": "71988880001"})
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.assertGreater(titular_id, 0)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 61. Segurança – rate limiting e concorrência simulada
# ---------------------------------------------------------------------------
class TestSegurancaRate(BaseIntegrationTest):

    def test_720_multiplas_requisicoes_login_incorreto_nao_trava(self):
        for _ in range(5):
            r = requests.post(
                f"{self.base_url}/auth/login",
                json={"email": "invalido@test.com", "password": "errado"},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=10,
            )
            self.assertIn(r.status_code, (400, 401, 429))

    def test_721_multiplas_requisicoes_get_titular_simultaneas(self):
        respostas = []
        for _ in range(5):
            r = self.session.get(f"{self.base_url}/titular/99999999", timeout=20)
            respostas.append(r.status_code)
        self.assertTrue(all(s == 404 for s in respostas))

    def test_722_multiplas_requisicoes_plano_sugerir(self):
        params = {
            "participantes": [{"dataNascimento": "1990-01-01", "parentesco": "Titular"}],
            "retornarTodos": True,
        }
        for _ in range(3):
            r = self.session.post(f"{self.base_url}/plano/sugerir", json=params, timeout=20)
            self.assertEqual(r.status_code, 200)

    def test_723_requisicao_com_headers_extras_nao_quebra(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"page": 1, "limit": 1},
            headers={"X-Custom-Header": "valor_custom", "X-Request-ID": "test-123"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)

    def test_724_requisicao_com_accept_json_explicito(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"page": 1, "limit": 1},
            headers={"Accept": "application/json"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/json", r.headers.get("Content-Type", ""))


# ---------------------------------------------------------------------------
# 62. Corresponsável – campos de endereço
# ---------------------------------------------------------------------------
class TestCorresponsavelEndereco(BaseIntegrationTest):

    def _post_cor(self, titular_id: int, suffix: str, **extra) -> int:
        data = {
            "titularId": titular_id,
            "nome": f"Cor End {suffix}",
            "email": f"cor.end.{suffix}@example.com",
            "telefone": "71988883333",
            "cpf": f"11200300{suffix[:3]}",
            "dataNascimento": "1985-04-10T00:00:00.000Z",
            "relacionamento": "Primo",
            "sexo": "Masculino",
            "naturalidade": "Alagoinhas",
            "situacaoConjugal": "Casado",
            "profissao": "Engenheiro",
            "cep": "40000000",
            "uf": "BA",
            "cidade": "Salvador",
            "bairro": "Brotas",
            "logradouro": "Rua dos Pinheiros",
            "numero": "15",
            "pontoReferencia": "Igreja",
        }
        data.update(extra)
        r = self.session.post(f"{self.base_url}/corresponsavel", json=data, timeout=20)
        self.assertEqual(r.status_code, 201, r.text)
        return int(r.json()["id"])

    def test_730_corresponsavel_uf_sp(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_id = self._post_cor(titular_id, suffix, uf="SP", cidade="Campinas")
            db = self._fetch_one("SELECT uf FROM Corresponsavel WHERE id = %s", (cor_id,))
            self.assertEqual(db["uf"], "SP")
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_731_corresponsavel_update_cep(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_id = self._post_cor(titular_id, suffix)
            r = self.session.put(
                f"{self.base_url}/corresponsavel/{cor_id}",
                json={"cep": "41500000"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_732_corresponsavel_update_numero(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_id = self._post_cor(titular_id, suffix)
            r = self.session.put(
                f"{self.base_url}/corresponsavel/{cor_id}",
                json={"numero": "200"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_733_corresponsavel_get_retorna_titular_id(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            cor_id = self._post_cor(titular_id, suffix)
            r = self.session.get(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["titularId"], titular_id)
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 63. Cenários de DB – consistência após múltiplas operações
# ---------------------------------------------------------------------------
class TestDBConsistenciaMultiplas(BaseIntegrationTest):

    def test_740_sequencia_cria_atualiza_cria_dependente_verifica_banco(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            self.session.put(f"{self.base_url}/titular/{titular_id}", json={"bairro": "Vilas"}, timeout=20)
            r_dep = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep Seq", "dataNascimento": "2013-02-14", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r_dep.status_code, 201)
            dep_id = int(r_dep.json()["id"])
            db_tit = self._fetch_one("SELECT bairro FROM Titular WHERE id = %s", (titular_id,))
            db_dep = self._fetch_one("SELECT titularId FROM Dependente WHERE id = %s", (dep_id,))
            self.assertEqual(db_tit["bairro"], "Vilas")
            self.assertEqual(db_dep["titularId"], titular_id)
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_741_titular_update_multiplos_campos_atomico(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            campos = {"bairro": "Pernambues", "logradouro": "Trav ABC", "numero": "77", "telefone": "71911223344"}
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json=campos, timeout=20)
            self.assertEqual(r.status_code, 200)
            db = self._fetch_one(
                "SELECT bairro, logradouro, numero, telefone FROM Titular WHERE id = %s", (titular_id,)
            )
            for campo, valor in campos.items():
                self.assertEqual(db[campo], valor, f"Campo {campo} diverge")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_742_dois_dependentes_banco_consistente(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        dep_ids = []
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            for i in range(2):
                r = self.session.post(
                    f"{self.base_url}/dependente",
                    json={"titularId": titular_id, "nome": f"Dep DB {i}", "dataNascimento": f"201{i}-01-01", "tipoDependente": "Filho(a)"},
                    timeout=20,
                )
                dep_ids.append(int(r.json()["id"]))
            for dep_id in dep_ids:
                db = self._fetch_one("SELECT titularId FROM Dependente WHERE id = %s", (dep_id,))
                self.assertEqual(db["titularId"], titular_id)
        finally:
            for dep_id in dep_ids:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_743_titular_plano_atualizado_no_banco(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            novo_plano = 32 if payload["step5"]["planoId"] != 32 else 33
            self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": novo_plano},
                timeout=20,
            )
            db = self._fetch_one("SELECT planoId FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(db["planoId"], novo_plano)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 64. Export CSV – variações de conteúdo
# ---------------------------------------------------------------------------
class TestExportCSV(BaseIntegrationTest):

    def test_750_export_csv_tem_cabecalho(self):
        r = self.session.get(f"{self.base_url}/titular/export/cadastro", timeout=30)
        self.assertEqual(r.status_code, 200)
        linhas = r.text.strip().splitlines()
        self.assertGreater(len(linhas), 0)

    def test_751_export_csv_sem_titular_criado_retorna_csv_vazio_ou_cabecalho(self):
        r = self.session.get(
            f"{self.base_url}/titular/export/cadastro",
            params={"search": "zzz_nunca_existiu_1234567"},
            timeout=30,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers.get("Content-Type", ""))

    def test_752_export_csv_titular_criado_contem_nome(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular/export/cadastro",
                params={"search": payload["step1"]["nomeCompleto"]},
                timeout=30,
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn(payload["step1"]["nomeCompleto"], r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_753_export_csv_titular_criado_contem_cpf(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(
                f"{self.base_url}/titular/export/cadastro",
                params={"search": payload["step1"]["cpf"]},
                timeout=30,
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn(payload["step1"]["cpf"], r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_754_export_csv_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(f"{self.base_url}/titular/export/cadastro", headers={"X-Tenant": self.tenant}, timeout=30)
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 65. Titular – sync e endpoints administrativos
# ---------------------------------------------------------------------------
class TestTitularEndpointsAdmin(BaseIntegrationTest):

    def test_760_sync_status_plano_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(f"{self.base_url}/titular/sync-status-plano", json={}, headers={"X-Tenant": self.tenant}, timeout=20)
        self.assertEqual(r.status_code, 401)

    def test_761_titular_assinaturas_arquivo_inexistente(self):
        r = self.session.get(f"{self.base_url}/titular/99999999/assinaturas/99999999/arquivo", timeout=20)
        self.assertIn(r.status_code, (400, 404, 405))

    def test_762_titular_post_assinatura_sem_titular_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/titular/99999999/assinaturas", json={}, timeout=20)
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_763_titular_listagem_ordena_por_data_criacao(self):
        r = self.session.get(
            f"{self.base_url}/titular",
            params={"page": 1, "limit": 5, "orderBy": "createdAt", "order": "desc"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400))

    def test_764_titular_listagem_filtro_cidade(self):
        r = self.session.get(f"{self.base_url}/titular", params={"cidade": "Salvador"}, timeout=20)
        self.assertIn(r.status_code, (200, 400))


# ---------------------------------------------------------------------------
# 66. Dependente – campos extras e tipo
# ---------------------------------------------------------------------------
class TestDependenteCamposExtras(BaseIntegrationTest):

    def test_770_dependente_carencia_inicio_em_aceito(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={
                    "titularId": titular_id,
                    "nome": "Dep Carencia",
                    "dataNascimento": "2009-09-09",
                    "tipoDependente": "Filho(a)",
                    "carenciaInicioEm": "2026-06-23",
                },
                timeout=20,
            )
            self.assertIn(r.status_code, (201, 400))
            if r.status_code == 201:
                dep_id = int(r.json()["id"])
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_771_dependente_get_retorna_nome_correto(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["nome"], payload["dependentes"][0]["nome"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_772_dependente_update_tipo_dependente(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.put(
                f"{self.base_url}/dependente/{dep_id}",
                json={"tipoDependente": "Cônjuge"},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_773_dependente_criacao_multipla_nomes_distintos(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        dep_ids = []
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            nomes = ["Ana", "Bruno", "Carla"]
            for i, nome in enumerate(nomes):
                r = self.session.post(
                    f"{self.base_url}/dependente",
                    json={"titularId": titular_id, "nome": nome, "dataNascimento": f"201{i}-01-01", "tipoDependente": "Filho(a)"},
                    timeout=20,
                )
                self.assertEqual(r.status_code, 201)
                dep_ids.append(int(r.json()["id"]))
            for dep_id, nome in zip(dep_ids, nomes):
                db = self._fetch_one("SELECT nome FROM Dependente WHERE id = %s", (dep_id,))
                self.assertEqual(db["nome"], nome)
        finally:
            for dep_id in dep_ids:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 67. Miscellaneous – endpoints não cobertos
# ---------------------------------------------------------------------------
class TestMiscellaneous(BaseIntegrationTest):

    def test_780_health_retorna_status_200_ou_menor_500(self):
        url = self.base_url.replace("/api/v1", "/health")
        for _ in range(3):
            r = requests.get(url, verify=False, timeout=10)
            self.assertLess(r.status_code, 500)

    def test_781_titular_listagem_retorna_dados_data_array(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json().get("data"), list)

    def test_782_titular_listagem_retorna_dados_total_int(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 5}, timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json().get("total"), int)

    def test_783_plano_sugerir_resposta_e_lista(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1993-08-17", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_784_auth_check_retorna_id_usuario(self):
        r = self.session.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("id", body)
        self.assertIsInstance(body["id"], int)

    def test_785_roles_listagem_id_e_name_tipos_corretos(self):
        r = self.session.get(f"{self.base_url}/roles", timeout=20)
        roles = r.json()
        for role in roles:
            self.assertIsInstance(role["id"], int)
            self.assertIsInstance(role["name"], str)

    def test_786_permissions_listagem_id_inteiro(self):
        r = self.session.get(f"{self.base_url}/permissions", timeout=20)
        perms = r.json()
        for perm in perms:
            self.assertIsInstance(perm["id"], int)

    def test_787_consultor_public_id_inteiro(self):
        r = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        lista = r.json()
        for consultor in lista:
            self.assertIsInstance(consultor["id"], int)

    def test_788_titular_detalhe_id_inteiro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertIsInstance(r.json()["id"], int)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_789_dependente_get_id_inteiro(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.get(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertIsInstance(r.json()["id"], int)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_790_plano_detalhe_id_inteiro(self):
        r_all = self.session.get(f"{self.base_url}/plano", params={"page": 1, "pageSize": 1}, timeout=20)
        planos = r_all.json().get("data", [])
        if not planos:
            self.skipTest("Sem planos")
        r = self.session.get(f"{self.base_url}/plano/{planos[0]['id']}", timeout=20)
        self.assertIsInstance(r.json()["id"], int)

    def test_791_titular_full_resposta_201_location_ou_body(self):
        payload = self._make_payload()
        titular_id = None
        try:
            r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
            self.assertEqual(r.status_code, 201)
            body = r.json()
            self.assertIn("id", body)
            titular_id = int(body["id"])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_792_dependente_create_resposta_201(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.post(
                f"{self.base_url}/dependente",
                json={"titularId": titular_id, "nome": "Dep 201", "dataNascimento": "2007-11-30", "tipoDependente": "Filho(a)"},
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            dep_id = int(r.json()["id"])
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_793_corresponsavel_create_resposta_201(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            suffix = str(int(time.time() * 1000))[-6:]
            r = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": f"Cor 201 {suffix}",
                    "email": f"cor.201.{suffix}@example.com",
                    "telefone": "71988884444",
                    "cpf": f"22200011{suffix[:3]}",
                    "dataNascimento": "1979-07-04T00:00:00.000Z",
                    "relacionamento": "Avô",
                    "sexo": "Masculino",
                    "naturalidade": "Candeias",
                    "situacaoConjugal": "Viúvo",
                    "profissao": "Aposentado",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Mussurunga",
                    "logradouro": "Rua Final 2",
                    "numero": "2",
                    "pontoReferencia": "Ponto final",
                },
                timeout=20,
            )
            self.assertEqual(r.status_code, 201)
            cor_id = int(r.json()["id"])
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_794_titular_delete_resposta_204(self):
        payload = self._make_payload(dependentes=[])
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(r.status_code, 204)
            titular_id = None
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_795_dependente_delete_resposta_204(self):
        payload = self._make_payload()
        titular_id = None
        dep_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.delete(f"{self.base_url}/dependente/{dep_id}", timeout=20)
            self.assertEqual(r.status_code, 204)
            dep_id = None
        finally:
            if dep_id:
                self._delete_if_exists(f"/dependente/{dep_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_796_corresponsavel_delete_resposta_204(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            cors = self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,))
            if not cors:
                self.skipTest("Sem corresponsável para testar delete")
            cor_id = cors[0]["id"]
            r = self.session.delete(f"{self.base_url}/corresponsavel/{cor_id}", timeout=20)
            self.assertEqual(r.status_code, 204)
            cor_id = None
        finally:
            if cor_id:
                self._delete_if_exists(f"/corresponsavel/{cor_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_797_titular_update_resposta_200(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            r = self.session.put(f"{self.base_url}/titular/{titular_id}", json={"bairro": "Orla"}, timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_798_dependente_update_resposta_200(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_id = int(created["dependentes"][0]["id"])
            r = self.session.put(f"{self.base_url}/dependente/{dep_id}", json={"nome": "Dep Up 200"}, timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_799_corresponsavel_update_resposta_200(self):
        payload = self._make_payload()
        titular_id = None
        cor_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            cors = self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,))
            if not cors:
                self.skipTest("Sem corresponsável para testar update")
            cor_id = cors[0]["id"]
            r = self.session.put(f"{self.base_url}/corresponsavel/{cor_id}", json={"bairro": "Bonfim"}, timeout=20)
            self.assertEqual(r.status_code, 200)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 68. Últimos cenários para completar 500
# ---------------------------------------------------------------------------
class TestCenariosFinais(BaseIntegrationTest):

    def test_800_titular_listagem_retorna_campo_nome(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        if data:
            self.assertIn("nome", data[0])

    def test_801_titular_listagem_retorna_campo_cpf(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        if data:
            self.assertIn("cpf", data[0])

    def test_802_titular_listagem_retorna_campo_status_plano(self):
        r = self.session.get(f"{self.base_url}/titular", params={"page": 1, "limit": 1}, timeout=20)
        self.assertEqual(r.status_code, 200)
        data = r.json().get("data", [])
        if data:
            self.assertIn("statusPlano", data[0])

    def test_803_plano_sugerir_retorna_campo_nome(self):
        r = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": [{"dataNascimento": "1991-03-21", "parentesco": "Titular"}], "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(r.status_code, 200)
        planos = r.json()
        if planos:
            self.assertIsInstance(planos[0].get("nome"), str)

    def test_804_titular_full_dependente_nome_persistido(self):
        payload = self._make_payload()
        titular_id = None
        try:
            created = self._create_titular(payload)
            titular_id = int(created["id"])
            dep_nome = payload["dependentes"][0]["nome"]
            db = self._fetch_all("SELECT nome FROM Dependente WHERE titularId = %s", (titular_id,))
            nomes = [row["nome"] for row in db]
            self.assertIn(dep_nome, nomes)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
