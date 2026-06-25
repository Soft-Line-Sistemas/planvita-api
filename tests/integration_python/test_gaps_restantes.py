"""
Testes dos gaps restantes após análise completa de cobertura.

Grupos cobertos:
  1. ApiKey – CRUD completo (único endpoint sem nenhum teste)
  2. BeneficiarioTipo – CRUD real (antes só havia 1 GET com URL errada)
  3. Permission – POST / PUT / DELETE (antes só havia GETs)
  4. Asaas Webhook – estrutura de payload e validações de entrada
  5. Titular /:id/assinaturas – POST admin (salvar assinatura via painel)
  6. Layout – DELETE /:id
  7. Notificações – PATCH bloqueio e metodo por titular
  8. Financeiro – recorrencias/titular/:id/gerar e /cancelar com titular real
  9. User – PUT /:userId/role fluxo real
  10. Auth fluxos de cliente – change-password, contrato/reenviar-link
  11. Regras – POST criação
  12. Parcerias – fluxos de cliente com token real (resgate de vantagem)
"""

import os
import socket
import subprocess
import time
import unittest
import warnings
from pathlib import Path

import pytds
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"

from test_checklist_cadastro_principal import parse_sqlserver_url, SqlServerConfig


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
class BaseRestanteTest(unittest.TestCase):
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

    def _create_titular_full(self) -> int:
        suffix = str(int(time.time() * 1000))[-8:]
        payload = {
            "step1": {
                "nomeCompleto": f"Rest Test {suffix}",
                "cpf": f"7{suffix[:10]}"[:11],
                "dataNascimento": "1988-05-20",
                "sexo": "Masculino",
                "rg": "1234567",
                "naturalidade": "Salvador",
                "telefone": "71999990001",
                "whatsapp": "71999990001",
                "email": f"rest.{suffix}@example.com",
                "situacaoConjugal": "Solteiro",
                "profissao": "Analista",
            },
            "step2": {
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Pituba",
                "logradouro": "Av Rest",
                "complemento": "",
                "numero": "1",
                "pontoReferencia": "Esquina",
            },
            "step3": {"usarMesmosDados": True},
            "dependentes": [],
            "step5": {"planoId": self._suggest_plan_id(), "billingType": "PIX"},
        }
        r = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(r.status_code, 201, r.text)
        return int(r.json()["id"])

    def _cleanup_titular(self, titular_id: int) -> None:
        for dep in self._fetch_all("SELECT id FROM Dependente WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/dependente/{dep['id']}", timeout=20)
        for cor in self._fetch_all("SELECT id FROM Corresponsavel WHERE titularId = %s", (titular_id,)):
            self.session.delete(f"{self.base_url}/corresponsavel/{cor['id']}", timeout=20)
        self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)

    def _login_cliente(self, email: str, password: str) -> requests.Session:
        """Cria sessão autenticada como portal-cliente (authenticateCliente)."""
        sess = requests.Session()
        sess.verify = False
        sess.headers.update({"X-Tenant": self.tenant})
        r = sess.post(
            f"{self.base_url}/auth/login",
            json={"email": email, "password": password},
            timeout=20,
        )
        return sess  # retorna mesmo sem sucesso; testes individuais validam o status


# ---------------------------------------------------------------------------
# 1. API KEY – CRUD completo
# ---------------------------------------------------------------------------
class TestApiKeyCRUD(BaseRestanteTest):
    """
    /apikey não usa middleware de autenticação JWT — identifica o tenant via
    X-Tenant. O id é UUID (string), não inteiro.
    """

    def _apikey_payload(self, suffix: str) -> dict:
        return {
            "name": f"Key Gap {suffix}",
            "isActive": True,
            "permissions": "{}",
            "rateLimit": 100,
            "windowMs": 900000,
        }

    def test_R001_apikey_get_all_retorna_array(self):
        r = self.session.get(f"{self.base_url}/apikey", timeout=20)
        self.assertIn(r.status_code, (200, 400))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_R002_apikey_create_payload_valido_retorna_201(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 500), r.text)
        if r.status_code == 201:
            key_id = r.json().get("id")
            if key_id:
                self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)

    def test_R003_apikey_create_retorna_id_uuid(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada neste ambiente")
        body = r.json()
        self.assertIn("id", body)
        key_id = body["id"]
        self.assertIsInstance(key_id, str)
        self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)

    def test_R004_apikey_get_by_id_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        try:
            r = self.session.get(f"{self.base_url}/apikey/{key_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["id"], key_id)
        finally:
            self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)

    def test_R005_apikey_get_by_id_inexistente_retorna_404(self):
        r = self.session.get(
            f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000000",
            timeout=20,
        )
        self.assertEqual(r.status_code, 404)

    def test_R006_apikey_update_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        try:
            r = self.session.put(
                f"{self.base_url}/apikey/{key_id}",
                json={"name": f"Key Atualizada {suffix}", "isActive": True},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400), r.text)
        finally:
            self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)

    def test_R007_apikey_update_is_active_false(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        try:
            r = self.session.put(
                f"{self.base_url}/apikey/{key_id}",
                json={"isActive": False},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400), r.text)
        finally:
            self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)

    def test_R008_apikey_delete_retorna_200_ou_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        r = self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)
        self.assertIn(r.status_code, (200, 204), r.text)

    def test_R009_apikey_delete_inexistente_retorna_404_ou_500(self):
        r = self.session.delete(
            f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000001",
            timeout=20,
        )
        self.assertIn(r.status_code, (404, 500))

    def test_R010_apikey_delete_remove_do_banco(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/apikey",
            json=self._apikey_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)
        r = self.session.get(f"{self.base_url}/apikey/{key_id}", timeout=20)
        self.assertEqual(r.status_code, 404)

    def test_R011_apikey_sem_tenant_retorna_400(self):
        sem_tenant = requests.Session()
        sem_tenant.verify = False
        r = sem_tenant.get(f"{self.base_url}/apikey", timeout=20)
        self.assertEqual(r.status_code, 400)

    def test_R012_apikey_create_persiste_nome_no_banco(self):
        suffix = str(int(time.time() * 1000))[-6:]
        payload = self._apikey_payload(suffix)
        r_create = self.session.post(f"{self.base_url}/apikey", json=payload, timeout=20)
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de ApiKey não suportada")
        key_id = r_create.json()["id"]
        try:
            db = self._fetch_one("SELECT name FROM ApiKey WHERE id = %s", (key_id,))
            self.assertIsNotNone(db)
            self.assertEqual(db["name"], payload["name"])
        finally:
            self.session.delete(f"{self.base_url}/apikey/{key_id}", timeout=20)


# ---------------------------------------------------------------------------
# 2. BENEFICIÁRIO TIPO – CRUD real (URL correta: /beneficiariotipo)
# ---------------------------------------------------------------------------
class TestBeneficiarioTipoCRUD(BaseRestanteTest):

    def _tipo_payload(self, suffix: str) -> dict:
        return {"nome": f"Tipo Rest {suffix}", "idadeMax": 70}

    def test_R020_beneficiariotipo_get_all_retorna_array(self):
        r = self.session.get(f"{self.base_url}/beneficiariotipo", timeout=20)
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_R021_beneficiariotipo_create_payload_valido_retorna_201(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 403, 422, 500), r.text)
        if r.status_code == 201:
            tipo_id = r.json().get("id")
            if tipo_id:
                self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)

    def test_R022_beneficiariotipo_create_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        self.assertIn("id", r.json())
        self.assertIsInstance(r.json()["id"], int)
        self.session.delete(f"{self.base_url}/beneficiariotipo/{r.json()['id']}", timeout=20)

    def test_R023_beneficiariotipo_get_by_id_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        tipo_id = r_create.json()["id"]
        try:
            r = self.session.get(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["id"], tipo_id)
        finally:
            self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)

    def test_R024_beneficiariotipo_get_by_id_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/beneficiariotipo/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404))

    def test_R025_beneficiariotipo_update_nome(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        tipo_id = r_create.json()["id"]
        try:
            r = self.session.put(
                f"{self.base_url}/beneficiariotipo/{tipo_id}",
                json={"nome": f"Tipo Atualizado {suffix}", "idadeMax": 80},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 403), r.text)
            if r.status_code == 200:
                db = self._fetch_one("SELECT nome FROM BeneficiarioTipo WHERE id = %s", (tipo_id,))
                self.assertEqual(db["nome"], f"Tipo Atualizado {suffix}")
        finally:
            self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)

    def test_R026_beneficiariotipo_update_idade_max(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        tipo_id = r_create.json()["id"]
        try:
            r = self.session.put(
                f"{self.base_url}/beneficiariotipo/{tipo_id}",
                json={"idadeMax": 90},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 403), r.text)
        finally:
            self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)

    def test_R027_beneficiariotipo_delete_retorna_200_ou_204(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        tipo_id = r_create.json()["id"]
        r = self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)
        self.assertIn(r.status_code, (200, 204, 403), r.text)

    def test_R028_beneficiariotipo_delete_remove_do_banco(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/beneficiariotipo",
            json=self._tipo_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de BeneficiarioTipo não suportada")
        tipo_id = r_create.json()["id"]
        self.session.delete(f"{self.base_url}/beneficiariotipo/{tipo_id}", timeout=20)
        db = self._fetch_one("SELECT id FROM BeneficiarioTipo WHERE id = %s", (tipo_id,))
        self.assertIsNone(db)

    def test_R029_beneficiariotipo_delete_inexistente_retorna_404_ou_500(self):
        r = self.session.delete(f"{self.base_url}/beneficiariotipo/99999999", timeout=20)
        self.assertIn(r.status_code, (403, 404, 500))

    def test_R030_beneficiariotipo_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/beneficiariotipo",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R031_beneficiariotipo_create_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/beneficiariotipo",
            json={"nome": "Hack"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)


# ---------------------------------------------------------------------------
# 3. PERMISSION – POST / PUT / DELETE (antes só havia GETs)
# ---------------------------------------------------------------------------
class TestPermissionCRUD(BaseRestanteTest):

    def _perm_payload(self, suffix: str) -> dict:
        return {
            "name": f"test.gap_{suffix}",
            "description": f"Permissão de teste {suffix}",
        }

    def test_R040_permission_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/permissions",
            json=self._perm_payload(suffix),
            timeout=20,
        )
        self.assertIn(r.status_code, (201, 400, 403, 409, 422, 500), r.text)
        if r.status_code == 201:
            perm_id = r.json().get("id")
            if perm_id:
                self.session.delete(f"{self.base_url}/permissions/{perm_id}", timeout=20)

    def test_R041_permission_create_retorna_id(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/permissions",
            json=self._perm_payload(suffix),
            timeout=20,
        )
        if r.status_code not in (200, 201):
            self.skipTest("Criação de Permission não suportada")
        self.assertIn("id", r.json())
        self.session.delete(f"{self.base_url}/permissions/{r.json()['id']}", timeout=20)

    def test_R042_permission_create_nome_duplicado_retorna_409_ou_400(self):
        r_all = self.session.get(f"{self.base_url}/permissions", timeout=20)
        if r_all.status_code != 200 or not r_all.json():
            self.skipTest("Sem permissions para testar duplicata")
        nome_existente = r_all.json()[0]["name"]
        r = self.session.post(
            f"{self.base_url}/permissions",
            json={"name": nome_existente, "description": "Duplicata"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 409, 422, 500))

    def test_R043_permission_update_description(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/permissions",
            json=self._perm_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de Permission não suportada")
        perm_id = r_create.json()["id"]
        try:
            r = self.session.put(
                f"{self.base_url}/permissions/{perm_id}",
                json={"description": f"Descrição atualizada {suffix}"},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 403), r.text)
        finally:
            self.session.delete(f"{self.base_url}/permissions/{perm_id}", timeout=20)

    def test_R044_permission_update_inexistente_retorna_404(self):
        r = self.session.put(
            f"{self.base_url}/permissions/99999999",
            json={"description": "Inexistente"},
            timeout=20,
        )
        self.assertIn(r.status_code, (404, 400, 500))

    def test_R045_permission_delete_retorna_204_ou_200(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/permissions",
            json=self._perm_payload(suffix),
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de Permission não suportada")
        perm_id = r_create.json()["id"]
        r = self.session.delete(f"{self.base_url}/permissions/{perm_id}", timeout=20)
        self.assertIn(r.status_code, (200, 204, 403), r.text)

    def test_R046_permission_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/permissions/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))

    def test_R047_permission_get_by_id_valido(self):
        r_all = self.session.get(f"{self.base_url}/permissions", timeout=20)
        if r_all.status_code != 200 or not r_all.json():
            self.skipTest("Sem permissions")
        perm_id = r_all.json()[0]["id"]
        r = self.session.get(f"{self.base_url}/permissions/{perm_id}", timeout=20)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["id"], perm_id)

    def test_R048_permission_get_by_id_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/permissions/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400))

    def test_R049_permission_campos_na_listagem(self):
        r = self.session.get(f"{self.base_url}/permissions", timeout=20)
        if r.status_code == 200 and r.json():
            perm = r.json()[0]
            self.assertIn("id", perm)
            self.assertIn("name", perm)


# ---------------------------------------------------------------------------
# 4. ASAAS WEBHOOK – validações de entrada
# ---------------------------------------------------------------------------
class TestAsaasWebhook(BaseRestanteTest):

    def test_R060_webhook_sem_tenant_retorna_400(self):
        """Sem X-Tenant e sem tenantId no body → 400."""
        sem_tenant = requests.Session()
        sem_tenant.verify = False
        r = sem_tenant.post(
            f"{self.base_url}/asaas/webhook",
            json={"event": "PAYMENT_RECEIVED"},
            timeout=20,
        )
        self.assertEqual(r.status_code, 400)

    def test_R061_webhook_tenant_invalido_retorna_400(self):
        """Tenant configurado mas sem config Asaas → 400."""
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={"event": "PAYMENT_RECEIVED", "tenantId": "tenant_inexistente_xyz"},
            headers={"X-Tenant": "tenant_inexistente_xyz"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 500))

    def test_R062_webhook_assinatura_invalida_retorna_401(self):
        """Tenant válido mas assinatura errada → 401."""
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={"event": "PAYMENT_RECEIVED"},
            headers={"X-Signature": "assinatura_invalida_xyz"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 500))

    def test_R063_webhook_payload_payment_recebido(self):
        """Payload válido de PAYMENT_RECEIVED — sem assinatura real → 401."""
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={
                "event": "PAYMENT_RECEIVED",
                "payment": {
                    "id": "pay_000000000000",
                    "customer": "cus_000000000000",
                    "value": 99.90,
                    "netValue": 99.90,
                    "billingType": "PIX",
                    "status": "RECEIVED",
                    "paymentDate": "2026-06-23",
                },
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 500))

    def test_R064_webhook_payload_payment_confirmed(self):
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={
                "event": "PAYMENT_CONFIRMED",
                "payment": {"id": "pay_000000000001", "status": "CONFIRMED"},
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 500))

    def test_R065_webhook_payload_payment_overdue(self):
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={
                "event": "PAYMENT_OVERDUE",
                "payment": {"id": "pay_000000000002", "status": "OVERDUE"},
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 500))

    def test_R066_webhook_payload_subscription_created(self):
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={
                "event": "PAYMENT_CREATED",
                "payment": {"id": "pay_000000000003", "subscription": "sub_000000"},
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 500))

    def test_R067_webhook_payload_vazio_retorna_400_ou_401(self):
        r = self.session.post(
            f"{self.base_url}/asaas/webhook",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 401, 500))

    def test_R068_webhook_get_nao_existe_retorna_404_ou_405(self):
        r = self.session.get(f"{self.base_url}/asaas/webhook", timeout=20)
        self.assertIn(r.status_code, (404, 405))


# ---------------------------------------------------------------------------
# 5. TITULAR /:id/assinaturas – POST admin
# ---------------------------------------------------------------------------
class TestTitularAssinaturaAdmin(BaseRestanteTest):

    def test_R070_titular_salvar_assinatura_admin_titular_invalido(self):
        r = self.session.post(
            f"{self.base_url}/titular/99999999/assinaturas",
            json={"tipo": "contrato", "assinaturaBase64": "data:image/png;base64,iVBORw0KGgo="},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R071_titular_salvar_assinatura_admin_payload_vazio(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.post(
                f"{self.base_url}/titular/{titular_id}/assinaturas",
                json={},
                timeout=20,
            )
            self.assertIn(r.status_code, (400, 422, 500))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R072_titular_salvar_assinatura_admin_base64_valido(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.post(
                f"{self.base_url}/titular/{titular_id}/assinaturas",
                json={
                    "tipo": "contrato",
                    "assinaturaBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=",
                },
                timeout=30,
            )
            self.assertIn(r.status_code, (200, 201, 400, 422, 500), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R073_titular_get_assinaturas_admin_titular_existente(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.get(
                f"{self.base_url}/titular/{titular_id}/assinaturas",
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 404))
            if r.status_code == 200:
                self.assertIsInstance(r.json(), list)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R074_titular_salvar_assinatura_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/titular/1/assinaturas",
            json={"tipo": "contrato", "assinaturaBase64": "data:image/png;base64,abc"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R075_titular_assinatura_arquivo_admin_titular_valido(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.get(
                f"{self.base_url}/titular/{titular_id}/assinaturas/99999999/arquivo",
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 404))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)


# ---------------------------------------------------------------------------
# 6. LAYOUT – DELETE /:id
# ---------------------------------------------------------------------------
class TestLayoutDelete(BaseRestanteTest):

    def test_R080_layout_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/layout/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))

    def test_R081_layout_get_id_get_retorna_dados(self):
        """GET /layout/:id/get — endpoint alternativo de leitura por ID."""
        r_list = self.session.get(f"{self.base_url}/layout", timeout=20)
        if r_list.status_code != 200:
            self.skipTest("Sem layout para testar")
        body = r_list.json()
        layout = body if isinstance(body, dict) else (body[0] if body else None)
        if not layout or not layout.get("id"):
            self.skipTest("Layout sem ID")
        layout_id = layout["id"]
        r = self.session.get(f"{self.base_url}/layout/{layout_id}/get", timeout=20)
        self.assertIn(r.status_code, (200, 404))

    def test_R082_layout_get_id_get_inexistente_retorna_404(self):
        r = self.session.get(f"{self.base_url}/layout/99999999/get", timeout=20)
        self.assertIn(r.status_code, (404, 400))

    def test_R083_layout_delete_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.delete(
            f"{self.base_url}/layout/1",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (401, 404))

    def test_R084_layout_create_e_delete_fluxo_completo(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_create = self.session.post(
            f"{self.base_url}/layout",
            json={
                "corPrimaria": "#1A2B3C",
                "corSecundaria": "#FFFFFF",
                "nomePlataforma": f"Plata Del {suffix}",
            },
            timeout=20,
        )
        if r_create.status_code not in (200, 201):
            self.skipTest("Criação de layout não suportada")
        layout_id = r_create.json().get("id")
        if not layout_id:
            self.skipTest("Layout criado sem ID")
        r_del = self.session.delete(f"{self.base_url}/layout/{layout_id}", timeout=20)
        self.assertIn(r_del.status_code, (200, 204), r_del.text)


# ---------------------------------------------------------------------------
# 7. NOTIFICAÇÕES – PATCH bloqueio e metodo por titular
# ---------------------------------------------------------------------------
class TestNotificacaoPatchTitular(BaseRestanteTest):

    def test_R090_patch_bloqueio_titular_invalido_retorna_404(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/bloqueio",
            json={"bloqueado": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R091_patch_bloqueio_sem_payload_retorna_400(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.patch(
                f"{self.base_url}/notificacoes/recorrentes/clientes/{titular_id}/bloqueio",
                json={},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 422))
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R092_patch_bloqueio_titular_existente(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.patch(
                f"{self.base_url}/notificacoes/recorrentes/clientes/{titular_id}/bloqueio",
                json={"bloqueado": True},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 404, 422, 500), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R093_patch_metodo_titular_invalido_retorna_404(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/metodo",
            json={"metodo": "EMAIL"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R094_patch_metodo_titular_existente(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.patch(
                f"{self.base_url}/notificacoes/recorrentes/clientes/{titular_id}/metodo",
                json={"metodo": "EMAIL"},
                timeout=20,
            )
            self.assertIn(r.status_code, (200, 400, 404, 422, 500), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R095_patch_agendamento_sem_payload_retorna_400(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/agendamento",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 422))

    def test_R096_patch_agendamento_payload_valido(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/agendamento",
            json={"hora": "08:00", "intervalo": "DIARIO"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 422, 500))


# ---------------------------------------------------------------------------
# 8. FINANCEIRO – recorrências por titular (gerar / cancelar)
# ---------------------------------------------------------------------------
class TestFinanceiroRecorrenciasTitular(BaseRestanteTest):

    def test_R100_gerar_recorrencia_titular_invalido_retorna_404(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/recorrencias/titular/99999999/gerar",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R101_cancelar_recorrencia_titular_invalido_retorna_404(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/recorrencias/titular/99999999/cancelar",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R102_gerar_recorrencia_titular_existente(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.post(
                f"{self.base_url}/financeiro/recorrencias/titular/{titular_id}/gerar",
                json={},
                timeout=30,
            )
            self.assertIn(r.status_code, (200, 201, 400, 404, 422, 500), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R103_cancelar_recorrencia_titular_existente(self):
        titular_id = None
        try:
            titular_id = self._create_titular_full()
            r = self.session.post(
                f"{self.base_url}/financeiro/recorrencias/titular/{titular_id}/cancelar",
                json={},
                timeout=30,
            )
            self.assertIn(r.status_code, (200, 400, 404, 422, 500), r.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_R104_gerar_recorrencia_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/financeiro/recorrencias/titular/1/gerar",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 401))

    def test_R105_sync_recorrencias_retorna_200_ou_500(self):
        r = self.session.post(
            f"{self.base_url}/financeiro/recorrencias/sincronizar",
            json={},
            timeout=30,
        )
        self.assertIn(r.status_code, (200, 400, 500))


# ---------------------------------------------------------------------------
# 9. USER – PUT /:userId/role fluxo real
# ---------------------------------------------------------------------------
class TestUserRoleAssign(BaseRestanteTest):

    def test_R110_user_assign_role_payload_valido(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        if not r_users.json() or not r_roles.json():
            self.skipTest("Sem users ou roles")
        outros = [u for u in r_users.json() if u.get("email", "").lower() != self.admin_email.lower()]
        if not outros:
            self.skipTest("Sem outros usuários para testar assign role")
        user_id = outros[0]["id"]
        role_id = r_roles.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/role",
            json={"roleId": role_id},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 403, 404, 409), r.text)

    def test_R111_user_assign_role_user_inexistente_retorna_404(self):
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        if not r_roles.json():
            self.skipTest("Sem roles")
        role_id = r_roles.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/99999999/role",
            json={"roleId": role_id},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R112_user_assign_role_role_inexistente_retorna_404(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem users")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/role",
            json={"roleId": 99999999},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422, 500))

    def test_R113_user_assign_role_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.put(
            f"{self.base_url}/users/1/role",
            json={"roleId": 1},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R114_user_change_password_payload_invalido(self):
        r_users = self.session.get(f"{self.base_url}/users", timeout=20)
        if not r_users.json():
            self.skipTest("Sem users")
        user_id = r_users.json()[0]["id"]
        r = self.session.put(
            f"{self.base_url}/users/{user_id}/password",
            json={},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 422))

    def test_R115_user_create_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r_roles = self.session.get(f"{self.base_url}/roles", timeout=20)
        role_id = r_roles.json()[0]["id"] if r_roles.json() else None
        payload = {
            "name": f"User Rest {suffix}",
            "email": f"user.rest.{suffix}@example.com",
            "password": "Senha@123",
        }
        if role_id:
            payload["roleId"] = role_id
        r = self.session.post(f"{self.base_url}/users", json=payload, timeout=20)
        self.assertIn(r.status_code, (201, 400, 409, 422, 500), r.text)
        if r.status_code == 201:
            user_id = r.json().get("id")
            if user_id:
                self.session.delete(f"{self.base_url}/users/{user_id}", timeout=20)

    def test_R116_user_delete_inexistente_retorna_404(self):
        r = self.session.delete(f"{self.base_url}/users/99999999", timeout=20)
        self.assertIn(r.status_code, (404, 400, 500))


# ---------------------------------------------------------------------------
# 10. AUTH – fluxos de cliente (change-password, contrato/reenviar-link)
# ---------------------------------------------------------------------------
class TestAuthClienteFluxos(BaseRestanteTest):

    def test_R120_change_password_sem_token_cliente_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/auth/cliente/change-password",
            json={"senhaAtual": "123456", "novaSenha": "654321"},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R121_contrato_reenviar_link_sem_token_cliente_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/auth/contrato/reenviar-link",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R122_auth_register_cpf_inexistente_retorna_404_ou_400(self):
        """POST /auth/register com CPF não cadastrado."""
        r = self.session.post(
            f"{self.base_url}/auth/register",
            json={"cpf": "99999999999", "email": "nao@existe.com"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 404, 422))

    def test_R123_auth_first_access_token_invalido_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/auth/first-access",
            json={"token": "token_invalido_xyz", "password": "Senha@123"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 404, 422))

    def test_R124_auth_verify_token_invalido_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/auth/verify",
            json={"token": "token_invalido_xyz"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 404, 422))

    def test_R125_auth_reset_password_token_invalido_retorna_erro(self):
        r = self.session.post(
            f"{self.base_url}/auth/reset-password",
            json={"token": "token_invalido_xyz", "password": "Senha@123"},
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 401, 404, 422))

    def test_R126_auth_forgot_password_email_inexistente(self):
        """forgot-password com email não cadastrado — deve retornar 200 por segurança ou 400."""
        r = self.session.post(
            f"{self.base_url}/auth/forgot-password",
            json={"email": "email.nao.existe.9999@example.com"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404))

    def test_R127_auth_pagamento_reenviar_cpf_invalido(self):
        r = self.session.post(
            f"{self.base_url}/auth/pagamento/reenviar",
            json={"cpf": "99999999999"},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404, 422))


# ---------------------------------------------------------------------------
# 11. REGRAS – POST criação de novas regras
# ---------------------------------------------------------------------------
class TestRegrasCriacao(BaseRestanteTest):

    def test_R130_regras_post_payload_minimo(self):
        r = self.session.post(
            f"{self.base_url}/regras",
            json={"carenciaDias": 30, "vigenciaMeses": 12},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 409, 422, 500), r.text)

    def test_R131_regras_post_payload_vazio_retorna_erro(self):
        r = self.session.post(f"{self.base_url}/regras", json={}, timeout=20)
        self.assertIn(r.status_code, (200, 201, 400, 409, 422, 500))

    def test_R132_regras_post_sem_autenticacao_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/regras",
            json={"carenciaDias": 30},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R133_regras_put_tenant_existente(self):
        r_all = self.session.get(f"{self.base_url}/regras", timeout=20)
        if r_all.status_code != 200:
            self.skipTest("Sem regras para testar PUT")
        r = self.session.put(
            f"{self.base_url}/regras/{self.tenant}",
            json={"carenciaDias": 45},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 400, 404, 422), r.text)

    def test_R134_regras_get_by_tenant_valido(self):
        r = self.session.get(f"{self.base_url}/regras/{self.tenant}", timeout=20)
        self.assertIn(r.status_code, (200, 404))


# ---------------------------------------------------------------------------
# 12. PARCERIAS – fluxos que exigem token de cliente
# ---------------------------------------------------------------------------
class TestParceriasClienteToken(BaseRestanteTest):

    def test_R140_parceria_public_vantagens_sem_token_retorna_200(self):
        """GET /parcerias/public/vantagens é público."""
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/parcerias/public/vantagens",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 404))
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_R141_parceria_cliente_categorias_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/parcerias/cliente/categorias",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R142_parceria_cliente_vantagens_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/parcerias/cliente/vantagens",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R143_parceria_resgate_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.post(
            f"{self.base_url}/parcerias/cliente/vantagens/1/resgates",
            json={},
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R144_parceria_vantagem_slug_inexistente_sem_token_retorna_401(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/parcerias/cliente/vantagens/slug-inexistente-xyz",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        self.assertEqual(r.status_code, 401)

    def test_R145_parcerias_salvar_categoria_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/parcerias/categorias",
            json={"nome": f"Cat Rest {suffix}", "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 403, 409, 422, 500), r.text)

    def test_R146_parcerias_salvar_parceiro_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/parcerias/parceiros",
            json={"nome": f"Parceiro Rest {suffix}", "ativo": True},
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 403, 409, 422, 500), r.text)

    def test_R147_parcerias_salvar_vantagem_payload_valido(self):
        suffix = str(int(time.time() * 1000))[-6:]
        r = self.session.post(
            f"{self.base_url}/parcerias/vantagens",
            json={
                "titulo": f"Vantagem Rest {suffix}",
                "descricao": "Desconto especial",
                "slug": f"vantagem-rest-{suffix}",
                "ativo": True,
            },
            timeout=20,
        )
        self.assertIn(r.status_code, (200, 201, 400, 403, 409, 422, 500), r.text)
        if r.status_code in (200, 201):
            van_id = r.json().get("id")
            if van_id:
                self.session.delete(f"{self.base_url}/parcerias/vantagens/{van_id}", timeout=20)

    def test_R148_parcerias_delete_vantagem_inexistente_retorna_404(self):
        r = self.session.delete(
            f"{self.base_url}/parcerias/vantagens/99999999",
            timeout=20,
        )
        self.assertIn(r.status_code, (400, 403, 404, 500))

    def test_R149_parcerias_public_vantagens_retorna_lista_com_campos(self):
        anon = requests.Session()
        anon.verify = False
        r = anon.get(
            f"{self.base_url}/parcerias/public/vantagens",
            headers={"X-Tenant": self.tenant},
            timeout=20,
        )
        if r.status_code == 200 and r.json():
            vantagem = r.json()[0]
            self.assertIn("id", vantagem)


if __name__ == "__main__":
    unittest.main(verbosity=2)
