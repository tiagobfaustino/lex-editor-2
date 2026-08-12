# Plano de Implementação — Feature 010

## Abordagem

Criar uma etapa derivada entre `IdentifiedNormaAST` e as projeções de consumo.
Ela detecta menções por gramática, resolve identidades e localizadores contra
um catálogo local e produz um índice imutável por revisão. Formatter, preview e
projeção SQL consomem esse índice sem modificar a árvore normativa.

## Componentes afetados

- `packages/legal-domain/src/legal-reference/` para gramática, contratos,
  catálogo, resolução e aplicação segura de spans.
- `packages/legal-domain/src/formatter/` para wikilinks e `aliases`.
- `packages/legal-domain/src/postgres-projection/` para arestas estruturadas.
- `src/main/` para catálogo local, resolução de destino, preview e navegação.
- `src/shared/ipc/` e `src/preload/` para capacidades mínimas.
- `src/renderer/src/features/preview/` para links, popover acessível e histórico
  de navegação.
- `fixtures/legal/nllc/` e fixtures existentes da CF/1988.
- especificações `DATA_MODEL.md` e `MARKDOWN_SPEC.md`.

## Contratos e fluxo

```text
IdentifiedNormaAST + revisionHash
  → detector de menções
  → localizadores jurídicos estruturados
  → resolvedor contextual + catálogo de leis/aliases
  → LegalReferenceIndex
  → projeção de conteúdo
  → Formatter / Preview DTO / projeção SQL
```

O catálogo indexa chave canônica, lei/revisão disponível, título, sigla,
aliases, path lógico de publicação e Block IDs. Apenas a materialização do
Markdown converte o path lógico em caminho wiki sob `VincuLex`.

## Decisões locais

- Usar offsets UTF-16, coerentes com strings JavaScript, acompanhados do trecho
  literal; qualquer divergência invalida o span.
- Separar `detected`, `resolved`, `unresolved` e `ambiguous` em schema runtime
  discriminado.
- Aplicar links da direita para a esquerda em cada campo, depois de rejeitar
  spans sobrepostos, para não deslocar offsets ainda não processados.
- Preservar o label literal; normalização serve somente à análise.
- Resolver referências internas antes das externas, pois o contexto da árvore
  é autoritativo para `deste artigo` e `desta Lei`.
- Gerar preview do bloco-alvo como texto e metadados sanitizados, não como HTML
  nem Markdown arbitrário.
- Cachear DTOs por revisão + Block ID e invalidar ao trocar revisão publicada
  ou catálogo.
- Tratar aliases do frontmatter como auxiliares de descoberta; colisão nunca é
  resolvida por ordem de cadastro.

## Erros e recuperação

- Span inválido, sobreposto ou com trecho divergente: erro bloqueante da
  projeção de links, sem tocar na NormaAST.
- Alvo anteriormente resolvido que deixou de existir: invalidar a aresta,
  manter texto literal e bloquear publicação até reconciliar alias/Block ID.
- Menção ainda não resolvida ou ambígua: aviso editorial, sem wikilink.
- Falha de preview/navegação: mostrar erro sanitizado e preservar a posição de
  leitura atual.
- Exportação parcial: escrever lote em staging e promover somente depois de
  validar paths e referências do pacote.

## Estratégia de validação

- Tabela de casos da gramática com abreviações, ordinais, sinais, listas,
  intervalos e encadeamento hierárquico.
- Property tests para spans não sobrepostos e aplicação determinística.
- Integração entre NLLC e CF com catálogo presente/ausente/ambíguo.
- Goldens dos dois perfis de conteúdo, verificando que links não alteram Block
  IDs nem removem tachados/histórico além do perfil escolhido.
- Contratos IPC, teste de remetente/schema/tamanho e ausência de paths/AST/HTML.
- E2E offline para mouse e teclado, navegação interna/externa e retorno.
- Validação manual do pacote `VincuLex` no Obsidian.

## Ordem

1. Contratos normativos, gramática e índice.
2. Catálogo, aliases e resolução contextual/editorial.
3. Formatter, paths `VincuLex` e projeção SQL.
4. IPC, hover preview e navegação.
5. Leis reais, E2E e validação no Obsidian.

## Não fazer

- Não modificar texto da NormaAST para armazenar `[[...]]`.
- Não persistir path do filesystem como alvo jurídico.
- Não buscar lei ou conteúdo remoto durante hover.
- Não transformar sugestão probabilística em link automático.
- Não gerar notas, embeds ou links quebrados para alvos ausentes.
