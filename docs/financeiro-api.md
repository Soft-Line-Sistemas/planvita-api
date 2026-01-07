# Financeiro API

## Contas Financeiras

- GET /financeiro/contas
- POST /financeiro/contas/pagar
- POST /financeiro/contas/receber
- PUT /financeiro/contas/:tipo/:id
- DELETE /financeiro/contas/:tipo/:id
- POST /financeiro/contas/:tipo/:id/baixa
- POST /financeiro/contas/:tipo/:id/estorno
- POST /financeiro/contas/receber/:id/reconsulta

## Cadastros

- GET /financeiro/cadastros
- POST /financeiro/cadastros/bancos
- DELETE /financeiro/cadastros/bancos/:id
- POST /financeiro/cadastros/tipos
- DELETE /financeiro/cadastros/tipos/:id
- POST /financeiro/cadastros/formas
- DELETE /financeiro/cadastros/formas/:id
- POST /financeiro/cadastros/centros
- DELETE /financeiro/cadastros/centros/:id

## Relatórios e Métricas

- GET /financeiro/relatorios
- GET /financeiro/metricas/recorrencia

## Notas

- A integração com Asaas respeita timeout e retries configuráveis via ambiente.
- Métricas de recorrência e relatório financeiro são cacheados temporariamente.
