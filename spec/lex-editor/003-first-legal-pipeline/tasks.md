# Tarefas — Feature 003

## Preparação

- [x] T003-01 Selecionar fixture oficial curta, registrar função, variante,
  origem/hash de cada artefato e revisão humana esperada.
- [x] T003-02 Definir relatório estruturado e contratos entre estágios.

## Corte vertical

- [x] T003-03 Implementar conjunto de snapshots locais imutáveis com
  `sourceRef` e `supportingSourceRefs`.
- [x] T003-04 Implementar parser mínimo da fixture e seus casos negativos.
- [x] T003-05 Implementar atribuição inicial determinística de IDs do
  subconjunto com validação de unicidade.
- [x] T003-06 Implementar Formatter canônico do subconjunto com frontmatter,
  callouts e histórico aplicável.
- [x] T003-07 Implementar CLI e escrita atômica sem saída parcial.

## Validação

- [x] T003-08 Criar golden e testar duas execuções byte a byte.
- [x] T003-09 Testar inciso órfão/falha intermediária e códigos de saída.
- [x] T003-10 Revisar golden contra a fonte e demonstrar o comando ponta a
  ponta. A conferência contra o Planalto encontrou seis divergências, todas
  corrigidas e fixadas em teste; ver `review.md`.
