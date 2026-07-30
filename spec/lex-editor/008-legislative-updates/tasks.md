# Tarefas — Feature 008

## Detecção

- [ ] T008-01 Implementar projeção normativa e hashes bruto/normativo.
- [ ] T008-02 Implementar diff estrutural e fixtures antes/depois para
  inclusão, alteração, revogação e renumeração.
- [ ] T008-03 Testar mudança cosmética, baixa confiança e identidade ambígua.

## Worker e fila

- [ ] T008-04 Implementar worker, scheduler, backoff e suspensão de fonte
  degradada.
- [ ] T008-05 Implementar chave de deduplicação, supersessão e retry.
- [ ] T008-06 Criar funções/RPCs da fila com identidade de menor privilégio.

## Revisão

- [ ] T008-07 Implementar consulta e diff anterior/depois no Lex Editor.
- [ ] T008-08 Implementar aprovação via Feature 007 e rejeição motivada.
- [ ] T008-09 Implementar contador e estados de erro/reprocessamento.

## Validação

- [ ] T008-10 Provar que a credencial do worker não escreve conteúdo
  normativo.
- [ ] T008-11 Executar E2E de detecção → aprovação → publicação e de rejeição
  sem alteração pública.
