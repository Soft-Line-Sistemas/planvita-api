import os
import socket
import subprocess
import time
import unittest
import warnings
import urllib3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytds
import requests


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

    rest = url[len("sqlserver://") :]
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


class ChecklistCadastroPrincipalIntegrationTest(unittest.TestCase):
    tenant = os.getenv("PLANVITA_TENANT", "lider")
    admin_email = os.getenv("PLANVITA_ADMIN_EMAIL", "softline@admin.com")
    admin_password = os.getenv("PLANVITA_ADMIN_PASSWORD", "123456")
    db_url = os.getenv("DATABASE_URL_LIDER")
    sql_config = parse_sqlserver_url(db_url) if db_url else None
    server_process: subprocess.Popen[str] | None = None
    base_url = ""

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
            raise FileNotFoundError(
                f"Arquivo de boot nao encontrado: {server_file}. Gere o build do backend antes de rodar a suite."
            )

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
                response = requests.get(health_url, verify=False, timeout=3)
                if response.status_code < 500:
                    return
            except Exception as exc:  # pragma: no cover - utilitario de espera
                last_error = str(exc)
            time.sleep(1)

        logs = ""
        if cls.server_process and cls.server_process.stdout:
            try:
                logs = cls.server_process.stdout.read()
            except Exception:
                logs = ""
        raise TimeoutError(f"Backend nao respondeu em {health_url}. Ultimo erro: {last_error}\n{logs}")

    @classmethod
    def _login_admin(cls) -> None:
        response = cls.session.post(
            f"{cls.base_url}/auth/login",
            json={"email": cls.admin_email, "password": cls.admin_password},
            timeout=20,
        )
        if response.status_code != 200:
            raise AssertionError(f"Falha no login admin: {response.status_code} {response.text}")

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

    def _fetch_one(self, query: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        with self._db_connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
                if row is None:
                    return None
                columns = [column[0] for column in cursor.description]
                return dict(zip(columns, row))

    def _fetch_all(self, query: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        with self._db_connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
                columns = [column[0] for column in cursor.description]
                return [dict(zip(columns, row)) for row in rows]

    def _suggest_plan_id(self, participantes: list[dict[str, Any]]) -> int:
        response = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": participantes, "retornarTodos": True},
            timeout=20,
        )
        self.assertEqual(response.status_code, 200, response.text)
        planos = response.json()
        self.assertIsInstance(planos, list)
        self.assertGreater(len(planos), 0)
        return int(planos[0]["id"])

    def _make_unique_payload(
        self,
        *,
        titular_data_nascimento: str = "1990-01-01",
        dependentes: list[dict[str, Any]] | None = None,
        step3_overrides: dict[str, Any] | None = None,
        step1_overrides: dict[str, Any] | None = None,
        step2_overrides: dict[str, Any] | None = None,
        step5_overrides: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        suffix = str(int(time.time() * 1000))[-8:]
        titular_cpf = f"9{suffix[:7]}123"
        dependente_cpf = f"8{suffix[:7]}456"
        participantes = [
            {"dataNascimento": titular_data_nascimento, "parentesco": "Titular"},
        ]
        if dependentes is None:
            dependentes = [
                {
                    "nome": f"Dependente Inicial {suffix}",
                    "idade": 10,
                    "dataNascimento": "2015-01-01",
                    "parentesco": "Filho(a)",
                    "telefone": "71999990002",
                    "cpf": dependente_cpf[:11],
                }
            ]
        participantes.extend(
            {
                "dataNascimento": dependente.get("dataNascimento"),
                "parentesco": dependente.get("parentesco", "Outro"),
            }
            for dependente in dependentes
            if dependente.get("dataNascimento")
        )
        plano_id = self._suggest_plan_id(participantes)
        payload = {
            "step1": {
                "nomeCompleto": f"IT Checklist {suffix}",
                "cpf": titular_cpf[:11],
                "dataNascimento": titular_data_nascimento,
                "sexo": "Masculino",
                "rg": "1234567",
                "naturalidade": "Salvador",
                "telefone": "71999990001",
                "whatsapp": "71999990001",
                "email": f"it.checklist.{suffix}@example.com",
                "situacaoConjugal": "Solteiro",
                "profissao": "Analista",
            },
            "step2": {
                "cep": "40000000",
                "uf": "BA",
                "cidade": "Salvador",
                "bairro": "Centro",
                "logradouro": "Rua dos Testes",
                "complemento": "",
                "numero": "10",
                "pontoReferencia": "Praca principal",
            },
            "step3": {
                "usarMesmosDados": True,
            },
            "dependentes": dependentes,
            "step5": {
                "planoId": plano_id,
                "billingType": "PIX",
            },
        }
        if step1_overrides:
            payload["step1"].update(step1_overrides)
        if step2_overrides:
            payload["step2"].update(step2_overrides)
        if step3_overrides:
            payload["step3"].update(step3_overrides)
        if step5_overrides:
            payload["step5"].update(step5_overrides)
        return payload

    def _create_titular_via_api(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _delete_if_exists(self, path: str) -> None:
        response = self.session.delete(f"{self.base_url}{path}", timeout=20)
        self.assertIn(response.status_code, (204, 404, 500), response.text)

    def _cleanup_titular(self, titular_id: int) -> None:
        dependentes = self._fetch_all(
            "SELECT id FROM Dependente WHERE titularId = %s ORDER BY id",
            (titular_id,),
        )
        for dependente in dependentes:
            self._delete_if_exists(f"/dependente/{dependente['id']}")

        corresponsaveis = self._fetch_all(
            "SELECT id FROM Corresponsavel WHERE titularId = %s ORDER BY id",
            (titular_id,),
        )
        for corresponsavel in corresponsaveis:
            self._delete_if_exists(f"/corresponsavel/{corresponsavel['id']}")

        self._delete_if_exists(f"/titular/{titular_id}")

    def test_01_dependencias_do_cadastro_principal_estao_consumiveis(self) -> None:
        consultores = self.session.get(f"{self.base_url}/consultor/public", timeout=20)
        self.assertEqual(consultores.status_code, 200, consultores.text)
        consultores_payload = consultores.json()
        self.assertIsInstance(consultores_payload, list)
        self.assertGreater(len(consultores_payload), 0)
        self.assertIn("id", consultores_payload[0])
        self.assertIn("nome", consultores_payload[0])

        regras = self.session.get(f"{self.base_url}/regras", timeout=20)
        self.assertEqual(regras.status_code, 200, regras.text)
        regras_payload = regras.json()
        self.assertIsInstance(regras_payload, list)
        self.assertGreater(len(regras_payload), 0)
        self.assertEqual(str(regras_payload[0]["tenantId"]).upper(), self.tenant.upper())

        plano = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={
                "participantes": [
                    {"dataNascimento": "1990-01-01", "parentesco": "Titular"},
                    {"dataNascimento": "2015-01-01", "parentesco": "Filho(a)"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(plano.status_code, 200, plano.text)
        plano_payload = plano.json()
        self.assertIsInstance(plano_payload, list)
        self.assertGreater(len(plano_payload), 0)
        self.assertIn("id", plano_payload[0])
        self.assertIn("nome", plano_payload[0])

    def test_02_auth_check_retorna_usuario_logado(self) -> None:
        response = self.session.get(f"{self.base_url}/auth/check", timeout=20)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["email"], self.admin_email)
        self.assertIn("permissions", body)
        self.assertGreater(len(body["permissions"]), 0)

    def test_03_rotas_protegidas_exigem_autenticacao(self) -> None:
        anon = requests.Session()
        anon.verify = False
        headers = {"X-Tenant": self.tenant}

        for method, path, kwargs in [
            ("get", "/titular", {}),
            ("get", "/auth/check", {}),
            ("post", "/titular/full", {"json": self._make_unique_payload()}),
            ("post", "/dependente", {"json": {"titularId": 999999, "nome": "Sem Auth"}}),
        ]:
            response = getattr(anon, method)(f"{self.base_url}{path}", headers=headers, timeout=20, **kwargs)
            self.assertEqual(response.status_code, 401, f"{path}: {response.text}")

    def test_04_plano_sugerir_rejeita_sem_participantes(self) -> None:
        response = self.session.post(
            f"{self.base_url}/plano/sugerir",
            json={"participantes": []},
            timeout=20,
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["message"], "Informe a lista de participantes.")

    def test_04b_plano_sugerir_publico_com_tenant_retorna_200(self) -> None:
        anon = requests.Session()
        anon.verify = False
        response = anon.post(
            f"{self.base_url}/plano/sugerir",
            headers={"X-Tenant": self.tenant},
            json={
                "participantes": [
                    {"dataNascimento": "1990-01-01", "parentesco": "Titular"},
                ],
                "retornarTodos": True,
            },
            timeout=20,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsInstance(response.json(), list)

    def test_05_titular_full_rejeita_falta_de_plano(self) -> None:
        payload = self._make_unique_payload()
        payload["step5"] = {}

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=20)

        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "PLANO_OBRIGATORIO")

    def test_06_titular_full_rejeita_cpf_duplicado_no_mesmo_payload(self) -> None:
        payload = self._make_unique_payload()
        payload["dependentes"][0]["cpf"] = payload["step1"]["cpf"]

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=20)

        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "CPF_DUPLICADO_NO_CADASTRO")
        self.assertIn("duplicados", body["meta"])

    def test_07_titular_full_rejeita_corresponsavel_menor_de_idade(self) -> None:
        payload = self._make_unique_payload(
            step3_overrides={
                "usarMesmosDados": False,
                "nomeCompleto": "Responsavel Menor",
                "cpf": "12312312312",
                "dataNascimento": "2012-01-01",
                "sexo": "Feminino",
                "naturalidade": "Salvador",
                "parentesco": "Mae",
                "email": "resp.menor@example.com",
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

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=20)
        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "CORRESPONSAVEL_MENOR_IDADE")

    def test_08_titular_full_rejeita_data_invalida_de_dependente(self) -> None:
        payload = self._make_unique_payload()
        payload["dependentes"][0]["dataNascimento"] = "abc"

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=20)
        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "DEPENDENTE_DATA_NASCIMENTO_INVALIDA")

    def test_09_titular_full_rejeita_plano_incompativel(self) -> None:
        payload = self._make_unique_payload(
            titular_data_nascimento="1930-01-01",
            dependentes=[],
            step5_overrides={"planoId": 31},
        )

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=20)
        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "PLANO_INCOMPATIVEL")
        self.assertIn("planosCompativeis", body["meta"])

    def test_10_dependente_rejeita_titular_invalido(self) -> None:
        response = self.session.post(
            f"{self.base_url}/dependente",
            json={
                "titularId": 0,
                "nome": "Dependente Sem Titular",
                "dataNascimento": "2014-03-10",
                "tipoDependente": "Filho(a)",
            },
            timeout=20,
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["message"], "titularId inválido.")

    def test_11_public_search_rejeita_sem_cpf(self) -> None:
        response = requests.get(
            f"{self.base_url}/titular/public/search",
            headers={"X-Tenant": self.tenant},
            verify=False,
            timeout=20,
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["message"], "CPF is required")

    def test_12_plano_listagem_paginada_e_detalhe_inexistente(self) -> None:
        paged = self.session.get(
            f"{self.base_url}/plano",
            params={"page": 1, "pageSize": 3, "ativo": "true"},
            timeout=20,
        )
        self.assertEqual(paged.status_code, 200, paged.text)
        body = paged.json()
        self.assertIn("data", body)
        self.assertIn("pagination", body)
        self.assertIn("total", body["pagination"])
        self.assertLessEqual(len(body["data"]), 3)
        self.assertGreater(body["pagination"]["total"], 0)

        missing = self.session.get(f"{self.base_url}/plano/99999999", timeout=20)
        self.assertEqual(missing.status_code, 404, missing.text)
        self.assertEqual(missing.json()["message"], "Plano not found")

    def test_13_titular_e_dependente_inexistentes_retorno_404(self) -> None:
        titular = self.session.get(f"{self.base_url}/titular/99999999", timeout=20)
        self.assertEqual(titular.status_code, 404, titular.text)
        self.assertEqual(titular.json()["message"], "Titular not found")

        dependente = self.session.get(f"{self.base_url}/dependente/99999999", timeout=20)
        self.assertEqual(dependente.status_code, 404, dependente.text)
        self.assertEqual(dependente.json()["message"], "Dependente not found")

    def test_14_corresponsavel_inexistente_retorno_404(self) -> None:
        response = self.session.get(f"{self.base_url}/corresponsavel/99999999", timeout=20)
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["message"], "Corresponsavel not found")

    def test_15_fluxo_lista_exporta_e_busca_publica_cadastro_criado(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])

            list_response = self.session.get(
                f"{self.base_url}/titular",
                params={"search": payload["step1"]["email"], "page": 1, "limit": 10},
                timeout=20,
            )
            self.assertEqual(list_response.status_code, 200, list_response.text)
            list_body = list_response.json()
            self.assertGreaterEqual(list_body["total"], 1)
            self.assertTrue(any(item["id"] == titular_id for item in list_body["data"]))

            export_response = self.session.get(
                f"{self.base_url}/titular/export/cadastro",
                params={"search": payload["step1"]["email"]},
                timeout=20,
            )
            self.assertEqual(export_response.status_code, 200, export_response.text)
            self.assertIn("text/csv", export_response.headers.get("Content-Type", ""))
            export_text = export_response.text
            self.assertIn(payload["step1"]["email"].lower(), export_text)
            self.assertIn(payload["step1"]["nomeCompleto"], export_text)

            public_search = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(public_search.status_code, 200, public_search.text)
            public_body = public_search.json()
            self.assertEqual(public_body["id"], titular_id)
            self.assertEqual(public_body["cpf"], payload["step1"]["cpf"])

            public_search_missing = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": "00000000000"},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(public_search_missing.status_code, 404, public_search_missing.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_16_fluxo_crud_corresponsavel(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        corresponsavel_extra_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])

            create_response = self.session.post(
                f"{self.base_url}/corresponsavel",
                json={
                    "titularId": titular_id,
                    "nome": "Corresponsavel Extra",
                    "email": "corresponsavel.extra@example.com",
                    "telefone": "71988887777",
                    "cpf": "77788899900",
                    "dataNascimento": "1988-05-10T00:00:00.000Z",
                    "relacionamento": "Irmã",
                    "sexo": "Feminino",
                    "rg": "9876543",
                    "naturalidade": "Salvador",
                    "situacaoConjugal": "Solteira",
                    "profissao": "Contadora",
                    "cep": "40000000",
                    "uf": "BA",
                    "cidade": "Salvador",
                    "bairro": "Centro",
                    "logradouro": "Rua C",
                    "complemento": "",
                    "numero": "30",
                    "pontoReferencia": "Mercado",
                },
                timeout=20,
            )
            self.assertEqual(create_response.status_code, 201, create_response.text)
            created_corresponsavel = create_response.json()
            corresponsavel_extra_id = int(created_corresponsavel["id"])

            db_row = self._fetch_one(
                "SELECT id, titularId, nome, email FROM Corresponsavel WHERE id = %s",
                (corresponsavel_extra_id,),
            )
            self.assertIsNotNone(db_row)
            assert db_row is not None
            self.assertEqual(db_row["titularId"], titular_id)
            self.assertEqual(db_row["email"], "corresponsavel.extra@example.com")

            get_response = self.session.get(
                f"{self.base_url}/corresponsavel/{corresponsavel_extra_id}",
                timeout=20,
            )
            self.assertEqual(get_response.status_code, 200, get_response.text)
            self.assertEqual(get_response.json()["id"], corresponsavel_extra_id)

            update_response = self.session.put(
                f"{self.base_url}/corresponsavel/{corresponsavel_extra_id}",
                json={"nome": "Corresponsavel Atualizado", "bairro": "Brotas"},
                timeout=20,
            )
            self.assertEqual(update_response.status_code, 200, update_response.text)

            db_updated = self._fetch_one(
                "SELECT nome, bairro FROM Corresponsavel WHERE id = %s",
                (corresponsavel_extra_id,),
            )
            self.assertEqual(db_updated["nome"], "Corresponsavel Atualizado")
            self.assertEqual(db_updated["bairro"], "Brotas")

            delete_response = self.session.delete(
                f"{self.base_url}/corresponsavel/{corresponsavel_extra_id}",
                timeout=20,
            )
            self.assertEqual(delete_response.status_code, 204, delete_response.text)
            corresponsavel_extra_id = None
            self.assertIsNone(
                self._fetch_one("SELECT id FROM Corresponsavel WHERE id = %s", (created_corresponsavel["id"],))
            )
        finally:
            if corresponsavel_extra_id:
                self._delete_if_exists(f"/corresponsavel/{corresponsavel_extra_id}")
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_17_patch_plano_rejeita_parametros_invalidos(self) -> None:
        invalid_titular = self.session.patch(
            f"{self.base_url}/plano/titulares/0/plano",
            json={"planoId": 31},
            timeout=20,
        )
        self.assertEqual(invalid_titular.status_code, 400, invalid_titular.text)
        self.assertEqual(invalid_titular.json()["message"], "titularId inválido.")

        payload = self._make_unique_payload()
        titular_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])

            invalid_plano = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": 0},
                timeout=20,
            )
            self.assertEqual(invalid_plano.status_code, 400, invalid_plano.text)
            self.assertEqual(invalid_plano.json()["message"], "planoId inválido.")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_18_patch_plano_atualiza_e_null_mantem_plano_atual(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])
            novo_plano_id = 32 if int(payload["step5"]["planoId"]) != 32 else 33

            vincular = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": novo_plano_id},
                timeout=20,
            )
            self.assertEqual(vincular.status_code, 200, vincular.text)
            self.assertEqual(vincular.json()["planoId"], novo_plano_id)

            titular_db = self._fetch_one("SELECT planoId FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(titular_db["planoId"], novo_plano_id)

            desvincular = self.session.patch(
                f"{self.base_url}/plano/titulares/{titular_id}/plano",
                json={"planoId": None},
                timeout=20,
            )
            self.assertEqual(desvincular.status_code, 200, desvincular.text)
            self.assertEqual(desvincular.json()["planoId"], novo_plano_id)

            titular_db_sem_plano = self._fetch_one("SELECT planoId FROM Titular WHERE id = %s", (titular_id,))
            self.assertEqual(titular_db_sem_plano["planoId"], novo_plano_id)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_19_titular_full_rejeita_excesso_de_beneficiarios(self) -> None:
        dependentes = []
        for index in range(9):
            dependentes.append(
                {
                    "nome": f"Dependente Limite {index}",
                    "idade": 10 + index,
                    "dataNascimento": f"201{index}-01-01" if index <= 5 else "2015-01-01",
                    "parentesco": "Filho(a)",
                    "telefone": f"71999990{index:03d}"[:11],
                    "cpf": f"7{index}12345678"[:11],
                }
            )
        payload = self._make_unique_payload(dependentes=dependentes)

        response = self.session.post(f"{self.base_url}/titular/full", json=payload, timeout=30)
        self.assertEqual(response.status_code, 400, response.text)
        body = response.json()
        self.assertEqual(body["code"], "LIMITE_BENEFICIARIOS_EXCEDIDO")

    def test_20_dependente_update_rejeita_inexistente(self) -> None:
        response = self.session.put(
            f"{self.base_url}/dependente/99999999",
            json={"nome": "Nao Existe"},
            timeout=20,
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["message"], "Dependente não encontrado.")

    def test_21_dependente_update_titular_invalido_retorna_erro_fk(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        dependente_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])
            dependente_id = int(created["dependentes"][0]["id"])

            response = self.session.put(
                f"{self.base_url}/dependente/{dependente_id}",
                json={"titularId": 0},
                timeout=20,
            )
            self.assertEqual(response.status_code, 500, response.text)
            body = response.json()
            self.assertIn("Dependente_titularId_fkey", body["message"])
            self.assertEqual(body["meta"]["constraint"], "Dependente_titularId_fkey")
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_22_titular_listagem_filtra_por_status_e_busca(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])

            filtered = self.session.get(
                f"{self.base_url}/titular",
                params={
                    "search": payload["step1"]["cpf"],
                    "status": "PENDENTE_ASSINATURA",
                    "page": 1,
                    "limit": 5,
                },
                timeout=20,
            )
            self.assertEqual(filtered.status_code, 200, filtered.text)
            body = filtered.json()
            self.assertTrue(any(item["id"] == titular_id for item in body["data"]))

            missing = self.session.get(
                f"{self.base_url}/titular",
                params={"search": "nao-existe-123456"},
                timeout=20,
            )
            self.assertEqual(missing.status_code, 200, missing.text)
            missing_body = missing.json()
            self.assertEqual(missing_body["total"], 0)
            self.assertEqual(missing_body["data"], [])
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_23_public_search_retorna_404_apos_exclusao(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])
            self._cleanup_titular(titular_id)
            titular_id = None

            response = requests.get(
                f"{self.base_url}/titular/public/search",
                params={"cpf": payload["step1"]["cpf"]},
                headers={"X-Tenant": self.tenant},
                verify=False,
                timeout=20,
            )
            self.assertEqual(response.status_code, 404, response.text)
        finally:
            if titular_id:
                self._cleanup_titular(titular_id)

    def test_24_fluxo_principal_persiste_atualiza_e_limpa_dados(self) -> None:
        payload = self._make_unique_payload()
        titular_id = None
        dependente_extra_id = None

        try:
            created = self._create_titular_via_api(payload)
            titular_id = int(created["id"])
            self.assertEqual(created["statusPlano"], "PENDENTE_ASSINATURA")
            self.assertEqual(created["email"], payload["step1"]["email"].lower())
            self.assertEqual(len(created["dependentes"]), 1)
            self.assertEqual(created["dependentes"][0]["nome"], payload["dependentes"][0]["nome"])

            titular_db = self._fetch_one(
                """
                SELECT id, nome, email, cpf, telefone, bairro, logradouro, numero, statusPlano, planoId
                FROM Titular
                WHERE id = %s
                """,
                (titular_id,),
            )
            self.assertIsNotNone(titular_db)
            assert titular_db is not None
            self.assertEqual(titular_db["email"], payload["step1"]["email"].lower())
            self.assertEqual(titular_db["cpf"], payload["step1"]["cpf"])
            self.assertEqual(titular_db["planoId"], payload["step5"]["planoId"])

            duplicate_response = self.session.post(
                f"{self.base_url}/titular/full",
                json=payload,
                timeout=20,
            )
            self.assertEqual(duplicate_response.status_code, 409, duplicate_response.text)

            get_response = self.session.get(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(get_response.status_code, 200, get_response.text)
            details = get_response.json()
            self.assertEqual(details["id"], titular_id)
            self.assertEqual(details["nome"], payload["step1"]["nomeCompleto"])

            update_payload = {
                "telefone": "71911112222",
                "bairro": "Brotas",
                "logradouro": "Rua Atualizada",
                "numero": "99",
            }
            update_response = self.session.put(
                f"{self.base_url}/titular/{titular_id}",
                json=update_payload,
                timeout=20,
            )
            self.assertEqual(update_response.status_code, 200, update_response.text)

            titular_db_updated = self._fetch_one(
                "SELECT telefone, bairro, logradouro, numero FROM Titular WHERE id = %s",
                (titular_id,),
            )
            self.assertEqual(titular_db_updated["telefone"], update_payload["telefone"])
            self.assertEqual(titular_db_updated["bairro"], update_payload["bairro"])
            self.assertEqual(titular_db_updated["logradouro"], update_payload["logradouro"])
            self.assertEqual(titular_db_updated["numero"], update_payload["numero"])

            dependente_payload = {
                "titularId": titular_id,
                "nome": "Dependente Extra Integracao",
                "dataNascimento": "2014-03-10",
                "tipoDependente": "Filho(a)",
                "carenciaInicioEm": "2026-06-23",
            }
            create_dependente = self.session.post(
                f"{self.base_url}/dependente",
                json=dependente_payload,
                timeout=20,
            )
            self.assertEqual(create_dependente.status_code, 201, create_dependente.text)
            dependente_extra = create_dependente.json()
            dependente_extra_id = int(dependente_extra["id"])

            dependente_db = self._fetch_one(
                "SELECT id, titularId, nome, tipoDependente FROM Dependente WHERE id = %s",
                (dependente_extra_id,),
            )
            self.assertIsNotNone(dependente_db)
            assert dependente_db is not None
            self.assertEqual(dependente_db["titularId"], titular_id)
            self.assertEqual(dependente_db["nome"], dependente_payload["nome"])

            update_dependente = self.session.put(
                f"{self.base_url}/dependente/{dependente_extra_id}",
                json={"nome": "Dependente Extra Atualizado", "dataNascimento": "2014-04-11"},
                timeout=20,
            )
            self.assertEqual(update_dependente.status_code, 200, update_dependente.text)

            dependente_db_updated = self._fetch_one(
                "SELECT nome, CONVERT(varchar(10), dataNascimento, 23) AS dataNascimento FROM Dependente WHERE id = %s",
                (dependente_extra_id,),
            )
            self.assertEqual(dependente_db_updated["nome"], "Dependente Extra Atualizado")
            self.assertEqual(str(dependente_db_updated["dataNascimento"]), "2014-04-11")

            delete_dependente = self.session.delete(
                f"{self.base_url}/dependente/{dependente_extra_id}",
                timeout=20,
            )
            self.assertEqual(delete_dependente.status_code, 204, delete_dependente.text)
            dependente_extra_id = None
            self.assertIsNone(
                self._fetch_one("SELECT id FROM Dependente WHERE id = %s", (dependente_db["id"],))
            )

            corresponsaveis = self._fetch_all(
                "SELECT id FROM Corresponsavel WHERE titularId = %s ORDER BY id",
                (titular_id,),
            )
            self.assertGreater(len(corresponsaveis), 0)
            for corresponsavel in corresponsaveis:
                response = self.session.delete(
                    f"{self.base_url}/corresponsavel/{corresponsavel['id']}",
                    timeout=20,
                )
                self.assertEqual(response.status_code, 204, response.text)

            dependentes_restantes = self._fetch_all(
                "SELECT id FROM Dependente WHERE titularId = %s ORDER BY id",
                (titular_id,),
            )
            for dependente in dependentes_restantes:
                response = self.session.delete(
                    f"{self.base_url}/dependente/{dependente['id']}",
                    timeout=20,
                )
                self.assertEqual(response.status_code, 204, response.text)

            delete_titular = self.session.delete(f"{self.base_url}/titular/{titular_id}", timeout=20)
            self.assertEqual(delete_titular.status_code, 204, delete_titular.text)
            titular_id = None
            self.assertIsNone(self._fetch_one("SELECT id FROM Titular WHERE id = %s", (created["id"],)))
        finally:
            if dependente_extra_id:
                self._delete_if_exists(f"/dependente/{dependente_extra_id}")
            if titular_id:
                self._cleanup_titular(titular_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
