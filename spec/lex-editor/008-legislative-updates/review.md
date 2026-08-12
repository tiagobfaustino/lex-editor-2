# Review — Feature 008

## Resultado

A feature encerra com separação comprovada entre detecção, decisão editorial e
publicação. O worker cria propostas deduplicadas, mas não possui autoridade para
alterar conteúdo normativo, decidir uma pendência ou alcançar o publicador. A
aprovação humana prepara um release candidate e percorre as validações da
Feature 007 antes de qualquer troca da versão pública.

## Decisões permanentes

- A identidade editorial validada é entregue ao gateway junto com a proposta;
  ela não é aceita da coleta nem inferida pelo worker.
- Reprocessamento preserva `error` ou `rejected` até existir novo resultado do
  worker, evitando transformar falha técnica em candidata aprovável.
- A prova E2E combina Git real e o serviço real da Feature 007 com gateways de
  tentativa/transação em memória; a autoridade e atomicidade SQL são verificadas
  independentemente em PostgreSQL 16 descartável.
- O teste de menor privilégio tenta mutações em lei, versão, dispositivo e Block
  ID, além de decisão editorial, troca de role, aprovação e publicação. Todas
  devem falhar com a identidade do worker.

## Evidências de encerramento

- `npm run test:updates-e2e` — detecção, diff, aprovação ligada ao ator,
  manifesto, candidate Git, promoção, publicação e rejeição sem mudança pública;
  inclui a prova PostgreSQL de menor privilégio.
- `npm run test:publication-staging` — publicador hospedado, retry idempotente e
  leitura pública revalidados no staging exclusivo. Prova final: publicação
  `f168d314-8025-463b-bef1-c5fbca9b5239`, SHA
  `c1ea7993b7fefa3bb8f374ca67a4de1ac14c8823` e versão pública
  `fe7fc64d-e0ef-4c08-9f40-d3c8bb117d27`.
- `npm run test:unit` — 381 testes aprovados em 41 arquivos.
- `npm run test:e2e:only` — 11 cenários Electron/Playwright aprovados.
- `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm run test:boundaries` e `npm run check:data-model`.
- `npm run build:app`, `npm run build:publisher-edge` e varreduras de saída sem
  secrets, paths privados, AST ou payload proibido.

Não permaneceram critérios de aceite ou tarefas abertas na Feature 008.
