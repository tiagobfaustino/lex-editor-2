# Tarefas — Feature 009

## Domínio e Formatter

- [x] T009-01 Implementar contrato e projeção pura
  `complete_with_history`/`current_only`, com bloqueio de estado desconhecido e
  preservação de identidade.
- [x] T009-02 Integrar os perfis ao Formatter, identificar a saída e criar
  goldens determinísticos mínimos.

## Desktop

- [x] T009-03 Expor seleção de projeção no preview e na exportação por contrato
  IPC mínimo, sem enviar AST integral ao renderer.
- [x] T009-04 Persistir a preferência de visualização sem criar outra revisão
  jurídica nem alterar o perfil canônico de publicação.

## Leis reais e validação

- [x] T009-05 Versionar snapshots das Leis nº 9.099/1995, nº 9.605/1998 e
  nº 10.826/2003 e validar as duas projeções sem rede em CI.
- [x] T009-06 Executar integração/E2E de alternância e exportação, incluindo
  histórico, revogação, fonte única e par compilada/anotada.
