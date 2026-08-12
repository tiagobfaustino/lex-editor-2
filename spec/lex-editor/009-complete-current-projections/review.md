# Review — Feature 009

## Resultado

A feature encerra com uma única `IdentifiedNormaAST` autoritativa capaz de
gerar os perfis `complete_with_history` e `current_only`. Preview e exportação
usam a mesma projeção pura; a preferência visual não altera revisão, diário,
aprovação ou Block IDs. O perfil completo permanece a publicação canônica.

## Decisões permanentes

- Redações anteriores riscadas não recebem Block ID. Nas Leis nº 9.099/1995 e
  nº 10.826/2003, somente a redação atual da posição recebe a âncora.
- Veto, revogação e suspensão prevalecem quando outra anotação oficial aparece
  depois deles. Isso impede que `(VETADO) (Incluído...)` seja projetado como
  texto vigente.
- A Lei nº 10.826/2003 usa a página compilada como `primary_current` e a
  anotada como `historical_auxiliary`. Quatro conflitos reais ficam registrados
  em `fixtures/legal/l10826/decisoes-mesclagem.json`, presos aos hashes dos
  snapshots; o texto primário é mantido e o nó auxiliar conflitante não
  enriquece a AST.
- O anexo sem numeral do Estatuto do Desarmamento é identificado como
  `anx-unico`. A tabela HTML vigente e suas versões riscadas são preservadas de
  forma retangular, com um único Block ID para a tabela atual.
- `scripts/reextrair-fixture.mjs` reproduz `entrada.txt` a partir do snapshot
  local, permitindo atualizar a projeção de extração sem acessar a rede.

## Evidências de encerramento

- Snapshots oficiais, manifestos com SHA-256 e goldens dos dois perfis em
  `fixtures/legal/{l9099,l9605,l10826}/`.
- `tests/pipeline/real-law-projections.test.ts` — reprodução offline dos
  snapshots, determinismo, validação canônica, imutabilidade, fonte única,
  par compilada/anotada, arts. 61/62 e anexo/tabelas históricos.
- `tests/main/local-project-service.test.ts` — alternância integrada, aprovação,
  preferência fora do diário e conjunto compilada/anotada.
- `tests/e2e/import-workflow.spec.ts` — Electron real alterna e exporta os dois
  perfis da Lei nº 9.099/1995, mantendo um único Block ID no art. 61.
- `npm test` — 418 testes aprovados em 44 arquivos.
- `npm run test:e2e` — 12 cenários Electron/Playwright aprovados.
- `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm run test:boundaries`, `npm run check:data-model` e
  `npm run check:sensitive-output` aprovados.

Não permaneceram critérios de aceite ou tarefas abertas na Feature 009.
