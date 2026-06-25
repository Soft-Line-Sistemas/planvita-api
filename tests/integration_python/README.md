## Execucao

Rode a suite com:

```bash
npm run test:python
```

O script cria uma `venv` local em `.venv-python-tests`, instala as dependencias de [requirements.txt](./requirements.txt) e executa `unittest discover`.

## Pre-requisitos

- `python3` com suporte a `venv`
- `DATABASE_URL_LIDER` no formato `sqlserver://host:porta;database=...;user=...;password=...`
- Opcional: `PLANVITA_API_BASE_URL`, `PLANVITA_TENANT`, `PLANVITA_ADMIN_EMAIL`, `PLANVITA_ADMIN_PASSWORD`

Sem `DATABASE_URL_LIDER`, os testes sao carregados mas todos os cenarios de integracao sao pulados por desenho.
