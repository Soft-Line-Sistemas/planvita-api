# Plano backend: Parcerias e vantagens

## Objetivo

Implementar o dominio de Parcerias e vantagens para alimentar a tela mobile do cliente e o fluxo mobile de cadastro, saindo do placeholder atual sem reaproveitar indevidamente o modelo `Beneficio`.

O modelo `Beneficio` existente esta ligado a `Plano` e representa beneficios/coberturas do contrato. Parcerias e vantagens devem ser tratadas como um catalogo comercial do tenant: parceiros, categorias, ofertas, regras de elegibilidade e, opcionalmente, registros de resgate.

## Estado atual identificado

- O frontend mobile autenticado ja mostra o atalho `Parcerias e vantagens` em `HomeScreen`.
- A tela `ParceriasScreen` existe, mas hoje exibe apenas uma mensagem de "Em breve".
- O cadastro mobile ja apresenta o servico adicional `Clube de beneficios`, com texto de descontos em parceiros.
- O backend ja possui autenticacao cliente via `cliente_token` e rotas cliente seguras em outros modulos, como financeiro e titular.
- A aplicacao usa banco por tenant via `tenantMiddleware`; o backend deve seguir esse isolamento tambem para parcerias.

## Escopo do MVP

1. Backoffice cadastra categorias, parceiros e vantagens.
2. Cliente autenticado lista e consulta vantagens elegiveis para ele.
3. Cadastro publico mobile consulta uma previa limitada de vantagens ativas para vender o "Clube de beneficios".
4. Vantagens podem ter cupom, link externo, WhatsApp, instrucoes de uso ou apenas informacao.
5. Regras minimas de publicacao, validade e elegibilidade por plano.

Fora do MVP:

- controle antifraude de cupom unico;
- validacao de uso pelo parceiro;
- geolocalizacao/ranking por distancia;
- integracao financeira ou comissionamento por parceiro;
- app do parceiro.

## Modelo de dados proposto

Criar novas tabelas Prisma, seguindo o padrao de banco por tenant. Se algum dia essas tabelas forem movidas para banco compartilhado, adicionar `tenantId` obrigatorio e indices por tenant.

```prisma
model ParceriaCategoria {
  id          Int      @id @default(autoincrement())
  nome        String
  slug        String   @unique
  descricao   String?
  icone       String?
  ordem       Int      @default(0)
  ativo       Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  vantagens   ParceriaVantagem[]
}

model Parceiro {
  id                Int      @id @default(autoincrement())
  nome              String
  slug              String   @unique
  descricaoCurta    String?
  descricaoCompleta String?
  logoUrl           String?
  bannerUrl         String?
  siteUrl           String?
  whatsapp          String?
  telefone          String?
  email             String?
  endereco          String?
  cidade            String?
  uf                String?
  ativo             Boolean  @default(true)
  destaque          Boolean  @default(false)
  ordem             Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  vantagens         ParceriaVantagem[]
}

model ParceriaVantagem {
  id                  Int      @id @default(autoincrement())
  parceiroId           Int
  categoriaId          Int?
  titulo               String
  slug                 String   @unique
  descricaoCurta       String?
  descricaoCompleta    String?
  tipo                 String   // DESCONTO_PERCENTUAL, DESCONTO_VALOR, BRINDE, CONVENIO, CUPOM, LINK_EXTERNO
  valorDesconto        Float?
  codigoCupom          String?
  linkResgate          String?
  instrucoesResgate    String?
  regrasUso            String?
  validadeInicio       DateTime?
  validadeFim          DateTime?
  publico              String   @default("CLIENTES_ATIVOS") // PUBLICO, CLIENTES_ATIVOS, PLANOS_ESPECIFICOS
  status               String   @default("RASCUNHO") // RASCUNHO, PUBLICADO, PAUSADO
  destaque             Boolean  @default(false)
  ordem                Int      @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  parceiro             Parceiro @relation(fields: [parceiroId], references: [id])
  categoria            ParceriaCategoria? @relation(fields: [categoriaId], references: [id])
  planos               ParceriaVantagemPlano[]
  resgates             ParceriaVantagemResgate[]

  @@index([status, destaque, ordem])
  @@index([categoriaId])
  @@index([parceiroId])
}

model ParceriaVantagemPlano {
  vantagemId Int
  planoId    Int

  vantagem   ParceriaVantagem @relation(fields: [vantagemId], references: [id], onDelete: Cascade)
  plano      Plano            @relation(fields: [planoId], references: [id], onDelete: Cascade)

  @@id([vantagemId, planoId])
}

model ParceriaVantagemResgate {
  id          Int      @id @default(autoincrement())
  vantagemId  Int
  titularId   Int
  canal       String?  // APP, WHATSAPP, LINK, CUPOM
  status      String   @default("REGISTRADO")
  createdAt   DateTime @default(now())

  vantagem    ParceriaVantagem @relation(fields: [vantagemId], references: [id], onDelete: Cascade)
  titular     Titular          @relation(fields: [titularId], references: [id], onDelete: Cascade)

  @@index([titularId, createdAt])
  @@index([vantagemId, createdAt])
}
```

Tambem adicionar campos de relacao nos modelos existentes:

```prisma
model Plano {
  // campos atuais...
  parceriasVantagens ParceriaVantagemPlano[]
}

model Titular {
  // campos atuais...
  parceriasResgates ParceriaVantagemResgate[]
}
```

`ParceriaVantagemResgate` pode ser adiado se o MVP for apenas catalogo. A rota de resgate pode inicialmente registrar clique/uso para auditoria simples.

## Regras de negocio

- Somente vantagens com `status = PUBLICADO` e parceiro ativo aparecem para cliente/cadastro.
- Vantagem expirada nao aparece; a expiracao deve considerar `validadeFim < now`.
- `publico = PUBLICO`: pode aparecer como previa no cadastro publico, mas sem expor cupom se for sensivel.
- `publico = CLIENTES_ATIVOS`: exige cliente autenticado e titular com `statusPlano` ativo.
- `publico = PLANOS_ESPECIFICOS`: exige cliente autenticado, plano ativo e vinculo em `ParceriaVantagemPlano`.
- Cliente suspenso pode ver a lista com CTA bloqueado ou nao ver vantagens, conforme decisao de produto. Recomendacao inicial: listar, mas bloquear resgate com mensagem de regularizacao.
- Admin pode salvar como `RASCUNHO` sem todos os campos finais, mas `PUBLICADO` deve exigir parceiro, titulo, tipo, descricao curta e pelo menos uma acao de resgate/instrucao.

## Endpoints propostos

Registrar rotas em:

```text
backend/src/routes/parcerias.routes.ts
backend/src/controllers/parcerias.controller.ts
backend/src/services/parcerias.service.ts
```

E montar em `app.ts`:

```text
/api/:version/parcerias
```

### Backoffice

Todas as rotas de backoffice devem usar `authenticate` + `authorize`.

```http
GET    /parcerias/categorias
POST   /parcerias/categorias
PUT    /parcerias/categorias/:id
PATCH  /parcerias/categorias/:id/status

GET    /parcerias/parceiros?q=&ativo=&destaque=
GET    /parcerias/parceiros/:id
POST   /parcerias/parceiros
PUT    /parcerias/parceiros/:id
PATCH  /parcerias/parceiros/:id/status

GET    /parcerias/vantagens?q=&status=&categoriaId=&parceiroId=&planoId=
GET    /parcerias/vantagens/:id
POST   /parcerias/vantagens
PUT    /parcerias/vantagens/:id
PATCH  /parcerias/vantagens/:id/status
DELETE /parcerias/vantagens/:id
```

Permissoes novas sugeridas:

```text
parcerias.view
parcerias.create
parcerias.update
parcerias.delete
```

Adicionar essas permissoes ao seed/rotina de permissoes e liberar para perfis administrativos. O perfil consultor nao deve receber permissao de escrita por padrao.

### Cliente autenticado

Usar `authenticateCliente`. Nenhuma rota cliente deve receber `titularId`.

```http
GET  /parcerias/cliente/categorias
GET  /parcerias/cliente/vantagens?q=&categoriaId=&destaque=&limit=&offset=
GET  /parcerias/cliente/vantagens/:slug
POST /parcerias/cliente/vantagens/:id/resgates
```

Resposta resumida:

```ts
type ClienteVantagemResumo = {
  id: number;
  slug: string;
  titulo: string;
  descricaoCurta: string | null;
  tipo: string;
  valorDesconto: number | null;
  validadeFim: string | null;
  destaque: boolean;
  elegivel: boolean;
  motivoBloqueio: string | null;
  categoria: { id: number; nome: string; slug: string; icone: string | null } | null;
  parceiro: { id: number; nome: string; slug: string; logoUrl: string | null; cidade: string | null; uf: string | null };
};
```

Resposta detalhada inclui `descricaoCompleta`, `regrasUso`, `instrucoesResgate`, `codigoCupom` e `linkResgate` apenas quando o cliente for elegivel.

### Cadastro publico

Sem cookie de cliente, mas ainda com `tenantMiddleware`.

```http
GET /parcerias/public/vantagens?limit=3
```

Retornar somente vantagens `PUBLICO` ou uma previa sanitizada de vantagens publicadas, sem `codigoCupom` quando houver restricao a cliente.

## Validacao e seguranca

- Validar payloads no controller ou em helpers dedicados; nao aceitar campos arbitrarios direto no Prisma.
- Normalizar `slug` no service e impedir duplicidade.
- Sanitizar URLs de `logoUrl`, `bannerUrl`, `siteUrl` e `linkResgate`.
- Em cliente, resolver titular por `req.cliente.titularId` e buscar o plano/status no banco antes de calcular elegibilidade.
- Em cadastro publico, limitar `limit` com teto pequeno, por exemplo 6.
- Evitar hard delete de parceiro/categoria com vantagens publicadas; preferir `ativo = false` ou bloqueio com erro 409.

## Ordem de implementacao backend

1. Criar migration Prisma com modelos de categoria, parceiro, vantagem, vinculo com plano e, se aprovado, resgate.
2. Gerar Prisma Client e ajustar tipos.
3. Criar `ParceriasService` com filtros, publicacao, elegibilidade e mapeadores DTO.
4. Criar controller/rotas de cliente e publicas.
5. Criar controller/rotas de backoffice.
6. Adicionar permissoes `parcerias.*`.
7. Criar testes de service para publicacao, validade e elegibilidade por plano/status.
8. Criar testes de controller para autenticacao cliente e permissoes administrativas.
9. Atualizar documentacao da API quando o contrato estabilizar.

## Criterios de aceite backend

- Admin consegue criar e publicar uma vantagem vinculada a parceiro e categoria.
- Cliente autenticado lista apenas vantagens publicadas, vigentes e elegiveis ou recebe `motivoBloqueio` quando a regra permitir exibicao bloqueada.
- Cliente nao envia nem controla `titularId`.
- Cadastro publico acessa somente previa sanitizada.
- Vantagem restrita a plano nao retorna cupom/link para cliente de outro plano.
- Tenant A nao acessa dados do tenant B.
- Testes cobrem ativo/inativo, publicado/rascunho, expirado/vigente e plano especifico.

## Validacao recomendada

```bash
cd backend
npm test
npm run build
```

Fluxos manuais minimos:

- criar categoria, parceiro e vantagem no painel;
- publicar vantagem e listar como cliente ativo;
- testar cliente com plano nao elegivel;
- testar vantagem expirada;
- abrir endpoint publico do cadastro sem cookie.
