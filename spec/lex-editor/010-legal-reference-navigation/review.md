# Review — Feature 010

## Resultado

A feature encerra com referências jurídicas como projeção derivada, vinculada
à revisão e independente da NormaAST. Menções internas e externas só recebem
wikilink quando catálogo, contexto e Block ID provam um alvo único. O mesmo
índice resolvido alimenta preview, pacote `VincuLex` e arestas SQL.

## Decisões permanentes

- Citar somente um artigo, parágrafo, inciso, alínea ou item seleciona
  exatamente esse nível; seus descendentes não são candidatos implícitos.
- Quando a Constituição contém o mesmo número de artigo no texto permanente e
  no ADCT, uma menção não qualificada como `art. 37 da Constituição Federal`
  seleciona o Block ID não qualificado do texto permanente. A resolução
  registra evidência de contexto estrutural e continua falhando fechada quando
  não existe um único candidato principal.
- Markdown pessoal é apenas referência editorial auxiliar. Tags HTML,
  realces, ênfase, wikilinks e Block IDs pessoais são removidos antes do
  parsing; o label visível é preservado e comparado ao snapshot oficial.
- A fixture NLLC preserva o snapshot oficial completo e sua extração completa.
  O golden executável é o art. 1º, recorte juridicamente suficiente para os
  dois exemplos desta feature; isso evita transformar duplicações históricas
  do restante da página anotada em decisões editoriais alheias à navegação.

## Evidências de encerramento

- `fixtures/legal/nllc/` — snapshot oficial de 649.424 bytes, SHA-256
  `9774693d9d7df92b7f24eb6d4d486d38729bbecf6f87aaaa8e6e3169c904a3cc`,
  extração completa com 1.555 linhas e 211 ocorrências de artigo, recorte do
  art. 1º, golden canônico e referência pessoal decorada com hashes conferidos.
- `tests/domain/legal-reference-real-laws.test.ts` — § 4º para
  `nllc-art-1-par-3`, § 5º para `cf1988-art-37`, integridade da fixture,
  sanitização do Markdown pessoal, dois perfis e determinismo com `fetch`
  proibido.
- `tests/domain/legal-reference-resolution.test.ts` — catálogo ausente,
  importação posterior sem mudar revisão/referenceId, alias ambíguo, alvo
  removido e decisão editorial persistente.
- `tests/e2e/import-workflow.spec.ts` — Electron real com fixtures oficiais da
  NLLC e da CF/1988: hover, foco, `Escape`, clique externo, retorno e ativação
  interna por `Enter`.
- `npm run review:vinculex -- <vault-isolado>` gerou e revalidou dois arquivos.
  No Obsidian 1.13.6, em perfil isolado, o cache nativo reconheceu os links
  `[[#^nllc-art-1-par-3|§ 3º]]` e
  `[[VincuLex/constituicao-da-republica-federativa-do-brasil-de-1988/cf1988#^cf1988-art-37|caput do art. 37]]`, localizou os dois Block IDs e abriu a
  CF/1988 no link externo e a própria NLLC no link interno.
- `npm run test:unit` — 470 testes aprovados em 51 arquivos.
- `npm run test:e2e` — 13 cenários Electron/Playwright aprovados.
- `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm run test:boundaries` e `npm run check:data-model` aprovados.

Não permaneceram critérios de aceite ou tarefas abertas na Feature 010.
