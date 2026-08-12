# Review — Feature 006

## Resultado

A feature encerra com correção editorial rastreável sobre a NormaAST,
validação completa ligada à revisão, aprovação local invalidável, recuperação
durável, exportação individual/em lote e `UPDATE.md` determinístico.

## Decisões permanentes

- Recuperação reexecuta somente o diário confirmado. Checkpoint ausente,
  inválido ou corrompido causa replay desde a base; diário corrompido falha
  fechado.
- Aprovação não é restaurada após reinício. A cópia de trabalho e os comandos
  são recuperados, mas validação completa e aprovação precisam ser refeitas,
  evitando sucesso falso.
- Reprocessamento conserva correções quando a base é idêntica. Se a base mudou
  e já existem comandos, retorna conflito explícito com os command IDs
  preservados; não tenta rebase heurístico nem descarta decisões editoriais.
- O lote promove cada lei a partir de staging próprio e devolve sucesso ou
  falha por projeto, sem transformar falha parcial em sucesso global.

## Evidências de encerramento

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test -- --run` — 309 testes aprovados.
- `npm run test:boundaries`
- `npm run check:data-model` — 22 interfaces, nenhuma divergência.
- `npm run test:e2e:only` — 11 cenários aprovados, inclusive importar →
  corrigir → validar → aprovar → exportar e conferir os bytes.

Não permaneceram desvios normativos ou débitos conhecidos dentro do escopo da
feature 006.
