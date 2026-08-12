# ADR-013: Referências jurídicas resolvidas e navegação por dispositivo

## Status

Aceito em 2026-08-11. Implementação planejada para a Feature 010.

## Contexto

Leis fazem remissões frequentes a dispositivos da própria norma e de outras
normas. Hoje, o texto importado preserva essas menções, mas o leitor precisa
localizar manualmente o alvo. Em um vault Obsidian, um link para Block ID
permite abrir diretamente o dispositivo e a visualização de página permite lê-lo
ao passar o cursor sobre o vínculo.

A Lei nº 14.133/2021 contém os dois casos mínimos que motivam esta decisão:

- o art. 1º, § 4º remete ao § 3º do mesmo artigo;
- o art. 1º, § 5º remete ao caput do art. 37 da Constituição Federal.

O Markdown pessoal de referência usa IDs aleatórios e o diretório
`NavegaLei`. O Lex Editor já possui Block IDs semânticos, imutáveis e
reconciliados; a exportação destinada ao vault usará o diretório `VincuLex`.
Copiar o link pessoal literalmente quebraria a identidade canônica do projeto.

## Decisão

### 1. Referência é projeção derivada, não alteração do texto legal

Depois de produzir uma `IdentifiedNormaAST`, o sistema executa uma etapa pura
de análise de referências. Ela localiza menções em campos de texto normativo,
resolve seus alvos contra o catálogo local de leis e produz um índice derivado
ligado ao hash da revisão.

A análise não insere sintaxe wiki nos campos literais da NormaAST e não muda o
hash da revisão jurídica. Preview e Formatter recebem a árvore aprovada e o
índice de referências e materializam os vínculos apenas na apresentação. Uma
mudança de resolução pode mudar o hash do artefato Markdown e gerar publicação
`PATCH`, mas nunca simula alteração legislativa.

Na primeira versão, são analisados `caput`/`texto` canônicos de todos os
dispositivos, inclusive texto preservado de dispositivo revogado ou vetado na
projeção completa. `redacoesAnteriores`, notas de status, frontmatter,
callouts, tabelas, texto editorial e marcações pessoais ficam fora da análise.

### 2. Contrato da menção e do alvo

Cada menção derivada registra, no mínimo:

- revisão, Block ID e campo do dispositivo de origem;
- intervalo no texto canônico e trecho literal conferível;
- escopo `same_law` ou `external_law`;
- localizador jurídico estruturado: artigo, caput, parágrafo, inciso, alínea
  e item, incluindo listas e intervalos quando expressos;
- identidade canônica da lei-alvo quando externa;
- estado `resolved`, `unresolved` ou `ambiguous`;
- Block ID canônico do alvo somente quando `resolved`;
- versão do analisador e evidência da resolução.

Intervalos são calculados sobre o texto canônico do campo e validados contra o
trecho literal antes de aplicar qualquer decoração. Menções sobrepostas ou
cujo texto tenha mudado são rejeitadas e recalculadas, nunca aplicadas por
posição obsoleta.

### 3. Detecção e resolução determinísticas

O analisador usa uma gramática jurídica determinística para abreviações e
formas por extenso de artigo, caput, parágrafo, inciso, alínea e item. Ele deve
cobrir referências simples, compostas, listas e intervalos, além de expressões
de contexto como `deste artigo`, `desta Lei` e equivalentes.

Regras contextuais mínimas:

- `§ 3º deste artigo`, dentro do art. 1º, resolve para o § 3º do art. 1º da
  própria lei;
- `art. 5º desta Lei` resolve na própria lei;
- `caput do art. 37 da Constituição Federal` resolve a identidade `cf1988` e
  o Block ID do art. 37;
- uma menção sem contexto suficiente não é adivinhada.

Modelo probabilístico pode futuramente sugerir candidatos, mas não autoriza
um link. Apenas a gramática, o catálogo e uma decisão editorial explícita podem
produzir `resolved`.

### 4. Identidade da lei e aliases

O alvo externo é identificado por chave estável de catálogo, baseada em tipo,
número e ano, e não por nome de arquivo. Título oficial, sigla e nomes
consagrados como `Constituição Federal`, `CF` e `CF/88` formam aliases
normalizados e sem colisão. Aliases ambíguos exigem decisão editorial.

O campo opcional `aliases` será projetado como lista YAML no frontmatter para
interoperabilidade com o Obsidian. Ele auxilia descoberta e nomes alternativos
da nota, mas não substitui a chave canônica do catálogo. O texto visível de
cada ocorrência continua sendo o trecho literal da lei, usando o alias de
exibição do próprio wikilink (`|texto`).

Importar ou renomear uma lei dispara nova resolução do índice derivado. Isso
não exige reparsear nem editar o texto da lei de origem.

### 5. Alvo por Block ID, caminho somente na exportação

O alvo jurídico de uma referência é o Block ID canônico sem `^`, conforme
`BLOCK_ID_SPEC.md`. Caminho e nome de arquivo são detalhes de materialização e
não são persistidos como identidade da referência.

Na exportação para um vault, o usuário escolhe uma raiz autorizada no processo
principal e o pacote usa a pasta `VincuLex`. Cada caminho é derivado do catálogo
e do layout canônico da lei. A sintaxe gerada omite `.md` e parte da raiz do
vault:

```markdown
[[#^nllc-art-1-par-3|§ 3º]]
[[VincuLex/constituicao-federal/cf88#^cf1988-art-37|caput do art. 37]]
```

O primeiro formato é obrigatório para alvo na própria nota. O segundo é usado
para outra lei importada e exportável. Se a lei ou o dispositivo não estiver
disponível, o texto permanece literal e não é emitido um wikilink quebrado.
Isso também evita que um clique no Obsidian crie acidentalmente uma nota para
um alvo inexistente.

Embeds `![[...]]` não são gerados nesta versão. Eles duplicariam conteúdo no
corpo da lei; leitura sem navegação é atendida pelo preview sob demanda.

### 6. Preview e navegação no Lex Editor

Uma referência `resolved` é interativa no preview:

- hover e foco por teclado abrem um popover com título da lei, caminho
  jurídico, status e texto sanitizado do bloco exato;
- `Escape` fecha o popover e o foco retorna de forma previsível;
- clique em referência interna revela e focaliza o bloco na lei atual;
- clique em referência externa abre a lei importada no workspace e revela o
  bloco, preservando navegação de retorno;
- estados não resolvido e ambíguo permanecem legíveis e aparecem no painel de
  validação, sem ação enganosa.

O preview é obtido do índice local, funciona offline e não carrega a URL
oficial nem conteúdo remoto no renderer.

### 7. Fronteira Electron

O renderer envia apenas IDs opacos da referência. O processo principal resolve
lei, revisão, Block ID e destino permitido e devolve um DTO pequeno com texto
sanitizado, rótulos e estado. Preload expõe capacidades nomeadas para obter o
preview e navegar; não expõe filesystem, caminho real, Markdown integral,
NormaAST, HTML, IPC genérico ou shell.

Todo canal valida remetente/frame, schema fechado, tamanho, estado do projeto e
autorização. O diretório `VincuLex` e seus caminhos reais permanecem no processo
principal.

### 8. Validação e publicação

- `resolved` exige lei e Block ID existentes na revisão-alvo selecionada;
- alias em ciclo, colisão de identidade, span inválido ou alvo resolvido
  inexistente é erro bloqueante;
- `unresolved` e `ambiguous` não alteram o texto e são avisos revisáveis;
- uma decisão editorial pode confirmar alvo ou manter a menção sem link e deve
  sobreviver ao reprocessamento enquanto origem e alvo continuarem válidos;
- o Formatter aplica vínculos depois da projeção
  `complete_with_history`/`current_only`, preservando os mesmos Block IDs;
- a projeção SQL/SaaS recebe arestas por identidade e Block ID, nunca paths do
  vault.

## Consequências

### Positivas

- O leitor consulta o dispositivo mencionado sem perder o contexto atual.
- Links internos e externos sobrevivem a renomeação de arquivos e atualização
  textual porque a identidade jurídica permanece no catálogo e nos Block IDs.
- O mesmo índice atende preview, navegação, Markdown/Obsidian e futuras
  consultas de backlinks.
- Menções não resolvidas permanecem juridicamente fiéis e não apontam para um
  alvo inventado.

### Trade-offs aceitos

- A resolução depende de um catálogo local de leis e aliases bem validado.
- O artefato Markdown pode mudar quando uma lei antes ausente é importada,
  embora a revisão jurídica de origem permaneça igual.
- Referências compostas exigem gramática e testes mais amplos do que simples
  substituição por expressão regular.
- Preview acessível e fronteira IPC aumentam o escopo desktop da feature.

## Verificação

- Na Lei nº 14.133/2021, o § 4º do art. 1º resolve `§ 3º deste artigo` para
  `nllc-art-1-par-3` e gera link interno.
- Com a CF/1988 importada, o § 5º resolve `caput do art. 37 da Constituição
  Federal` para `cf1988-art-37` e gera link sob `VincuLex`.
- Sem a CF/1988 importada, a mesma menção permanece literal e aparece como
  não resolvida; ao importar a CF, uma nova resolução cria o link sem alterar a
  NormaAST da Lei nº 14.133.
- Hover e foco mostram somente o bloco-alvo sanitizado; clique navega e revela
  o alvo; tudo funciona offline.
- Exportação aberta no Obsidian resolve os dois wikilinks e seus Block IDs.
- Decorações pessoais e IDs aleatórios do arquivo de estudo não influenciam
  detecção, resolução ou golden tests.

## Referências

- `./ADR-007-fronteira-segura-publicacao.md`
- `./ADR-012-projecoes-completa-e-vigente.md`
- `./BLOCK_ID_SPEC.md`
- `./MARKDOWN_SPEC.md`
- `./DATA_MODEL.md`
- <https://obsidian.md/help/links>
- <https://obsidian.md/help/aliases>
- <https://obsidian.md/help/embeds>
- <https://obsidian.md/help/plugins/page-preview>
