# Feature 010 — Referências jurídicas e navegação por dispositivo

## Metadados

- `implementation_status`: done
- `priority`: P1
- `owner`: não atribuído

## Objetivo

Analisar remissões presentes no texto de uma lei, resolver com segurança
referências internas e a outras leis importadas e permitir ler ou abrir o
bloco-alvo no Lex Editor e no Markdown exportado para `VincuLex`.

## Problema

Uma remissão como `§ 3º deste artigo` ou `caput do art. 37 da Constituição
Federal` exige que o leitor interrompa a leitura e procure manualmente o
dispositivo. Inserir links por nome de arquivo ou por ID pessoal resolveria o
caso imediato, mas quebraria quando o arquivo fosse renomeado, quando outra
lei ainda não estivesse importada ou quando o alvo fosse ambíguo.

## Escopo

- Detectar menções jurídicas nos textos canônicos de dispositivos depois da
  atribuição/reconciliação de Block IDs.
- Resolver referências internas pelo contexto estrutural da origem.
- Resolver referências externas por catálogo de leis e aliases quando a lei e
  o dispositivo estiverem importados.
- Manter índice derivado com spans, localizador, estado e alvo canônico.
- Permitir revisão editorial de menções ambíguas ou não resolvidas.
- Enriquecer o preview e o Markdown com links para Block IDs sem alterar o
  texto literal nem a revisão jurídica.
- Exibir preview acessível do bloco ao hover/foco e navegar ao alvo no clique.
- Exportar leis para a raiz `VincuLex` com paths wiki determinísticos.
- Validar com a Lei nº 14.133/2021 e a Constituição Federal de 1988.

## Fora do escopo

- Usar LLM como autoridade para criar vínculos.
- Linkar doutrina, jurisprudência, súmulas, processos, URLs externas ou
  referências bibliográficas genéricas.
- Gerar embeds `![[...]]` no corpo das leis.
- Criar ou importar automaticamente uma lei ausente ao detectar sua menção.
- Analisar `redacoesAnteriores`, notas de status, callouts, frontmatter, MOCs
  ou marcações pessoais na primeira versão.
- Alterar a gramática ou imutabilidade dos Block IDs.

## Dependências

- Features 004, 005, 006 e 009.
- `../../../docs/architecture/ADR-013-referencias-juridicas-resolvidas.md`
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- `../../../docs/architecture/BLOCK_ID_SPEC.md`
- `../../../docs/architecture/MARKDOWN_SPEC.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-010-01: detectar localizadores de artigo, caput, parágrafo, inciso,
  alínea e item, incluindo formas abreviadas, listas, intervalos e contexto
  `deste artigo`/`desta Lei`.
- RF-010-02: preservar o texto canônico e representar vínculos como projeção
  derivada ligada à revisão e ao Block ID de origem.
- RF-010-03: resolver lei externa por identidade canônica e aliases sem usar o
  path do arquivo como identidade.
- RF-010-04: gerar wikilink apenas para alvo existente e não ambíguo; caso
  contrário, manter o texto literal e emitir diagnóstico.
- RF-010-05: materializar links internos como `[[#^block-id|texto]]` e links
  externos sob `VincuLex` como
  `[[VincuLex/<diretorio>/<arquivo>#^block-id|texto]]`.
- RF-010-06: mostrar no hover e no foco o bloco exato, com lei, caminho
  jurídico, status e texto sanitizado, sem rede.
- RF-010-07: navegar por clique ao bloco interno ou à lei importada/bloco
  externo, com retorno ao ponto de origem.
- RF-010-08: re-resolver menções quando o catálogo mudar sem reparsear ou
  modificar a NormaAST de origem.
- RF-010-09: projetar as referências resolvidas para o banco por IDs canônicos
  e nunca por paths do vault.
- RF-010-10: expor ao renderer apenas contratos IPC mínimos e validados.

## Invariantes

- A NormaAST e o texto legal permanecem independentes da sintaxe wiki.
- A identidade do alvo é lei canônica + Block ID; o path é derivado.
- Nenhuma referência ambígua ou inexistente vira link automaticamente.
- O label visível preserva exatamente o trecho da lei abrangido pela menção.
- Importar uma lei-alvo pode mudar a projeção de links, mas não a revisão
  jurídica da lei de origem.
- O renderer não recebe paths reais, AST, Markdown integral nem HTML.
- Preview, exportação e projeção SQL consomem o mesmo índice resolvido.

## Cenários essenciais

### Referência interna

Dado o art. 1º, § 4º da Lei nº 14.133/2021 com a expressão `§ 3º deste artigo`,
quando a análise é executada, então `§ 3º` resolve para
`nllc-art-1-par-3`, o hover mostra esse parágrafo e o clique revela o alvo na
mesma lei.

### Referência externa disponível

Dado o art. 1º, § 5º da Lei nº 14.133/2021 e a CF/1988 importada, quando a
análise encontra `caput do art. 37 da Constituição Federal`, então o alvo é
`cf1988-art-37`, o preview mostra o caput e o clique abre a CF no bloco correto.

### Referência externa ausente

Dada a mesma menção sem a CF/1988 no catálogo, quando a análise é executada,
então o texto permanece sem link e a UI mostra aviso não resolvido. Ao importar
a CF, re-resolver o índice cria o vínculo sem alterar a revisão da Lei nº
14.133.

### Ambiguidade

Dada uma menção cujo alias ou contexto admita mais de um alvo, quando o
analisador não puder provar um único destino, então nenhum link é gerado e o
editor pode confirmar explicitamente um alvo ou manter a menção sem vínculo.

## Critérios de aceite

- [x] Os dois exemplos do art. 1º da Lei nº 14.133 resolvem para os Block IDs
  semânticos corretos.
- [x] Referências internas e externas são serializadas de forma determinística
  e abrem no Obsidian a partir do diretório `VincuLex`.
- [x] Hover e foco exibem o bloco exato; clique navega ao alvo e permite
  retornar à origem.
- [x] Lei ou dispositivo ausente nunca produz link quebrado nem alvo inventado.
- [x] Re-resolução por mudança de catálogo não altera AST, hash da revisão ou
  texto literal.
- [x] Preview, exportação e banco concordam sobre origem, alvo e estado.
- [x] O renderer recebe somente DTOs mínimos, sanitizados e validados em
  runtime.
- [x] Testes offline cobrem formas simples, compostas, internas, externas,
  ambíguas e inválidas.

## Validação mínima

- Risco: alto para fidelidade jurídica e médio para a fronteira desktop.
- Testes unitários da gramática, catálogo, spans e resolução contextual.
- Testes de contrato do índice, aliases, Formatter e projeção SQL.
- Testes IPC positivos e negativos.
- E2E de hover/foco/clique interno, externo e não resolvido.
- Golden/exportação offline da Lei nº 14.133 e CF/1988, com conferência no
  Obsidian.

## Riscos

- Falso positivo criar vínculo juridicamente errado: fail closed, evidência e
  confirmação editorial.
- Link quebrar ao renomear arquivo: persistir identidade e derivar path no
  momento da exportação.
- Offset aplicar link ao trecho errado após edição: validar trecho e recalcular
  o índice por hash de revisão.
- Preview vazar conteúdo privilegiado ou filesystem: DTO mínimo e resolução
  no processo principal.
- Links divergirem entre perfis: aplicar o mesmo índice depois da projeção de
  conteúdo e validar apenas referências cujas origens permaneçam na saída.
