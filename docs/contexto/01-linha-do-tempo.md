# Linha do Tempo do Desenvolvimento

> O projeto foi construído documentação-primeiro: arquitetura e contratos
> normativos antes de produto, produto antes de specs de implementação, specs
> antes de código. Nenhum código foi escrito antes do contrato que ele deve
> respeitar.

## Etapa 0 — Documentação de arquitetura (commit `b07f2a6`, 2026-07-30)

Primeira entrega do repositório. Estabeleceu os contratos que prevalecem sobre
qualquer código futuro.

- Nove ADRs, oito nesse commit:
  - **ADR-001** Block IDs imutáveis — o ID marca a posição jurídica, não a
    redação; sobrevive a revogação e renumeração.
  - **ADR-002** NormaAST — árvore normativa intermediária independente da
    fonte, com fases `parsed` e `identified`.
  - **ADR-003** Versionamento em Git — o repositório Git é a fonte canônica;
    o banco é cópia de distribuição.
  - **ADR-004** Pipeline de publicação — release commit, manifesto imutável e
    sync transacional.
  - **ADR-005** Campos de status — proíbe o campo genérico `status`; define
    `deviceStatus` e os demais nomes específicos.
  - **ADR-006** Histórico de redações no corpo — redações anteriores vivem no
    documento, não em tabela paralela.
  - **ADR-007** Fronteira segura de publicação — o Electron não tem autoridade
    de produção; renderer é não confiável.
  - **ADR-008** Monetização e gateway — Asaas, entitlements definidos no
    servidor.
- Especificações normativas de detalhe: `BLOCK_ID_SPEC.md` (573 linhas),
  `MARKDOWN_SPEC.md` (486), `DATA_MODEL.md` (1720).
- Arquitetura compartilhada entre os dois produtos: `SYSTEM_ARCHITECTURE.md` e
  `UPDATE_PIPELINE.md`.

## Etapa 1 — Definição de produto (commit `ff5edca`, 2026-07-30)

PRD, roadmap e fluxos de usuário para os dois produtos do ecossistema:

- `docs/lex-editor/` — a ferramenta editorial interna (PRD 844 linhas,
  roadmap em 9 fases, fluxos do editor);
- `docs/vinculex/` — o SaaS voltado ao estudante/concurseiro, consumidor
  exclusivo de conteúdo já publicado.

O roadmap do Lex Editor definiu as Fases 0 a 8, do setup do projeto ao worker
de atualização legislativa, cada uma com critério de saída explícito.

## Etapa 2 — Fluxo de especificação (commit `c3b5d8c`, 2026-07-30)

Criação do método de trabalho em `spec/`:

- `README.md` — precedência de fontes, unidade de trabalho, ciclo
  `draft → ready → in_progress → review → done`, Definition of Ready e of Done;
- `DEVELOPMENT_RULES.md` — 24 regras de escopo, contratos, implementação,
  validação e encerramento;
- `TEST_STRATEGY.md` — teste por risco (crítico a trivial), lista do que sempre
  se automatiza e do que não se testa isoladamente;
- `templates/` — `spec.md`, `plan.md`, `tasks.md`, `review.md`;
- `FEATURE_INDEX.md` — índice único de estado das features.

## Etapa 3 — Decomposição em features (commit `cae3a27`, 2026-07-30)

As nove fases do roadmap foram reorganizadas em **oito features verticais**,
para obter feedback ponta a ponta antes de generalizar todos os casos
jurídicos. O primeiro corte jurídico (Feature 003) é deliberadamente estreito.

| ID | Feature | Prioridade | Depende de |
|---|---|---|---|
| 001 | Fundação do projeto | P0 | — |
| 002 | Contratos do domínio jurídico | P0 | 001 |
| 003 | Primeiro pipeline jurídico vertical | P0 | 002 |
| 004 | Hierarquia jurídica completa | P0 | 003 |
| 005 | Importação, preview e exportação desktop | P1 | 001, 004 |
| 006 | Revisão editorial e validação | P1 | 004, 005 |
| 007 | Publicação segura | P2 | 006 |
| 008 | Atualizações legislativas | P3 | 007 |

## Etapa 4 — Skills de agente (commits `577b70e`, `a7366f2`, `dbc1416`)

Instalação das skills consultadas durante a implementação e criação do
`AGENTS.md` da raiz, que fixa o processo obrigatório antes de qualquer
implementação.

A skill própria do projeto, `.agents/skills/lex-editor-electron/`, trata
Electron como fronteira de segurança e traz referências de capacidades IPC,
arquitetura segura e validação de empacotamento.

## Etapa 5 — ADR-009 e realinhamento documental (não commitado, 2026-07-31)

Durante o estudo das fontes reais (a pasta `exemplos/` guarda CF/88, Código
Penal, Lei 14.133, Lei Maria da Penha e LINDB em Markdown) apareceu um problema
não previsto: o Planalto publica **mais de uma página oficial** para a mesma
norma — a compilada, com a redação vigente, e a anotada, que preserva redações
riscadas e marcadores de alteração.

**ADR-009 — Fontes compiladas e históricas** (aceito em 2026-07-31) resolveu o
conflito: cada importação passa a usar um *conjunto* de fontes, com funções
`primary_current`, `historical_auxiliary` e `cross_check`; a compilada é
preferida para o texto vigente; e a ausência de um dispositivo na compilada
**nunca** é interpretada como revogação implícita.

A decisão propagou para os documentos superiores, todos ainda não commitados:

- `SYSTEM_ARCHITECTURE.md`, `UPDATE_PIPELINE.md` e `DATA_MODEL.md` passaram a
  falar em conjunto de fontes, proveniência por artefato e SHA-256 separado por
  snapshot;
- `PRD.md` trocou `SourceInput` por `SourceBundleInput` na API do parser;
- as specs 002, 003, 004, 005 e 008 absorveram a mudança no escopo.

## Etapa 6 — Implementação da Feature 001 (não commitado)

Primeira etapa com código. Sete das dez tarefas concluídas, na ordem prevista
pelo `plan.md`:

| Tarefa | Entrega |
|---|---|
| T001-01 | Workspace npm, scripts e TypeScript strict com três projetos referenciados |
| T001-02 | `packages/legal-domain` puro e matriz de dependências entre camadas |
| T001-03 | ESLint flat config com fronteiras de import, Prettier e hook de pre-commit |
| T001-04 | Main/preload com janela endurecida e API `lexDesktop` versionada |
| T001-05 | Validação comum de origem, frame, schema e tamanho para capacidades IPC |
| T001-06 | Shell React com Importação, Preview e Logs, e tokens semânticos |
| T001-07 | Vitest e testes negativos da fronteira IPC/janela (14 testes) |

Pendentes: T001-08 (Playwright), T001-09 (build empacotado, fuses e CI) e
T001-10 (demonstração dos critérios de aceite).

## Etapa 7 — Entrada no histórico Git (2026-08-04)

Até aqui, tudo desde a Etapa 5 vivia apenas no working tree: o último commit do
repositório ainda era `dbc1416`, uma entrega só de documentação e skills, e
todo o código do projeto estava fora do histórico.

O bloqueio tinha causa concreta: o hook de pre-commit roda `lint` e
`format:check`, e o Prettier reprovava os textos legais de `exemplos/`, que não
podem ser reformatados. Adicionar `exemplos/` ao `.prettierignore` — ao lado de
`docs/` e `spec/`, já lá pelo mesmo motivo — destravou o hook.

O trabalho entrou em dez commits, na ordem em que foi feito: ADR-009 e
realinhamento documental, ativação da Feature 001, workspace e TypeScript,
pacote de domínio, fronteiras de lint e formatação, shell Electron endurecido,
shell React, testes de fronteira, progresso das tarefas, material de referência
jurídica e este registro de contexto.

## Onde a linha do tempo está agora

Feature 001 `in_progress` com sete de dez tarefas entregues. As três restantes
— Playwright, empacotamento com CI e demonstração dos critérios de aceite —
são o que separa a fundação de `done` e, portanto, o que separa a Feature 002
de poder ser ativada.
