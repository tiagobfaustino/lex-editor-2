# Tarefas — Feature 005

## Contratos desktop

- [x] T005-01 Definir DTOs paginados de comando, progresso, preview e
  diagnóstico, com limites explícitos. Schemas runtime fechados, IDs e
  cursores opacos, conteúdo somente como texto plano e limites independentes
  de cardinalidade, campos e bytes.
- [x] T005-02 Implementar capacidades IPC de seleção/processamento/exportação
  e testes negativos. Preload expõe apenas métodos nomeados; handlers recebem
  efeitos injetáveis e validam remetente, frame principal, origem, schema,
  tamanho, autorização e saída. Serviços ainda não implementados falham sem
  simular sucesso.

## Fluxo local

- [x] T005-03 Implementar seleção nativa e importação `.html`/`.md` com
  snapshot.
- [x] T005-04 Implementar árvore de preview sanitizada, metadados, callouts,
  históricos e navegação.
- [x] T005-05 Integrar diagnósticos clicáveis e progresso/cancelamento.
- [x] T005-06 Implementar exportação atômica dos bytes do Formatter.

## Fluxo de rede

- [x] T005-07 Implementar resolução/fetch do conjunto Planalto com allowlist,
  DNS/redirect, timeout, tamanho, tipo de conteúdo e snapshot por artefato.
- [x] T005-08 Integrar Defuddle no main e provar paridade URL/arquivo.

## Validação

- [x] T005-09 Testar SSRF, XSS, IPC forjado e cancelamento.
- [x] T005-10 Executar E2E importar → preview → diagnóstico → exportar e
  validar desempenho com lei extensa.
