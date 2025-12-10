# Task 1 — Backoffice/Serviços: Integração Asaas no Financeiro

## Objetivo
Implementar fluxo backend completo para criar/atualizar clientes, assinaturas e cobranças no Asaas, espelhando status no financeiro e garantindo segurança, observabilidade e idempotência.

## Entregáveis
- Campos e migrations Prisma aplicados para `Titular`, `Pagamento` e/ou `ContaReceber` com IDs/links Asaas.
- Client Asaas multi-tenant com retries, timeouts, logs estruturados e validação de assinatura de webhook.
- Rota de webhook segura e idempotente atualizando status locais e registrando auditoria.
- Serviços financeiro/pagamento/notificação e job de reconciliação ajustados para usar Asaas como fonte de verdade.
- Testes automatizados cobrindo client, webhook, serviços e reconciliação (incluindo casos de erro).

## Passos detalhados (ordem sugerida)
1) **Configuração e chaves**
   - Mapear chaves por tenant (API key, webhook secret, base URL) e definir variáveis em `.env`/vault.
   - Criar módulo de resolução de credenciais por `tenantId` e aplicar feature toggle de rollout.
2) **Modelagem e migrations**
   - Adicionar a `Titular` o campo `asaasCustomerId`.
   - Em `Pagamento`/`ContaReceber` incluir: `asaasPaymentId` (unique), `asaasSubscriptionId` (nullable), `paymentUrl`, `pixQrCode`, `pixExpiration`, `metodoPagamento`, `status`, `dataVencimento`, `valor`.
   - Gerar migrations e ajustar validações/seed/DTOs conforme necessário.
3) **Client Asaas**
   - Implementar métodos `createCustomer`, `createOrUpdateSubscription`, `createPayment`, `getPayments`, `getSubscriptions` com suporte a paginação, retries com backoff e timeouts.
   - Logar requests/responses com `tenantId`, `subscriptionId`, `paymentId`, `requestId`; mascarar dados sensíveis.
   - Validar assinatura de webhook (HMAC) e retornar erro claro em caso de falha.
4) **Fluxo de criação/atualização**
   - Integrar serviço de titular para criar/atualizar `customer` no Asaas quando salvar dados relevantes; persistir `asaasCustomerId`.
   - Integrar criação/atualização de plano recorrente para criar/atualizar `subscription` com valor, dia de vencimento, multa/juros e métodos; salvar `asaasSubscriptionId`.
5) **Geração/espelhamento de cobranças**
   - Ao criar `ContaReceber`/`Pagamento`, consumir fatura/charge vinda do Asaas e persistir `asaasPaymentId`, links e PIX; garantir idempotência por `asaasPaymentId`.
   - Manter alerta/flag para baixas manuais quando existir integração.
6) **Webhook de pagamento/assinatura**
   - Criar rota (ex.: `/api/v1/pagamento/asaas/webhook`) com validação de assinatura e resolução de tenant.
   - Processar `PAYMENT_CREATED`, `PAYMENT_CONFIRMED/RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `SUBSCRIPTION_*`, atualizando status locais (`PENDENTE`, `RECEBIDO`, `CANCELADO`, `VENCIDO`), datas e links; registrar auditoria.
7) **Notificações recorrentes**
   - Atualizar serviço de notificações para incluir `paymentUrl`/PIX da fatura aberta; se ausente, gerar `paymentLink` via Asaas e persistir.
8) **Reconciliação**
   - Implementar job diário/por tenant que lista cobranças/assinaturas no Asaas e corrige divergências de status/links de forma idempotente.
   - Exportar métricas (sucesso/erro/divergências) e logs estruturados.
9) **Testes e validação**
   - Adicionar testes unitários/integração para client, webhook e serviços.
   - Criar cenários de borda: assinatura cancelada, pagamento vencido, webhook duplicado, tenant inválido, falha de rede.
   - Validar e2e em ambiente de sandbox Asaas antes do rollout.

## Critérios de aceite
- Todas as operações Asaas resolvem credenciais por tenant e logam `tenantId`, `asaasPaymentId`, `asaasSubscriptionId`.
- Webhook rejeita payload sem assinatura ou com tenant inválido e é idempotente por `asaasPaymentId`/`asaasSubscriptionId`.
- Reconciliação corrige divergências sem criar duplicidades.
- Testes automatizados verdes cobrindo fluxos principais e cenários de erro.
