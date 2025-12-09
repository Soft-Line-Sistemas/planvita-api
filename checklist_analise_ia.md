
# Checklist para IA Analisar Código em Busca de Vulnerabilidades

Este arquivo serve como guia para uma IA revisar seu código e identificar potenciais falhas que permitam upload ou execução de arquivos maliciosos.

## 1. Procurar Uso Perigoso de Execução de Código
- `child_process.exec()`
- `child_process.execSync()`
- `child_process.spawn()`
- `eval()`
- `new Function()`
- Qualquer função que monte comandos shell com dados do usuário.

## 2. Verificar Uploads de Arquivo
- Uso de `multer`, `formidable`, `busboy` ou libs similares.
- Validar:
  - extensão
  - MIME type
  - tamanho
  - diretório de destino
- Garantir que o usuário **não controla o caminho** (`path traversal`).

## 3. Verificar Escrita de Arquivos em Disco
- `fs.writeFile()`
- `fs.writeFileSync()`
- `fs.appendFile()`

Certifique-se de que nenhum dado fornecido pelo usuário define o nome, extensão ou caminho do arquivo.

## 4. Verificar APIs Expostas sem Proteção
- Rotas acessíveis fora do Nginx (0.0.0.0).
- Ambientes de desenvolvimento rodando em produção.
- Serviços Next.js, Node.js ou Python expostos diretamente.

## 5. Verificar Vulnerabilidades de Path Traversal
Buscar código que permita:

```js
req.query.file
req.params.file
req.body.file
```

E que seja usado diretamente em:

```js
readFile
writeFile
sendFile
fs.*
```

## 6. Verificar Integrações com Puppeteer
- URLs fornecidas por usuários.
- Geração de PDF a partir de páginas externas.
- Manipulação de arquivos com caminhos controlados pelo usuário.

## 7. Verificar Dependências Vulneráveis
- Rodar `npm audit` ou `yarn audit`.
- Verificar libs antigas que manipulam arquivos, uploads, SSR ou expressões dinâmicas.

## 8. Identificar Qualquer Lógica de Debug Exposta
- Next.js em modo dev.
- APIs retornando erros detalhados.
- Variáveis internas expostas na resposta.

## 9. Identificar Possíveis Pontos de RCE (Remote Code Execution)
- Construção de comandos shell.
- Templates com injeção (EJS, Nunjucks, Handlebars).
- Libraries que não escapam corretamente conteúdo.

## 10. Relatório Final
A IA deverá produzir um relatório contendo:
1. Arquivo vulnerável
2. Linha do código
3. Descrição da vulnerabilidade
4. Como explorá-la
5. Como corrigir
