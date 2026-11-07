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

## Correção de layout — 2026-11-06

O grid externo distribuía preview e validação entre painéis de metadados e
serviços. Na reprodução com a Lei 9.099 (99 artigos), os topos dos painéis
ficaram separados por 3.134 pixels após validar, sem erro de JavaScript.

Um bloco de revisão próprio mantém preview e validação na mesma linha em
janelas largas e empilha os painéis até 1.100 pixels. Foram removidos o span
de duas linhas do preview e a mudança de coluna ao recolher a validação.
Conteúdo jurídico, persistência e contratos IPC não foram alterados.

Evidências:

- `npm run test:e2e -- tests/e2e/revision-layout.spec.ts`: falhou antes da
  correção pela separação vertical dos painéis; passou após o ajuste.
- O teste usa Electron e arquivo local em configuração temporária. Confere
  geometria em 1.280 e 900 pixels, botão de validação no viewport, ausência
  de erros do renderer e estabilidade da rolagem após validar. Capturas das
  duas larguras foram inspecionadas visualmente.
- `npm run test:e2e:only -- tests/e2e/revision-layout.spec.ts tests/e2e/smoke.spec.ts tests/e2e/local-law-library.spec.ts`:
  11 cenários passaram, incluindo biblioteca, CSP, isolamento e allowlist IPC.
- `npm run typecheck`, `npm run build:app`, `npm run check:pre-commit` e
  `git diff --check`: passaram. Grafo atualizado com `graphify update .`.

### Pendências preexistentes da suíte ampla de importação

A execução conjunta de importação, biblioteca, layout e smoke teve 14 de 16
cenários aprovados. As mesmas duas falhas foram reproduzidas com o renderer
do commit `af09d9d`, anterior à correção visual:

- `import-workflow.spec.ts`, cenário “importa, navega por diagnóstico,
  bloqueia conteúdo ativo e exporta bytes canônicos”: a segunda importação
  mantém `lindb-maliciosa.html` em `.selected-source`, quando o teste espera
  `lindb-canonica.md`.
- `import-workflow.spec.ts`, cenário “abre preview acessível e navega entre
  referências internas e externas”: `configureDialogs` falha com
  `Resulting promise was garbage collected`. Esse cenário passou quando
  executado isoladamente.

Essas pendências não foram corrigidas neste ajuste. A suíte ampla continua
sem aprovação integral; os critérios específicos de layout foram demonstrados.
