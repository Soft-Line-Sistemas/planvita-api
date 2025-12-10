# Financeiro x Asaas — Guia rápido de operação e rollout

## O que mudou
- Contas a receber sincronizadas exibem selo “Sincronizado Asaas”, método de pagamento e botões para copiar link ou PIX retornados pelo provedor.
- Ação “Atualizar status” reconsulta o Asaas e bloqueia spam com cooldown curto; falhas retornam mensagem direta da API.
- Baixas/estornos manuais em cobranças sincronizadas pedem confirmação e são logadas com `tenantId`, `asaasPaymentId` e usuário (quando disponível).

## Como operar no painel (`/painel/gestao/financeiro`)
- Use a coluna “Cobrança Asaas” para copiar o `paymentUrl` ou o código PIX. Se ausentes, reconsulte antes de acionar o cliente.
- Preferir “Atualizar status” para alinhar a cobrança ao Asaas; o botão fica indisponível por alguns segundos entre cliques para evitar flood.
- Para cobranças com selo Asaas, a baixa/estorno manual abre alerta informando o risco de divergência com o gateway.
- Status “VENCIDO” e “ATRASADO” são tratados como inadimplência; o aviso “Status pode estar desatualizado” sugere reconsulta.

## Observabilidade e auditoria
- Logs estruturados em ações sensíveis:
  - Reconsulta: `Reconsulta de status solicitada` com `tenantId`, `contaReceberId`, `asaasPaymentId`, `asaasSubscriptionId`, `usuarioId`.
  - Baixa/estorno manual em cobrança sincronizada: `Baixa manual...` / `Estorno...` com os mesmos campos.
- Webhooks continuam válidos; a reconsulta usa `/financeiro/contas/receber/:id/reconsulta` para puxar status/links atuais.

## Rollout e rollback
- Habilitação por tenant via variáveis `ASAAS_ENABLED_TENANTS` e credenciais (`ASAAS_API_KEY_*`, `ASAAS_WEBHOOK_SECRET_*`, `ASAAS_BASE_URL_*`).
- Validar primeiro em homologação (sandbox Asaas): criar cobrança, forçar “VENCIDO”, confirmar pagamento e testar reconsulta/links.
- Rollback por tenant: retirar o tenant da lista habilitada ou limpar credenciais; UI volta a operar com cobranças manuais sem selo Asaas.

## Notas rápidas para o time financeiro
- Sempre copie o link/PIX a partir da coluna Asaas (evita link desatualizado).
- Se o cliente reportar pagamento e o status não mudou, clique em “Atualizar status” antes de registrar baixa manual.
- Evite baixar estornos manualmente sem reconsulta; divergências ficam no log e precisarão de reconciliação posterior.
