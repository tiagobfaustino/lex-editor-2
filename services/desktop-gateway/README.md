# Gateway do desktop

Serviço Node 22 com operações HTTP fechadas. O Electron não recebe conexões SQL,
credenciais de workload ou autoridade de promoção. Cada chamada valida o bearer
individual no Supabase Auth e consulta o perfil ativo no banco. Curador e
Administrador Técnico mantêm permissões distintas.

## Configuração do servidor

Aplique as migrations em ordem, incluindo `20261008120000`, `20261008130000` e
`20261008140000` e `20261008150000`. Compile com `npm run build:desktop-gateway` e execute
`node dist/desktop-gateway/server.mjs` com dependências de produção instaladas.
Antes da migration de reprocessamento, pause o claim de jobs e aguarde os workers
antigos concluírem seus claims. Só então aplique as migrations e reinicie com o
worker atualizado. A conclusão antiga não carrega `requestId` e deixa de ser
permitida; não há protocolo novo de lease ou recuperação de worker interrompido.

O serviço escuta em `127.0.0.1:8788` (ou `PORT`), atrás de um proxy HTTPS.

- `SUPABASE_URL`: origem HTTPS do Supabase Auth.
- `SUPABASE_ANON_KEY`: chave pública de autenticação.
- `GATEWAY_CATALOG_DB_URL`: login limitado a `lex_source_catalog_admin`.
- `GATEWAY_IMPORTER_DB_URL`: login limitado a `lex_source_catalog_importer`.
- `GATEWAY_UPDATE_EDITOR_DB_URL`: login limitado a `lex_update_editor`.
- `GATEWAY_AUDIT_READER_DB_URL`: login limitado a `lex_audit_reader`.
- `GATEWAY_PUBLICATION_READER_DB_URL`: login limitado a `lex_editor_reader`.

Use conexões separadas com os grants dessas roles. Não use superuser, conexão do
publisher ou chave `service_role` para o gateway. As roles das migrations são
`NOLOGIN`; o provisionamento dos logins, senhas e TLS pertence ao ambiente de
hospedagem. O publisher existente continua sendo o único responsável por
aprovação, promoção por SHA e sincronização transacional.

## Configuração da estação

O processo main lê `LEX_EDITOR_SUPABASE_URL`, `LEX_EDITOR_SUPABASE_ANON_KEY`,
`LEX_EDITOR_GATEWAY_URL` e `LEX_EDITOR_REPOSITORY_ROOT` (checkout Git absoluto).
`LEX_EDITOR_CANONICAL_BRANCH` é opcional, com padrão `main`. Todas as URLs devem
usar HTTPS público; DNS privado, redirecionamentos e respostas excessivas são
recusados. O checkout precisa ter `origin` e credenciais Git já configurados.
A lei deve estar cadastrada no banco; o desktop não provisiona leis.

O painel de sessão autentica o usuário individual. Tokens e refresh tokens ficam
somente na memória do main. O logout limpa a sessão local mesmo sem conectividade.
Sem configuração remota, importação, revisão e exportação locais continuam
funcionando; capacidades remotas permanecem indisponíveis.

A publicação prepara artefatos e um rascunho duráveis em worktree separado. A
confirmação humana envia somente a branch `releases/<publicationId>`; o publisher
valida e promove o SHA. A aprovação de uma atualização prepara o release e
vincula seu digest à candidata persistida, antes de uma confirmação separada de
publicação. Retries reutilizam o rascunho e a mesma identidade.

## Verificação local

`npm run test:publication-db` aplica todas as migrations em PostgreSQL
descartável. `tests/e2e/publication-audit-workflow.spec.ts` cria uma publicação
pelo publisher real e a encontra no Electron por três filtros. Essas provas não
implantam serviços nem substituem a configuração do ambiente de produção.
