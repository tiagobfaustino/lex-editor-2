# Instruções do projeto

O contrato de trabalho deste repositório está em `AGENTS.md`, `spec/README.md`,
`spec/DEVELOPMENT_RULES.md` e `spec/TEST_STRATEGY.md`. Leia-os antes de
implementar. As regras abaixo tratam apenas de ferramenta de navegação e não
alteram aquela precedência.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

`graphify-out/` não é versionado: é gerado localmente e não existe em um clone
novo. Para construí-lo, defina `GEMINI_API_KEY` e rode
`graphify extract . --backend gemini --max-concurrency 1`. O escopo do grafo
está em `.graphifyignore`, que é versionado — skills de agente e os textos
legais de `exemplos/` ficam de fora de propósito.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
