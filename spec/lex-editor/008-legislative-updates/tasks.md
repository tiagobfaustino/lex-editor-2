# Tarefas — Feature 008

## Detecção

- [x] T008-01 Implementar projeção normativa, conjunto de fontes e hashes
  brutos por artefato/normativo.
- [x] T008-02 Implementar diff estrutural e fixtures antes/depois para
  inclusão, alteração, revogação e renumeração, incluindo recortes
  versionados das Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003.
- [x] T008-03 Testar mudança cosmética ou apenas histórica, conflito entre
  fontes, baixa confiança e identidade ambígua; Markdown editorial externo é
  comparador auxiliar sem tags, realces ou formatação pessoal, nunca golden.

## Worker e fila

- [x] T008-04 Implementar worker, scheduler, backoff e suspensão de fonte
  degradada.
- [x] T008-05 Implementar chave de deduplicação, supersessão e retry.
- [x] T008-06 Criar funções/RPCs da fila com identidade de menor privilégio.

## Revisão

- [x] T008-07 Implementar consulta e diff anterior/depois no Lex Editor.
- [x] T008-08 Implementar aprovação via Feature 007 e rejeição motivada.
- [x] T008-09 Implementar contador e estados de erro/reprocessamento.

## Validação

- [x] T008-10 Provar que a credencial do worker não escreve conteúdo
  normativo.
- [x] T008-11 Executar E2E de detecção → aprovação → publicação e de rejeição
  sem alteração pública.
