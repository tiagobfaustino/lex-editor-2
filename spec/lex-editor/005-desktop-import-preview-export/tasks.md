# Tarefas — Feature 005

## Contratos desktop

- [ ] T005-01 Definir DTOs paginados de comando, progresso, preview e
  diagnóstico, com limites explícitos.
- [ ] T005-02 Implementar capacidades IPC de seleção/processamento/exportação
  e testes negativos.

## Fluxo local

- [ ] T005-03 Implementar seleção nativa e importação `.html`/`.md` com
  snapshot.
- [ ] T005-04 Implementar árvore de preview sanitizada, metadados, callouts,
  históricos e navegação.
- [ ] T005-05 Integrar diagnósticos clicáveis e progresso/cancelamento.
- [ ] T005-06 Implementar exportação atômica dos bytes do Formatter.

## Fluxo de rede

- [ ] T005-07 Implementar fetch Planalto com allowlist, DNS/redirect,
  timeout, tamanho e tipo de conteúdo.
- [ ] T005-08 Integrar Defuddle no main e provar paridade URL/arquivo.

## Validação

- [ ] T005-09 Testar SSRF, XSS, IPC forjado e cancelamento.
- [ ] T005-10 Executar E2E importar → preview → diagnóstico → exportar e
  validar desempenho com lei extensa.
