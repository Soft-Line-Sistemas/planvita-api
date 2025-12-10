# PRD - Integração Asaas com Financeiro do Painel (`/painel/gestao/financeiro`)

## Contexto
- O sistema já possui módulo financeiro (contas a pagar/receber, pagamentos de titulares, notificações recorrentes) persistindo direto no banco via Prisma.
- Não há integração com gateway: status e baixas são manuais. Planos de titulares são mensais/recorrentes.
- Asaas oferece criação de clientes, assinaturas e cobranças (boleto, pix, cartão) com webhooks de ciclo de vida.

## Objetivo
Unificar a recorrência financeira via Asaas, mantendo o financeiro do sistema como espelho de status e relatórios. Evitar baixas manuais, disponibilizar links/PIX e receber confirmações automáticas.

## Fora do escopo
- Migração retroativa de cobranças antigas.
- Motor próprio de tentativas/dunning além do que o Asaas provê.
- Emissão fiscal (NF) automatizada.

## Personas e usuários
- Financeiro/backoffice: opera `/painel/gestao/financeiro`, cria/acompanha contas e assinaturas.
- Sistema automático (jobs): reconcilia dados com Asaas.
- Titular/cliente final: recebe link/PIX e paga.

## Principais histórias de usuário
1) Como financeiro, ao criar/ativar um plano recorrente de um titular, quero gerar assinatura no Asaas e armazenar os IDs para não lançar cobranças manualmente.  
2) Como financeiro, quero ver no painel os boletos/links/QRs gerados e o status “Pendente/Recebido/Cancelado” sincronizado automaticamente.  
3) Como sistema, ao receber webhook de pagamento confirmado, quero dar baixa na `ContaReceber` e registrar `Pagamento` com data e método sem intervenção manual.  
4) Como sistema, se o Asaas marcar cobrança como vencida ou cancelada, quero refletir o status local e notificar o titular com link atualizado.  
5) Como financeiro, ao alterar dia/valor do plano, quero atualizar a assinatura no Asaas e ver a próxima fatura ajustada.  
6) Como financeiro, ao cancelar plano, quero cancelar assinatura no Asaas e impedir novas cobranças.

## Fluxo alvo (alto nível)
1) Criar/atualizar titular/plano → criar/atualizar `customer` Asaas.  
2) Criar assinatura (`subscription`) Asaas com valor do plano, vencimento e métodos permitidos.  
3) Cada fatura gerada pelo Asaas cria/atualiza `ContaReceber` + `Pagamento` local (status pendente, links/PIX).  
4) Webhooks do Asaas são a fonte da verdade de status; atualizam baixas/estornos.  
5) Notificações recorrentes enviam o `paymentUrl`/PIX da fatura vigente.  
6) Reconciliação diária busca assinaturas/faturas no Asaas e corrige divergências.

## Requisitos funcionais
- RF1: Criar/atualizar clientes Asaas ao salvar titular relevante (nome, CPF/CNPJ, email, telefone, endereço). Guardar `asaasCustomerId`.
- RF2: Criar/atualizar assinaturas Asaas ao ativar/alterar plano recorrente (valor, dia de vencimento, multa/juros/opções de pagamento). Guardar `asaasSubscriptionId`.
- RF3: Para cada fatura de assinatura, persistir `ContaReceber` e/ou `Pagamento` com `asaasPaymentId`, `paymentUrl`, `pixQrCode`, `pixExpiration`.
- RF4: Webhook seguro recebe eventos `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `SUBSCRIPTION_*` e atualiza status local (`PENDENTE`, `RECEBIDO`, `CANCELADO`, `VENCIDO`), datas e links.
- RF5: Baixas manuais na UI continuam possíveis, mas com alerta quando houver `asaasPaymentId`.
- RF6: Notificações recorrentes incorporam link/PIX da fatura aberta do titular; se indisponível, gerar link via Asaas (paymentLink).
- RF7: Reconciliação diária/por tenant: listar cobranças e assinaturas no Asaas e ajustar registros locais idempotentemente.
- RF8: Suportar múltiplos tenants: chaves de API e webhooks por tenant, usando `tenantId` nas requisições e nos logs.
- RF9: Registrar mudanças em log auditável (tenant, subscriptionId, paymentId, ação, status anterior/novo).

## Requisitos não funcionais
- Segurança: webhooks com assinatura/secret validada; payload idempotente por `asaasPaymentId`/`asaasSubscriptionId`.  
- Resiliência: retries com backoff em chamadas ao Asaas; fallback de reconciliação corrige falhas de webhook.  
- Observabilidade: métricas de sucesso/erro por operação, logs estruturados com `tenant`, `subscriptionId`, `paymentId`.  
- Performance: chamadas assíncronas; paginar reconciliações; rate limit já existe para criação de pagamentos.

## Modelagem e dados (proposta de campos)
- `Titular`: `asaasCustomerId`, `metodoPreferencial` já existe (reusar).  
- `Pagamento` e/ou `ContaReceber`: `asaasPaymentId` (unique), `asaasSubscriptionId` (nullable), `paymentUrl`, `pixQrCode`, `pixExpiration`, `metodoPagamento`, `status`, `dataVencimento`, `valor`.  
- Opcional: tabela `WebhookLog` ou reaproveitar `NotificationLog` para auditoria de Asaas.

## Mudanças em API/serviços
- Serviço Asaas (novo): client HTTP com chaves por tenant; métodos `createCustomer`, `createOrUpdateSubscription`, `createPayment`, `getPayments`, `getSubscriptions`.
- Financeiro: `createContaReceber` passa a criar/atualizar customer + assinatura (quando aplicável) ou cobrança avulsa; salva IDs/links retornados.
- Pagamento: `create` aceita payloads vindos de Asaas (webhook) para persistir data/status.
- Notificações recorrentes: ao montar mensagem, buscar fatura pendente com `asaasPaymentId` e anexar `paymentUrl`/PIX.
- Webhook: nova rota (ex.: `/api/v1/pagamento/asaas/webhook`) que valida assinatura, resolve tenant e atualiza registros idempotentemente.

## UX no painel `/painel/gestao/financeiro`
- Listagens mostram status e método Asaas, botão “Copiar link” e “Copiar PIX”.
- Selo/label “Sincronizado Asaas” quando há `asaasPaymentId`; tooltip quando desatualizado.
- Botão “Atualizar status” dispara reconsulta ao Asaas.
- Alertas de conflito (ex.: baixa manual em cobrança sincronizada).

## Regras de negócio chave
- Assinatura ativa ⇔ plano ativo; cancelar plano cancela assinatura.  
- Baixa local só automática via webhook ou reconsulta; manual exige confirmação e registra auditoria.  
- Valor e dia de vencimento espelham o plano; alterações propagam ao Asaas.  
- Dunning: usar nativamente o Asaas (tentativas, multa/juros); não duplicar lógica local.

## Fluxos de erro e fallback
- Falha ao criar customer/subscription: não gravar `asaas*Id`, exibir erro e permitir retry.  
- Falha em webhook: log + fila de retry; reconciliação corrige.  
- Webhook sem tenant resolvido: descartar e logar (evitar contaminar tenants).

## Observabilidade e controle
- Logs estruturados com `tenantId`, `asaasPaymentId`, `asaasSubscriptionId`, `requestId`.  
- Métricas: taxa de sucesso de criação de cobrança, tempo de confirmação, divergências na reconciliação.  
- Dash de saúde: últimos webhooks recebidos, últimos erros, fila de retries.

## Checklist de entrega
- [ ] Campos Prisma adicionados (customer/subscription/payment IDs, links, PIX).  
- [ ] Client Asaas com chaves por tenant e validação de assinatura de webhook.  
- [ ] Rota de webhook protegida e idempotente.  
- [ ] Serviços financeiro/pagamento gerando/atualizando cobranças via Asaas.  
- [ ] Notificações recorrentes enviando link/PIX da cobrança aberta.  
- [ ] Reconciliação agendada e idempotente.  
- [ ] Ajustes de UI no painel com links/status Asaas.  
- [ ] Logs/alertas para operações e falhas.
