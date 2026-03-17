# Planvita - Mapa de Lógicas do Sistema (Validação com Tenants)

Data de referência: 2026-03-17
Escopo analisado: backend (principal) + frontend (regras de fluxo e tenant)

## 1) Lógica de multi-tenant

- O tenant é resolvido por prioridade:
  1. Header `X-Tenant`
  2. Query param `tenant`
  3. Host/subdomínio (com filtros de nomes proibidos)
  4. Fallback para `lider` em `development` ou rota de health.
- Se tenant não for identificado, a API retorna erro 400.
- O tenant deve seguir regex `^[a-z0-9-]+$`.
- O banco é carregado dinamicamente por variável de ambiente `DATABASE_URL_<TENANT_EM_MAIUSCULO>`.
- Cada tenant usa instância Prisma isolada em memória.

## 2) Lógica de autenticação e autorização

- Login valida `email + senha` no tenant corrente.
- Senha comparada com `bcrypt`.
- Em login válido, token JWT é salvo em cookie `auth_token` (`httpOnly`, `secure`, `sameSite=none`, expiração de 1 dia).
- Middleware `authenticate` exige cookie válido.
- Middleware `authorize([...])` exige todas as permissões da rota.
- Rota `/auth/check` reconsulta usuário no banco e devolve permissões efetivas (e resumo de consultor, quando existir).

## 3) Lógica de rate limit e segurança de API

- Existe rate limit geral para `/api` e específico para `/health`.
- Chave de limite por IP ou por API key (quando aplicável).
- Suporte a limite customizado por API key (`rateLimit`, `windowMs` da tabela `api_keys`).
- Rotas expõem headers de limite (`X-RateLimit-*`).
- CORS com whitelist por `ALLOWED_ORIGINS`, incluindo suporte a wildcard.
- Webhook Asaas exige assinatura HMAC válida (`x-signature` e variações).

## 4) Lógica de cadastro de titular e família

### 4.1 Cadastro completo (`/titular/full`)
- Exige `email` e `cpf`.
- Normaliza email (lowercase/trim) e CPF (somente dígitos).
- Bloqueia duplicidade por `email` ou `cpf` (erro 409).
- Cria titular com status inicial `ATIVO` e `dataContratacao` atual.
- Pode vincular consultor (se informado e válido).
- Cria corresponsável automaticamente:
  - Se "usar mesmos dados", copia dados do titular.
  - Caso contrário, usa dados do step do responsável financeiro.
- Valida maioridade do corresponsável (mínimo 18 anos).
- Cria dependentes no mesmo fluxo, respeitando limite de beneficiários configurado.

### 4.2 Limite de beneficiários
- Busca `businessRules.limiteBeneficiarios` por tenant.
- Se limite > 0:
  - Bloqueia criação de titular com dependentes acima do limite.
  - Bloqueia inclusão/alteração de dependentes que ultrapassem o limite.

### 4.3 Assinaturas digitais
- Tipos aceitos:
  - `TITULAR_ASSINATURA_1`
  - `TITULAR_ASSINATURA_2`
  - `CORRESPONSAVEL_ASSINATURA_1`
  - `CORRESPONSAVEL_ASSINATURA_2`
- Formato aceito: imagem base64 (`image/png` ou `image/jpeg`).
- Tamanho máximo: 5 MB.
- Upload em Files API com upsert por (`titularId`, `tipo`).

## 5) Lógica de status do plano (ATIVO/SUSPENSO)

- O sistema recalcula status com base no maior atraso financeiro do titular.
- Considera contas a receber com status: `PENDENTE`, `ATRASADO`, `PENDENCIA`, `VENCIDO`.
- Regra:
  - atraso >= `businessRules.diasSuspensao` (ou 90 por padrão) -> `SUSPENSO`
  - atraso menor -> `ATIVO`
- Titulares `CANCELADO` não são alterados por esta rotina.
- Recalculo ocorre em consulta de titular e também em lote.

## 6) Lógica de planos

### 6.1 CRUD e normalização
- Beneficiários e coberturas são normalizados (trim + remoção de duplicados).
- `idadeMaxima >= 999` é tratada como “sem limite” em listagem.
- Update de plano pode substituir completamente beneficiários e coberturas.

### 6.2 Sugestão de plano
- Filtra apenas planos ativos.
- Calcula idade por participante (idade explícita ou data de nascimento).
- Remove planos inelegíveis por idade máxima.
- Deduplica planos por chave (`nome + valorMensal + idadeMaxima normalizada`).
- Em empate, escolhe o plano com mais “conteúdo” (benefícios/coberturas/beneficiários e adicionais), depois maior ID.
- Retorna melhor plano ou lista completa (parâmetro).

### 6.3 Vinculação de plano ao titular
- Só permite vincular plano existente e ativo.
- Permite desvincular (`planoId = null`).

## 7) Lógica financeira

### 7.1 Contas a pagar e receber
- Exige descrição e valor positivo.
- Criação de conta:
  - `ContaPagar` inicia `PENDENTE`.
  - `ContaReceber` inicia `PENDENTE`.
- Auditoria financeira (`FinancialAudit`) em create/update/delete.

### 7.2 Baixa e estorno
- Baixa de `ContaPagar`:
  - status -> `PAGO`
  - sincroniza comissão vinculada para `PAGO`.
- Estorno de `ContaPagar`:
  - status -> `CANCELADO`
  - comissão volta para `PENDENTE`.
- Baixa de `ContaReceber`:
  - status -> `RECEBIDO`
  - registra/atualiza histórico em `Pagamento`
  - pode gerar comissão do primeiro pagamento.
- Estorno de `ContaReceber`:
  - status -> `CANCELADO`
  - registra/atualiza histórico de pagamento cancelado.

### 7.3 Regras de comissão por indicação
- Só gera comissão se titular tiver consultor com configuração de comissão (valor fixo ou percentual).
- Regra de negócio explícita:
  - 1º recebimento = adesão
  - 2º recebimento = primeira mensalidade elegível para comissão.
- Evita duplicar comissão para o mesmo titular.
- Gera `ContaPagar` da comissão com vencimento atrasado:
  - `35 dias` em produção
  - `1 hora` em desenvolvimento.

### 7.4 Relatórios e métricas
- Relatório financeiro com cache por tenant (TTL padrão 60s):
  - entradas, saídas, lucro, margem
  - série mensal
  - distribuição por fornecedor
  - resumo de comissões
  - resumo de recibos
- Métricas de recorrência (também com cache):
  - MRR, churn, inadimplência, liquidez de caixa em dias, conversão WhatsApp, EBITDA operacional etc.

## 8) Lógica de integração Asaas

### 8.1 Ativação por tenant
- Integração depende de credenciais por tenant:
  - `ASAAS_API_KEY_<TENANT>` (ou fallback global)
  - habilitação por `ASAAS_ENABLED_TENANTS`.

### 8.2 Cliente Asaas
- Se titular não tiver `asaasCustomerId`, cria customer no Asaas com dados cadastrais.
- Salva `asaasCustomerId` no titular.

### 8.3 Cobrança Asaas
- Ao criar conta a receber, pode integrar automaticamente (padrão: integra).
- Cria cobrança com `billingType` (default `PIX`).
- Salva vínculo local: `asaasPaymentId`, `asaasSubscriptionId`, URL de pagamento, QR code PIX, vencimento retornado.
- Atualização local pode tentar atualizar pagamento no Asaas se já existir vínculo.

### 8.4 Webhook Asaas
- Identifica tenant por header/query/body.
- Valida assinatura obrigatoriamente.
- Mapeia eventos/status do Asaas para status local:
  - recebido/confirmado -> `RECEBIDO`/`CONFIRMADO`
  - overdue -> `VENCIDO`
  - refund/chargeback/cancelamento -> `CANCELADO`
  - demais -> `PENDENTE`.
- Atualiza conta a receber e histórico de pagamento local.
- Ao receber pagamento, pode disparar geração de comissão do primeiro pagamento.

### 8.5 Reconsulta manual
- Permite reconsultar status de conta vinculada ao Asaas e reaplicar regra de webhook.

## 9) Lógica de notificações recorrentes de cobrança

### 9.1 Agendamento e frequência
- Se não existir agendamento do tenant, cria automaticamente.
- Frequência padrão usa `repeticaoPendenciaDias` (convertido para minutos).
- Método preferencial padrão pode vir de regra de negócio (`tipoAvisoTaxaVencida`) e default global.

### 9.2 Fluxos de notificação
Fluxos suportados:
- `pendencia-periodica`
- `aviso-vencimento`
- `aviso-pendencia`
- `suspensao-preventiva`
- `suspensao`
- `pos-suspensao`

Filtros por dias (com fallback default):
- aviso vencimento: até X dias antes do vencimento
- aviso pendência: X dias após vencimento
- suspensão preventiva: após X dias de atraso
- suspensão: após X dias de atraso
- pós-suspensão: após X dias de atraso

### 9.3 Elegibilidade e envio
- Agrupa cobranças por titular.
- Respeita bloqueio individual (`bloquearNotificacaoRecorrente`).
- Método por titular (`metodoNotificacaoRecorrente`) pode sobrescrever método do agendamento.
- Se não houver contato válido, notificação é ignorada com log.
- Usa template default por canal/flow (se existir), senão usa mensagem padrão.
- Persiste logs (`NotificationLog`) com status: enviado/ignorado/falha.
- Para flows diferentes de `pendencia-periodica`, evita reenvio da mesma referência de conta.

## 10) Lógica de usuários, perfis e consultores

- Usuário é criado com senha inicial fixa `123456` (hash bcrypt).
- Se role atribuída for `consultor`, sistema garante registro de consultor vinculado ao usuário.
- Ao trocar role para consultor, também garante criação/atualização do consultor.
- Comissão pendente é agregada por consultor para retorno em listagens.

## 11) Lógica no frontend que impacta o negócio

- Frontend injeta `X-Tenant` automaticamente nas requisições, com tenant derivado do host/subdomínio.
- Middleware/proxy do Next:
  - bloqueia rotas `/api` do frontend
  - redireciona `/` para `/login`
  - exige subdomínio para `/login` e `/painel` (senão vai para `/login/redirecionamento`).
- Wizard de cadastro de cliente:
  - busca limite de beneficiários em `/regras`
  - impede adicionar dependente acima do limite no frontend
  - envia cadastro completo com steps e `consultorId` (query param).

## 12) Pontos para validação com tenants (checklist objetivo)

1. Limite de beneficiários deve valer por titular apenas ou por plano?
2. Regra de comissão “2º recebimento = 1ª mensalidade” está correta para todos os tenants?
3. Prazo de suspensão padrão (90 dias) está alinhado com cada operação?
4. Fluxos de notificação e seus dias (vencimento, pendência, suspensão) precisam ajustes por tenant?
5. Método preferencial de notificação (email/whatsapp) deve ser padrão por tenant ou por cliente?
6. Status financeiros usados (`PENDENTE`, `RECEBIDO`, `CANCELADO`, etc.) estão padronizados para todos os painéis?
7. Criação automática de cobrança no Asaas ao cadastrar conta a receber deve continuar padrão?
8. Política de senha inicial de usuário (`123456`) deve ser alterada?
9. Rotas financeiras/notificações devem ter autorização por permissão (hoje passam por tenant, mas sem middleware `authenticate/authorize` explícito nessas rotas)?
10. Conteúdo padrão de e-mails/WhatsApp de cobrança está adequado para linguagem e compliance de cada tenant?

## 13) Fontes técnicas usadas no mapeamento

- `backend/src/app.ts`
- `backend/src/middlewares/*.ts`
- `backend/src/services/titular.service.ts`
- `backend/src/services/dependente.service.ts`
- `backend/src/services/plano.service.ts`
- `backend/src/services/financeiro.service.ts`
- `backend/src/services/asaas-integration.service.ts`
- `backend/src/services/notificacao-recorrente.service.ts`
- `backend/src/services/user.service.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/controllers/*.ts` (auth/financeiro/titular/asaas)
- `backend/src/routes/*.ts` (permissões e exposição de endpoints)
- `backend/src/utils/prisma.ts`, `asaasClient.ts`, `notificationClient.ts`
- `backend/prisma/schema.prisma`
- `frontend/src/utils/api.ts`, `getTenantFromHost.ts`, `src/proxy.ts`, `src/lib/getSubdomain.ts`, `src/components/CadastroClienteWizard.tsx`
