# Tarefas — Feature 010

## Grupo 1 — Contratos e gramática

- [x] T010-01 Normatizar `LegalReferenceIndex`, estados, localizadores, spans e
  severidades em `DATA_MODEL.md`, com schemas runtime e tipos inferidos no
  domínio.
- [x] T010-02 Implementar detector determinístico de artigo, caput, parágrafo,
  inciso, alínea e item, incluindo listas, intervalos e contexto relativo, com
  testes de offsets e sobreposição.
- [x] T010-03 Criar fixtures mínimas e uma matriz de casos positivos/negativos
  que prove preservação byte a byte do texto canônico.

## Grupo 2 — Catálogo e resolução

- [x] T010-04 Implementar catálogo por identidade canônica de lei, título,
  sigla e aliases, com detecção de colisão e re-resolução por mudança do
  catálogo.
- [x] T010-05 Resolver alvos internos e externos por Block ID, registrar
  evidência e permitir decisão editorial persistente para menção ambígua ou
  mantida sem link.

## Grupo 3 — Markdown, exportação e banco

- [x] T010-06 Atualizar `MARKDOWN_SPEC.md` e o Formatter para `aliases`, links
  internos/externos, spans seguros e validação determinística nos dois perfis
  de conteúdo.
- [x] T010-07 Implementar layout de exportação sob `VincuLex`, validação
  atômica do pacote e projeção SQL/SaaS das arestas por IDs canônicos, sem
  paths locais.

## Grupo 4 — Preview e navegação desktop

- [x] T010-08 Definir DTOs e capacidades IPC mínimas para preview e navegação,
  com validação runtime, autorização do projeto, remetente/frame e testes
  negativos.
- [x] T010-09 Implementar link acessível, popover por hover/foco, fechamento por
  `Escape`, clique interno/externo, revelação do bloco e retorno à origem.

## Grupo 5 — Leis reais e encerramento

- [x] T010-10 Versionar fixture da Lei nº 14.133/2021 e validar o § 4º → § 3º e
  o § 5º → CF art. 37 contra a fixture da CF/1988, ignorando decoração e IDs do
  Markdown pessoal.
- [x] T010-11 Cobrir catálogo ausente, importação posterior, alias ambíguo,
  alvo removido, perfis completa/vigente e determinismo sem rede em CI.
- [x] T010-12 Executar E2E de mouse/teclado e validação manual do pacote
  `VincuLex` no Obsidian; registrar evidências permanentes em `review.md` e
  encerrar a feature somente com todos os critérios satisfeitos.
