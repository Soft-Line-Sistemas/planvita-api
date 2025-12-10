# Tasks — Integração Asaas no Financeiro

Ordem sugerida para implementar a feature descrita em `prd-integracao-asaas-financeiro.md`.

1) **Preparação e configurações**
   - Mapear chaves Asaas por tenant (API key, webhook secret) e definir convenção em `.env`/vault.
   - Documentar base URL por ambiente e tenants habilitados; garantir flags/toggles de rollout.
2) **Modelagem de dados**
   - Atualizar Prisma: `Titular` com `asaasCustomerId`; `Pagamento`/`ContaReceber` com `asaasPaymentId` (unique), `asaasSubscriptionId`, `paymentUrl`, `pixQrCode`, `pixExpiration`, `metodoPagamento`, `status`, `dataVencimento`, `valor`.
   - Gerar e aplicar migrations; alinhar seeds/fixtures e validações de unicidade.
3) **Client Asaas**
   - Implementar client HTTP com resolução de tenant → chaves; métodos `createCustomer`, `createOrUpdateSubscription`, `createPayment`, `getPayments`, `getSubscriptions`.
   - Incluir retries/backoff, paginação, timeouts, validação de assinatura de webhook e logs estruturados.
4) **Fluxo de criação/atualização de titular e plano**
   - Integrar serviço de titulares para criar/atualizar `customer` Asaas ao salvar ou alterar dados relevantes.
   - Ajustar criação/ativação de plano recorrente para criar/atualizar `subscription` com valor/vencimento/métodos permitidos; persistir IDs retornados.
5) **Geração e espelhamento de cobranças**
   - Adaptar criação de `ContaReceber`/`Pagamento` para usar retorno do Asaas (faturas de assinaturas ou cobranças avulsas) salvando `asaasPaymentId`, links e PIX.
   - Garantir idempotência por `asaasPaymentId` e alerta na UI ao tentar baixa manual quando houver integração.
6) **Webhook de pagamentos/assinaturas**
   - Criar rota (ex.: `/api/v1/pagamento/asaas/webhook`) com validação de assinatura, resolução de tenant e rejeição de payload inválido.
   - Processar eventos `PAYMENT_*` e `SUBSCRIPTION_*` atualizando status (`PENDENTE`, `RECEBIDO`, `CANCELADO`, `VENCIDO`), datas e links; registrar auditoria.
7) **Notificações recorrentes**
   - Incluir `paymentUrl`/PIX da fatura aberta ao montar mensagens; se inexistente, gerar `paymentLink` via Asaas e persistir.
   - Ajustar templates para exibir método/status Asaas quando disponível.
8) **Reconciliação agendada**
   - Criar job diário/por tenant para listar assinaturas/cobranças no Asaas, corrigindo divergências de status/links de forma idempotente.
   - Expor métricas e logs de divergência e sucesso/erro.
9) **UI no painel `/painel/gestao/financeiro`**
   - Exibir status e método Asaas, botões “Copiar link” e “Copiar PIX”, selo “Sincronizado Asaas” quando houver `asaasPaymentId`.
   - Adicionar ação “Atualizar status” (reconsulta Asaas) e alertas de conflito para baixas manuais em cobranças sincronizadas.
10) **Observabilidade, auditoria e segurança**
    - Centralizar logs estruturados com `tenantId`, `asaasPaymentId`, `asaasSubscriptionId`, `requestId`; adicionar métricas por operação.
    - Criar `WebhookLog` ou reutilizar `NotificationLog` para trilha de auditoria; garantir idempotência e tratamento de erros.
11) **QA e rollout**
    - Cobrir client, webhook, serviços financeiro/pagamento e reconciliação com testes automatizados e casos de borda (assinatura cancelada, pagamento vencido).
    - Validar e2e em sandbox do Asaas; ativar por tenant via toggle e comunicar time financeiro.
