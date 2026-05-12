# Plano backend para suportar `/cliente` mobile

## Objetivo

Adicionar e ajustar APIs necessárias para que a versão mobile do `/cliente` use dados reais, preserve isolamento por tenant e não dependa de rotas administrativas ou filtros feitos no navegador.

O backend deve continuar atendendo o painel administrativo existente, mas precisa expor uma superfície segura para o cliente autenticado via `cliente_token`.

## Estado atual identificado

- O login cliente já existe em `POST /auth/login` com `audience: "cliente"` e grava cookie `cliente_token`.
- A sessão cliente já existe em `GET /titular/me` com `authenticateCliente`.
- Primeiro acesso, OTP e recuperação já existem em:
  - `POST /auth/first-access`;
  - `POST /auth/verify`;
  - `POST /auth/forgot-password`;
  - `POST /auth/reset-password`.
- Cadastro público usa `POST /auth/register`.
- Assinaturas existem em `/titular/:id/assinaturas`, mas hoje usam `authenticate` e `authorize`, ou seja, exigem cookie administrativo `auth_token`.
- Financeiro expõe `GET /financeiro/contas`, e o frontend atual filtra no navegador por `clienteId`. Para o app mobile, isso deve ser substituído por rota restrita ao cliente autenticado.
- A tela de alteração de senha autenticada do `new-ui` precisa de endpoint próprio; hoje só há fluxo de reset por OTP/token.
- A tela de foto de perfil não tem campo evidente no modelo `Titular`.

## Princípio de API para mobile

Rotas mobile não devem receber `titularId` como parâmetro quando o titular é o próprio cliente autenticado. O backend deve resolver o titular por `req.cliente.titularId`.

Preferir rotas no formato:

```text
/titular/me/...
/financeiro/cliente/...
/auth/cliente/...
```

Isso reduz risco de acesso horizontal entre clientes do mesmo tenant.

## Endpoints necessários

### 1. Financeiro do cliente

Criar:

```http
GET /api/:version/financeiro/cliente/contas
```

Middleware:

```ts
authenticateCliente
```

Resposta sugerida:

```ts
type ClienteContaResponse = {
  id: number;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  tipo: "Receber";
  paymentUrl: string | null;
  pixQrCode: string | null;
  asaasPaymentId?: string | null;
  asaasSubscriptionId?: string | null;
};
```

Regra:

- buscar apenas `ContaReceber` com `clienteId = req.cliente.titularId`;
- ordenar por vencimento desc;
- não retornar contas de outros titulares;
- preservar dados necessários para ações `Pagar`, `Ver recibo`, `Copiar PIX` e `QR Code PIX`.

Implementação provável:

- adicionar método em `FinanceiroService`, por exemplo `listarContasDoCliente(titularId: number)`;
- adicionar método em `FinanceiroController`, por exemplo `getContasCliente`;
- registrar rota antes das rotas parametrizadas de financeiro.

Teste:

- cliente A não vê contas do cliente B;
- sem `cliente_token` retorna `401`;
- tenant inválido não acessa banco de outro tenant.

### 2. Assinaturas do cliente

Criar rotas baseadas no cliente autenticado:

```http
GET  /api/:version/titular/me/assinaturas
POST /api/:version/titular/me/assinaturas
GET  /api/:version/titular/me/assinaturas/:assinaturaId/arquivo
```

Middleware:

```ts
authenticateCliente
```

Regras:

- resolver `titularId` por `req.cliente.titularId`;
- `GET` lista só assinaturas do titular autenticado;
- `POST` aceita `{ tipo, assinaturaBase64 }` e salva para o titular autenticado;
- download deve validar que `assinaturaId` pertence ao titular autenticado antes de retornar arquivo;
- manter as rotas administrativas atuais para o painel, mas o frontend mobile deve usar as rotas `/me`.

Implementação provável:

- reaproveitar `TitularService.listarAssinaturas`;
- reaproveitar `TitularService.salvarAssinaturaDigital`;
- reaproveitar `TitularService.baixarAssinaturaDigital`;
- criar métodos novos em `TitularController` para evitar duplicar lógica de permissão.

### 3. Alteração de senha autenticada

Criar:

```http
POST /api/:version/auth/cliente/change-password
```

Payload:

```ts
{
  currentPassword: string;
  newPassword: string;
}
```

Middleware:

```ts
authenticateCliente
```

Regra:

- buscar `TitularCredential` por `req.cliente.titularId`;
- comparar `currentPassword` com `senhaHash`;
- validar força da nova senha com a mesma regra de `ClienteAuthService`;
- gravar novo `senhaHash`;
- retornar erro 400/401 sem expor detalhes sensíveis.

Implementação provável:

- adicionar método `changePassword(titularId, currentPassword, newPassword)` em `ClienteAuthService`;
- adicionar método em `AuthController`;
- registrar rota em `auth.routes.ts`.

### 4. Perfil/foto do cliente

A tela `alterar-foto-de-perfil` do `new-ui` tem plano específico em `../../frontend/docs/plano-foto-perfil-cliente-mobile.md`.

Estado atual no backend:

- `POST /api/:version/titular/me/foto` já existe com `authenticateCliente`;
- `DELETE /api/:version/titular/me/foto` já existe com `authenticateCliente`;
- `TitularService.salvarFotoPerfil` usa `Documento` com `tipoDocumento = "FOTO_PERFIL"`;
- o upload reaproveita a Files API usada em assinaturas.

Pendência principal:

- expor a foto de forma segura no retorno autenticado de `/titular/me`, sem adicionar `documentos` no include amplo de `TitularService.getById`, porque esse método também alimenta a busca pública por CPF.

Contrato recomendado para `/titular/me`:

```ts
{
  fotoPerfil?: {
    id: number;
    arquivoUrl: string;
    dataUpload: string;
  } | null;
}
```

Recomendação: manter a persistência via `Documento` no MVP, adicionar apenas a leitura segura e testes de autorização/upload.

### 5. Dados agregados para home mobile

O `GET /titular/me` já retorna dados suficientes para a home inicial via `TitularService.getById`, mas validar se inclui:

- plano com coberturas;
- dependentes;
- corresponsáveis, se a assinatura do responsável financeiro depender disso;
- dados de contato usados em atendimento/recuperação.

Se o payload ficar pesado ou instável, criar uma rota resumida:

```http
GET /api/:version/titular/me/resumo
```

No MVP, reaproveitar `/titular/me`.

## Segurança e compatibilidade

### Financeiro

O app mobile não deve usar `GET /financeiro/contas` para depois filtrar no frontend. Isso expõe dados de outras contas no payload e dificulta auditoria.

Plano mínimo:

- criar `GET /financeiro/cliente/contas`;
- trocar o frontend mobile para usar essa rota.

Plano recomendado depois:

- revisar autenticação das rotas administrativas de `/financeiro`;
- adicionar `authenticate`/`authorize` onde for painel;
- manter rotas cliente separadas com `authenticateCliente`.

### Assinaturas

As rotas administrativas por `:id` podem continuar para o painel, mas rotas mobile devem ser `/me` para evitar IDOR.

### Tenant

Manter o padrão atual:

- `tenantMiddleware` resolve `X-Tenant`, query `tenant` ou hostname;
- frontend envia `X-Tenant` pelo interceptor de `api.ts`;
- links de primeiro acesso/reset já carregam `tenant` na URL.

Validar cookies em produção:

- `cliente_token` com `sameSite: "none"` e `secure: true`;
- domínio `.planvita.com.br`;
- ambiente local com `sameSite: "lax"`.

## Ordem de implementação backend

1. Criar endpoint financeiro cliente e testes.
2. Criar endpoints `/titular/me/assinaturas` e testes.
3. Criar endpoint de alteração de senha autenticada e testes.
4. Completar foto de perfil conforme `../../frontend/docs/plano-foto-perfil-cliente-mobile.md`.
5. Ajustar frontend services para novas rotas:
   - `frontend/src/services/financeiro/contasCliente.service.ts`;
   - `frontend/src/services/assinaturas-cliente.service.ts`;
   - service de senha/foto cliente.
6. Rodar build/testes backend e frontend.

## Critérios de aceite backend

- Cliente autenticado lista apenas suas próprias faturas.
- Cliente autenticado lista, cria e baixa apenas suas próprias assinaturas.
- Cliente troca senha informando senha atual correta.
- Cliente sem cookie recebe `401`.
- Cliente de um tenant não acessa dados de outro tenant.
- O painel administrativo continua usando as rotas existentes.
- O frontend mobile não precisa de `auth_token` administrativo para nenhuma ação do cliente.

## Testes recomendados

Executar:

```bash
cd backend
npm test
npm run build
```

Adicionar ou atualizar testes para:

- `FinanceiroService.listarContasDoCliente`;
- controller de `GET /financeiro/cliente/contas`;
- controller de `/titular/me/assinaturas`;
- `ClienteAuthService.changePassword`;
- upload, troca e remoção de `FOTO_PERFIL`;
- falhas de autorização e ownership.

## Pendências funcionais

- Confirmar se a limpeza física do arquivo antigo na Files API entra no MVP ou fica como melhoria posterior.
- Confirmar se `Atendimento` deve usar telefones fixos por tenant ou uma configuração administrável.
- Confirmar se onboarding `splash/carrossel` é obrigatório sempre ou só na primeira visita.
- Confirmar nomes finais dos status de fatura: o design mostra `Atual`, `Vencido`, `Pago`; o backend retorna status como `PENDENTE`, `ATRASADO`, `VENCIDO`, `PAGO`, `RECEBIDO`.
