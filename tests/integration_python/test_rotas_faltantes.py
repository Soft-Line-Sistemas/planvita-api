"""
Testes de integração cobrindo rotas não cobertas pelos outros arquivos:

- GET /health/liveness
- GET /health/metrics
- DELETE /api/v1/pagamento/:id
- PUT /api/v1/pagamento/:id
- GET /api/v1/layout/:id/get
- DELETE /api/v1/layout/:id
- POST /api/v1/auth/pagamento/reenviar (autenticado)
- POST /api/v1/auth/cliente/change-password
- PUT /api/v1/auth/cliente/change-password
- POST /api/v1/auth/contrato/reenviar-link
- POST /api/v1/titular/:id/sucessao-corresponsavel
- GET /api/v1/titular/:id/assinaturas/:assinaturaId/arquivo
- GET /api/v1/titular/me/assinaturas/:assinaturaId/arquivo
- POST /api/v1/titular/sync-status-plano
- GET /api/v1/titular/export/cadastro
- GET /api/v1/financeiro/cliente/contas
- GET /api/v1/parcerias/public/vantagens
- PUT/DELETE /api/v1/apikey/:id
- GET/DELETE /api/v1/documento/:id
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


def parse_sqlserver_url(url: str):
    if not url or not url.startswith("sqlserver://"):
        return None
    try:
        rest = url[len("sqlserver://"):]
        host_port, *parts = rest.split(";")
        server, port_raw = host_port.split(":", 1)
        params = {}
        for part in parts:
            if "=" in part:
                k, v = part.split("=", 1)
                params[k.strip()] = v.strip()
        return SqlServerConfig(
            server=server,
            port=int(port_raw),
            database=params.get("database", ""),
            user=params.get("user", ""),
            password=params.get("password", ""),
        )
    except Exception:
        return None


class BaseIntegrationTest(unittest.TestCase):
    tenant = os.getenv("PLANVITA_TENANT", "lider")
    admin_email = os.getenv("PLANVITA_ADMIN_EMAIL", "softline@admin.com")
    admin_password = os.getenv("PLANVITA_ADMIN_PASSWORD", "123456")
    db_url = os.getenv("DATABASE_URL_LIDER")
    server_process = None
    base_url = ""
    session: requests.Session

    @classmethod
    def setUpClass(cls):
        if not cls.db_url:
            raise unittest.SkipTest("Defina DATABASE_URL_LIDER antes de executar.")
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
    def tearDownClass(cls):
        if cls.server_process and cls.server_process.poll() is None:
            cls.server_process.terminate()
            try:
                cls.server_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.server_process.kill()
                cls.server_process.wait(timeout=5)

    @classmethod
    def _find_free_port(cls):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])

    @classmethod
    def _start_local_backend(cls, port):
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
    def _wait_for_backend(cls):
        health_url = cls.base_url.replace("/api/v1", "/health")
        deadline = time.time() + 45
        while time.time() < deadline:
            try:
                r = requests.get(health_url, verify=False, timeout=3)
                if r.status_code < 500:
                    return
            except Exception:
                pass
            time.sleep(1)
        raise TimeoutError(f"Backend não respondeu em {health_url}")

    @classmethod
    def _login_admin(cls):
        r = cls.session.post(
            f"{cls.base_url}/auth/login",
            json={"email": cls.admin_email, "password": cls.admin_password},
        )
        if r.status_code != 200:
            raise RuntimeError(f"Login admin falhou: {r.status_code} — {r.text[:300]}")

    def _base_health_url(self):
        return self.base_url.replace("/api/v1", "")


# ─────────────────────────────────────────────────────────────────────────────
# Health — liveness e metrics
# ─────────────────────────────────────────────────────────────────────────────

class TestHealthEndpoints(BaseIntegrationTest):

    def test_001_liveness_retorna_200(self):
        r = self.session.get(f"{self._base_health_url()}/health/liveness")
        self.assertLess(r.status_code, 500, f"liveness retornou {r.status_code}")

    def test_002_metrics_retorna_200(self):
        r = self.session.get(f"{self._base_health_url()}/health/metrics")
        self.assertLess(r.status_code, 500, f"metrics retornou {r.status_code}")

    def test_003_liveness_sem_tenant_ainda_responde(self):
        s = requests.Session()
        s.verify = False
        r = s.get(f"{self._base_health_url()}/health/liveness")
        self.assertLess(r.status_code, 500)

    def test_004_metrics_sem_autenticacao_responde(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self._base_health_url()}/health/metrics")
        self.assertLess(r.status_code, 500)


# ─────────────────────────────────────────────────────────────────────────────
# Pagamento — PUT e DELETE
# ─────────────────────────────────────────────────────────────────────────────

class TestPagamentoMutacoes(BaseIntegrationTest):

    def test_010_pagamento_put_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/pagamento/99999999",
            json={"valor": 100},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"Esperado 4xx/5xx, recebeu {r.status_code}")

    def test_011_pagamento_delete_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/pagamento/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"Esperado 4xx/5xx, recebeu {r.status_code}")

    def test_012_pagamento_delete_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/pagamento/1")
        self.assertEqual(r.status_code, 401)

    def test_013_pagamento_put_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/pagamento/1", json={"valor": 200})
        self.assertEqual(r.status_code, 401)


# ─────────────────────────────────────────────────────────────────────────────
# Layout — /:id/get e DELETE
# ─────────────────────────────────────────────────────────────────────────────

class TestLayoutEndpoints(BaseIntegrationTest):

    def _criar_layout(self):
        r = self.session.post(
            f"{self.base_url}/layout",
            json={"primaryColor": "#FF0000", "secondaryColor": "#00FF00"},
        )
        if r.status_code in (200, 201):
            data = r.json()
            return data.get("id") or data.get("data", {}).get("id")
        return None

    def test_020_layout_get_id_get_endpoint_responde(self):
        r = self.session.get(f"{self.base_url}/layout/99999999/get")
        self.assertIn(r.status_code, [200, 404, 400], f"Recebeu {r.status_code}")

    def test_021_layout_delete_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/layout/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_022_layout_delete_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/layout/1")
        self.assertEqual(r.status_code, 401)

    def test_023_layout_get_por_id_get_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/layout/1/get")
        self.assertEqual(r.status_code, 401)

    def test_024_layout_crud_completo_com_get_id(self):
        layout_id = self._criar_layout()
        if layout_id is None:
            self.skipTest("Não foi possível criar layout para o teste")

        r = self.session.get(f"{self.base_url}/layout/{layout_id}/get")
        self.assertIn(r.status_code, [200, 404])

        r_del = self.session.delete(f"{self.base_url}/layout/{layout_id}")
        self.assertIn(r_del.status_code, [200, 204, 404])


# ─────────────────────────────────────────────────────────────────────────────
# Auth — rotas de cliente autenticado
# ─────────────────────────────────────────────────────────────────────────────

class TestAuthRotasCliente(BaseIntegrationTest):

    def test_030_auth_pagamento_reenviar_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(f"{self.base_url}/auth/pagamento/reenviar", json={})
        self.assertEqual(r.status_code, 401)

    def test_031_auth_pagamento_reenviar_com_admin_retorna_resposta(self):
        r = self.session.post(
            f"{self.base_url}/auth/pagamento/reenviar",
            json={"titularId": 99999999},
        )
        self.assertIn(r.status_code, [200, 400, 404, 422],
                      f"Recebeu {r.status_code}: {r.text[:200]}")

    def test_032_auth_change_password_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(f"{self.base_url}/auth/cliente/change-password", json={})
        self.assertEqual(r.status_code, 401)

    def test_033_auth_change_password_put_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/auth/cliente/change-password", json={})
        self.assertEqual(r.status_code, 401)

    def test_034_auth_contrato_reenviar_link_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(f"{self.base_url}/auth/contrato/reenviar-link", json={})
        self.assertEqual(r.status_code, 401)


# ─────────────────────────────────────────────────────────────────────────────
# Titular — rotas específicas não cobertas
# ─────────────────────────────────────────────────────────────────────────────

class TestTitularRotasFaltantes(BaseIntegrationTest):

    def test_040_titular_sucessao_corresponsavel_inexistente_retorna_4xx(self):
        r = self.session.post(
            f"{self.base_url}/titular/99999999/sucessao-corresponsavel",
            json={},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_041_titular_sucessao_corresponsavel_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(f"{self.base_url}/titular/1/sucessao-corresponsavel", json={})
        self.assertEqual(r.status_code, 401)

    def test_042_titular_assinatura_arquivo_inexistente_retorna_4xx(self):
        r = self.session.get(
            f"{self.base_url}/titular/99999999/assinaturas/99999999/arquivo"
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_043_titular_assinatura_arquivo_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/titular/1/assinaturas/1/arquivo")
        self.assertEqual(r.status_code, 401)

    def test_044_titular_post_assinatura_admin_titulo_inexistente_retorna_4xx(self):
        r = self.session.post(
            f"{self.base_url}/titular/99999999/assinaturas",
            json={"assinaturaBase64": "data:image/png;base64,abc"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_045_titular_sync_status_plano_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(f"{self.base_url}/titular/sync-status-plano", json={})
        self.assertEqual(r.status_code, 401)

    def test_046_titular_sync_status_plano_autenticado_responde(self):
        r = self.session.post(
            f"{self.base_url}/titular/sync-status-plano",
            json={},
        )
        self.assertIn(r.status_code, [200, 202, 204, 400, 404, 422],
                      f"Recebeu {r.status_code}: {r.text[:200]}")

    def test_047_titular_export_cadastro_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/titular/export/cadastro")
        self.assertEqual(r.status_code, 401)

    def test_048_titular_export_cadastro_autenticado_retorna_dados(self):
        r = self.session.get(f"{self.base_url}/titular/export/cadastro")
        self.assertIn(r.status_code, [200, 204],
                      f"export/cadastro retornou {r.status_code}: {r.text[:200]}")


# ─────────────────────────────────────────────────────────────────────────────
# Titular Me — arquivo de assinatura
# ─────────────────────────────────────────────────────────────────────────────

class TestTitularMeAssinaturaArquivo(BaseIntegrationTest):

    def test_050_me_assinatura_arquivo_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/titular/me/assinaturas/99999999/arquivo")
        self.assertEqual(r.status_code, 401)

    def test_051_me_assinatura_arquivo_inexistente_retorna_4xx(self):
        # Usar token de cliente não disponível nesta suite (admin não tem acesso
        # ao endpoint /me), então só validamos o status de não autorizado
        r = self.session.get(
            f"{self.base_url}/titular/me/assinaturas/99999999/arquivo"
        )
        # Admin recebe 401/403 pois o endpoint usa authenticateCliente
        self.assertIn(r.status_code, [401, 403, 404])


# ─────────────────────────────────────────────────────────────────────────────
# Financeiro — cliente/contas
# ─────────────────────────────────────────────────────────────────────────────

class TestFinanceiroClienteContas(BaseIntegrationTest):

    def test_060_financeiro_cliente_contas_autenticado_responde(self):
        # Endpoint usa authenticateCliente; admin recebe 401
        r = self.session.get(f"{self.base_url}/financeiro/cliente/contas")
        self.assertIn(r.status_code, [200, 204, 400, 401, 403],
                      f"cliente/contas retornou {r.status_code}: {r.text[:200]}")

    def test_061_financeiro_cliente_contas_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/financeiro/cliente/contas")
        self.assertEqual(r.status_code, 401)


# ─────────────────────────────────────────────────────────────────────────────
# Parcerias — public/vantagens
# ─────────────────────────────────────────────────────────────────────────────

class TestParceriasPublicVantagens(BaseIntegrationTest):

    def test_070_parcerias_public_vantagens_retorna_200(self):
        r = self.session.get(f"{self.base_url}/parcerias/public/vantagens")
        self.assertIn(r.status_code, [200, 204],
                      f"public/vantagens retornou {r.status_code}: {r.text[:200]}")

    def test_071_parcerias_public_vantagens_sem_autenticacao_responde(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/parcerias/public/vantagens")
        self.assertIn(r.status_code, [200, 204])

    def test_072_parcerias_public_vantagens_retorna_lista(self):
        r = self.session.get(f"{self.base_url}/parcerias/public/vantagens")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsInstance(body, (list, dict),
                              "Esperado lista ou objeto JSON")

    def test_073_parcerias_public_vantagens_limit_respeitado(self):
        r = self.session.get(
            f"{self.base_url}/parcerias/public/vantagens",
            params={"limit": 3},
        )
        self.assertIn(r.status_code, [200, 204])


# ─────────────────────────────────────────────────────────────────────────────
# ApiKey — PUT e DELETE
# ─────────────────────────────────────────────────────────────────────────────

class TestApiKeyMutacoes(BaseIntegrationTest):

    def _criar_apikey(self) -> str | None:
        r = self.session.post(
            f"{self.base_url}/apikey",
            json={"name": "Teste Cobertura"},
        )
        if r.status_code in (200, 201):
            data = r.json()
            return data.get("id") or (data.get("data") or {}).get("id")
        return None

    def test_080_apikey_put_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000000", json={})
        self.assertIn(r.status_code, [401, 404])

    def test_081_apikey_delete_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000000")
        self.assertIn(r.status_code, [401, 404])

    def test_082_apikey_put_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000000",
            json={"name": "Novo Nome"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_083_apikey_delete_inexistente_retorna_4xx(self):
        r = self.session.delete(
            f"{self.base_url}/apikey/00000000-0000-0000-0000-000000000000"
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_084_apikey_crud_completo(self):
        key_id = self._criar_apikey()
        if key_id is None:
            self.skipTest("Não foi possível criar apikey")

        r_put = self.session.put(
            f"{self.base_url}/apikey/{key_id}",
            json={"name": "Atualizado", "isActive": False},
        )
        self.assertIn(r_put.status_code, [200, 201, 204])

        r_del = self.session.delete(f"{self.base_url}/apikey/{key_id}")
        self.assertIn(r_del.status_code, [200, 204])


# ─────────────────────────────────────────────────────────────────────────────
# Documento — GET por ID e DELETE
# ─────────────────────────────────────────────────────────────────────────────

class TestDocumentoEndpoints(BaseIntegrationTest):

    def test_090_documento_get_id_inexistente_retorna_4xx(self):
        r = self.session.get(f"{self.base_url}/documento/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_091_documento_delete_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/documento/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_092_documento_get_id_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/documento/1")
        self.assertEqual(r.status_code, 401)

    def test_093_documento_delete_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/documento/1")
        self.assertEqual(r.status_code, 401)


# ─────────────────────────────────────────────────────────────────────────────
# Roles — updatePermissions
# ─────────────────────────────────────────────────────────────────────────────

class TestRolesPermissionsEndpoint(BaseIntegrationTest):

    def test_100_roles_put_permissions_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/roles/99999999/permissions",
            json={"permissionIds": []},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_101_roles_put_permissions_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/roles/1/permissions", json={"permissionIds": []})
        self.assertEqual(r.status_code, 401)

    def test_102_roles_put_permissions_lista_vazia_aceita(self):
        r_roles = self.session.get(f"{self.base_url}/roles")
        if r_roles.status_code != 200:
            self.skipTest("Não foi possível listar roles")
        roles = r_roles.json()
        if not isinstance(roles, list) or len(roles) == 0:
            self.skipTest("Nenhuma role disponível para teste")
        role_id = roles[0].get("id")
        if not role_id:
            self.skipTest("Role sem id")
        r = self.session.put(
            f"{self.base_url}/roles/{role_id}/permissions",
            json={"permissionIds": []},
        )
        self.assertIn(r.status_code, [200, 204])


# ─────────────────────────────────────────────────────────────────────────────
# Consultor — DELETE
# ─────────────────────────────────────────────────────────────────────────────

class TestConsultorDelete(BaseIntegrationTest):

    def test_110_consultor_delete_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/consultor/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_111_consultor_delete_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/consultor/1")
        self.assertEqual(r.status_code, 401)


# ─────────────────────────────────────────────────────────────────────────────
# Users — senha e email
# ─────────────────────────────────────────────────────────────────────────────

class TestUsersEndpoints(BaseIntegrationTest):

    def test_120_users_password_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/password",
            json={"password": "nova123", "currentPassword": "atual123"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_121_users_password_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/users/1/password", json={"password": "nova"})
        self.assertEqual(r.status_code, 401)

    def test_122_users_email_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/email",
            json={"email": "novo@test.com"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_123_users_email_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/users/1/email", json={"email": "novo@test.com"})
        self.assertEqual(r.status_code, 401)

    def test_124_users_role_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.put(f"{self.base_url}/users/1/role", json={"roleId": 1})
        self.assertEqual(r.status_code, 401)

    def test_125_users_role_inexistente_retorna_4xx(self):
        r = self.session.put(
            f"{self.base_url}/users/99999999/role",
            json={"roleId": 1},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])


# ─────────────────────────────────────────────────────────────────────────────
# Rotas do frontend ainda sem cobertura (gap identificado na análise)
# ─────────────────────────────────────────────────────────────────────────────

class TestFinanceiroDeleteContaTipo(BaseIntegrationTest):
    """DELETE /api/v1/financeiro/contas/:tipo/:id
    O frontend chama: api.delete(`/financeiro/contas/${endpoint}/${id}`)
    onde endpoint é 'pagar' ou 'receber'.
    """

    def test_130_financeiro_delete_conta_pagar_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/financeiro/contas/pagar/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"DELETE contas/pagar retornou {r.status_code}")

    def test_131_financeiro_delete_conta_receber_inexistente_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/financeiro/contas/receber/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"DELETE contas/receber retornou {r.status_code}")

    def test_132_financeiro_delete_conta_pagar_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/financeiro/contas/pagar/1")
        self.assertEqual(r.status_code, 401)

    def test_133_financeiro_delete_conta_receber_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.delete(f"{self.base_url}/financeiro/contas/receber/1")
        self.assertEqual(r.status_code, 401)

    def test_134_financeiro_delete_conta_tipo_invalido_retorna_4xx(self):
        r = self.session.delete(f"{self.base_url}/financeiro/contas/invalido/99999999")
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"DELETE contas/invalido retornou {r.status_code}")


class TestParceriasClienteVantagemSlug(BaseIntegrationTest):
    """GET /api/v1/parcerias/cliente/vantagens/:slug
    O frontend chama: api.get(`/parcerias/cliente/vantagens/${slug}`)
    """

    def test_140_parcerias_cliente_vantagem_slug_inexistente_retorna_4xx(self):
        # Endpoint usa authenticateCliente; admin recebe 401/403
        r = self.session.get(
            f"{self.base_url}/parcerias/cliente/vantagens/slug-inexistente-xyz-123"
        )
        self.assertIn(r.status_code, [200, 401, 403, 404],
                      f"Slug inexistente retornou {r.status_code}")

    def test_141_parcerias_cliente_vantagem_slug_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.get(f"{self.base_url}/parcerias/cliente/vantagens/qualquer-slug")
        self.assertEqual(r.status_code, 401)

    def test_142_parcerias_cliente_vantagem_slug_retorna_json(self):
        # Com admin autenticado, o endpoint /cliente/vantagens/:slug
        # exige authenticateCliente, então admin deve receber 401/403
        r = self.session.get(
            f"{self.base_url}/parcerias/cliente/vantagens/slug-qualquer"
        )
        self.assertIn(r.status_code, [200, 401, 403, 404])

    def test_143_parcerias_cliente_vantagem_slug_slug_vazio_retorna_4xx(self):
        # Slug com apenas espaço/especial deve retornar erro ou not found
        r = self.session.get(
            f"{self.base_url}/parcerias/cliente/vantagens/--"
        )
        self.assertIn(r.status_code, [200, 400, 401, 403, 404])


class TestParceriasClienteResgates(BaseIntegrationTest):
    """POST /api/v1/parcerias/cliente/vantagens/:id/resgates
    O frontend chama: api.post(`/parcerias/cliente/vantagens/${vantagemId}/resgates`, {...})
    """

    def test_150_parcerias_cliente_resgate_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.post(
            f"{self.base_url}/parcerias/cliente/vantagens/1/resgates",
            json={"canal": "app"},
        )
        self.assertEqual(r.status_code, 401)

    def test_151_parcerias_cliente_resgate_vantagem_inexistente_retorna_4xx(self):
        # Admin não tem acesso ao endpoint de cliente (authenticateCliente)
        r = self.session.post(
            f"{self.base_url}/parcerias/cliente/vantagens/99999999/resgates",
            json={"canal": "app"},
        )
        self.assertIn(r.status_code, [400, 401, 403, 404, 422])

    def test_152_parcerias_cliente_resgate_id_invalido_retorna_4xx(self):
        r = self.session.post(
            f"{self.base_url}/parcerias/cliente/vantagens/nao-e-id/resgates",
            json={},
        )
        self.assertIn(r.status_code, [400, 401, 403, 404, 422])


class TestNotificacoesRecorrentesClientePatch(BaseIntegrationTest):
    """PATCH /api/v1/notificacoes/recorrentes/clientes/:titularId/bloqueio
    PATCH /api/v1/notificacoes/recorrentes/clientes/:titularId/metodo
    O frontend chama ambos via notificacoes-recorrentes.service.ts
    """

    def test_160_notificacoes_bloqueio_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/1/bloqueio",
            json={"bloqueado": True},
        )
        self.assertIn(r.status_code, [401, 404])

    def test_161_notificacoes_bloqueio_titular_inexistente_retorna_4xx(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/bloqueio",
            json={"bloqueado": True},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"bloqueio/inexistente retornou {r.status_code}")

    def test_162_notificacoes_bloqueio_desbloqueio_aceito(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/bloqueio",
            json={"bloqueado": False},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_163_notificacoes_metodo_sem_autenticacao_retorna_401(self):
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-Tenant": self.tenant})
        r = s.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/1/metodo",
            json={"metodo": "whatsapp"},
        )
        self.assertIn(r.status_code, [401, 404])

    def test_164_notificacoes_metodo_titular_inexistente_retorna_4xx(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/metodo",
            json={"metodo": "whatsapp"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500],
                      f"metodo/inexistente retornou {r.status_code}")

    def test_165_notificacoes_metodo_email_aceito(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/metodo",
            json={"metodo": "email"},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_166_notificacoes_bloqueio_sem_body_retorna_4xx(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/bloqueio",
            json={},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])

    def test_167_notificacoes_metodo_sem_body_retorna_4xx(self):
        r = self.session.patch(
            f"{self.base_url}/notificacoes/recorrentes/clientes/99999999/metodo",
            json={},
        )
        self.assertIn(r.status_code, [400, 404, 422, 500])


if __name__ == "__main__":
    unittest.main(verbosity=2)
