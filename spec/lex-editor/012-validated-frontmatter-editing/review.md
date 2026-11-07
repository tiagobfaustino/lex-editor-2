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


## Correção de salvamento com importações repetidas — 2026-10-08

O erro genérico ao salvar metadados reproduziu como
`metadata_derivation_failed` com duas importações da mesma lei. O contexto
usado pela transação enviava todas as revisões ao catálogo, que exige uma
única revisão selecionada por identidade jurídica. A navegação já aplicava
essa seleção; o serviço agora compartilha a mesma lógica. Na edição de
metadados, a revisão editada prevalece sobre outra importação da mesma lei,
inclusive quando é anterior. A seleção ocorre antes do patch: colisão da
identidade pretendida com outra lei continua falhando no domínio.

A regressão prova edição da importação mais recente e da anterior, manutenção
da outra revisão, recuperação pelo store e atualização do preview. Os dois
snapshots reais do Código Penal também passam no salvamento de ramo e tags
com revisões jurídicas pendentes; a alteração mantém evidências e os bloqueios
de aprovação. O E2E importa a LINDB duas vezes antes de percorrer o formulário
com teclado, validação, salvamento, aprovação, exportação e conflito.

Validação: 69 testes nos três arquivos de serviço/domínio, um E2E completo no
Electron, typecheck, lint, format check, build do app, fronteiras, auditoria
das 26 interfaces sem divergências e `git diff --check`. Graphify atualizado
por AST. Não há migração nem exclusão de dados locais; o patch utiliza os
mesmos comandos, diário e política de mutabilidade existentes.
