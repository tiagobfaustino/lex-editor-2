# Review — Feature 012

## Resultado

A feature encerra com edição estruturada do frontmatter sobre a revisão
corrente da `IdentifiedNormaAST`, sem YAML editável ou store paralelo no
renderer. Campos editoriais e de identidade pré-publicação passam por política
contextual, validação runtime, confirmação explícita, diário durável e
invalidação de aprovação. Preview, exportação e candidato de publicação usam o
mesmo hash confirmado.

## Decisões permanentes

- A projeção de metadados enumera valor, origem, mutabilidade e motivo de
  bloqueio para todos os campos suportados. Proveniência, sistema e derivados
  permanecem visíveis, mas não são entradas editáveis.
- Sigla, tipo, número e ano só mudam com prova autoritativa de ausência de
  publicação. Versão publicada bloqueia identidade; autoridade indisponível
  falha fechada somente nesses campos e não impede correções editoriais offline.
- Mudança pré-publicação de identidade promove AST, Block IDs, catálogo,
  layouts e referências como uma única transação. Colisão ou falha de derivação
  preserva integralmente a revisão anterior.
- O renderer envia diff fechado, `expectedRevisionHash` e motivo. Conflito não
  aplica last-write-wins: mantém o draft e permite carregar a revisão atual para
  nova comparação.
- Recuperação reexecuta apenas comandos confirmados do diário. Checkpoint
  ausente ou corrompido refaz o replay desde a base; validação e aprovação não
  recebem sucesso falso após reinício.

## Evidências de domínio e integração

- `tests/domain/frontmatter-metadata.test.ts` cobre a matriz completa de 21
  campos, estados de publicação, regras cruzadas e rejeição de todos os grupos
  controlados, inclusive em chamada direta e replay adulterado.
- `tests/domain/metadata-identity-transaction.test.ts` prova autoridade,
  identidade publicada, promoção atômica, colisão, aliases, layouts, referências
  e preservação do texto jurídico.
- `tests/main/editorial-project-store.test.ts` cobre crash, checkpoint, replay,
  diário adulterado e recuperação da alteração de metadados após reinício.
- `tests/main/local-project-service.test.ts` comprova conflito obsoleto,
  persistência durável, falha de escrita sem promoção, identidade publicada e
  edição comum offline com apenas a identidade bloqueada.
- `tests/e2e/metadata-form-accessibility.spec.ts` atravessa teclado, erro inline,
  cancelamento, confirmação, preview, validação, aprovação, exportação, conflito
  preservado e contraste entre identidade publicada e pré-publicação.

## Leis reais

As Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003 foram reprocessadas a
partir dos snapshots oficiais offline e tiveram o ramo editado pelo mesmo
comando de metadados. Nos três casos, as projeções `complete_with_history` e
`current_only` permaneceram canônicas e determinísticas, com texto jurídico e
Block IDs inalterados. A Lei nº 10.826/2003 continuou usando a compilada como
fonte primária e a anotada como histórica auxiliar.

## Validações de encerramento

- `npm run typecheck`, `npm run lint`, `npm run format:check` e
  `git diff --check` aprovados.
- `npm run test:unit` — 566 testes aprovados em 64 arquivos.
- `npm run test:e2e` — 15 cenários Electron/Playwright aprovados.
- `npm run test:publication-db`, `npm run test:boundaries` e
  `npm run check:data-model` aprovados.
- `npm run build:unpacked`, inspeção de `release/linux-unpacked` e
  `npm run check:sensitive-output` aprovados.

O artefato Linux desempacotado é de validação local e não possui assinatura ou
notarização de distribuição. Não permaneceram critérios de aceite ou tarefas
abertas na Feature 012.
