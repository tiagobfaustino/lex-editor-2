# Review — Feature 007

## Resultado

A feature encerra com publicação autorizada fora do Electron: a estação cria
somente um release candidate, e a workload autenticada revalida os bytes no
Git, promove o SHA exato e sincroniza o snapshot jurídico em uma transação
idempotente. Falhas continuam explícitas e retomáveis, sem sucesso falso.

## Decisões permanentes

- A autoridade hospedada é a Edge Function `publisher`. O bundle é gerado a
  partir do mesmo serviço TypeScript testado; credenciais Git e conexão de
  banco permanecem somente nos secrets da plataforma.
- O papel normativo `curador` é traduzido para a função editorial
  `editor_juridico` registrada na aprovação. O enum persistido do modelo de
  dados não foi ampliado silenciosamente.
- O schema privado expõe apenas funções fechadas ao papel `lex_publisher`.
  Funções e tabelas do agregado pertencem a `lex_publication_owner`, papel sem
  login; `anon` e `authenticated` não recebem escrita normativa.
- JSONB é entregue como objeto ao driver, evitando serialização dupla. A
  projeção do domínio traduz `versao` para `version` somente no payload interno
  do publisher.
- O staging real é exclusivo: projeto Supabase `lex-editor-staging`
  (`avwrnoaahikucbnittzb`) e repositório Git privado
  `tiagobfaustino/lex-editor-publication-staging`.

## Evidências de encerramento

- `npm run test:publication-staging` — aprovação autenticada, candidate,
  promoção de SHA, transação, leitura pública e replay idempotente aprovados;
  o próprio runner varreu o log sem violações.
- Última prova final: publicação `6583bd9e-3178-4cd7-83c4-507cbef87d15`, SHA
  `3bbb294fa7b6981fedd46ab49eb3a8eb7580db62` e versão pública
  `7a28969f-4815-4428-8c0e-084cacf0a8b3`.
- Edge Function `publisher` ativa com verificação JWT; o secret temporário de
  diagnóstico foi removido antes do deployment final.
- `npm run test:publication-db` — funções, permissões, corrida e transação
  aprovadas em PostgreSQL descartável.
- `npm run test:unit` — 349 testes aprovados.
- `npm run lint`, `npm run typecheck` e `npm run format:check`.
- `npm run build:app` e `npm run build:publisher-edge`.
- `node scripts/scan-sensitive-output.mjs
  supabase/functions/publisher/generated/runtime.js` — bundle sem violações.

Não permaneceram critérios de aceite ou tarefas abertas na Feature 007.
