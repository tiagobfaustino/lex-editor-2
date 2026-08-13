# Lean Spec Development — Lex Editor

Esta pasta transforma a arquitetura já aprovada em incrementos implementáveis.
Ela não substitui PRDs, ADRs nem especificações normativas.

## Fontes de verdade e precedência

Quando dois documentos parecerem incompatíveis, use esta ordem:

1. ADR aceito e especificação marcada como normativa;
2. `docs/architecture/DATA_MODEL.md`, `SYSTEM_ARCHITECTURE.md` e
   `UPDATE_PIPELINE.md`;
3. `docs/lex-editor/PRD.md`;
4. `docs/lex-editor/ROADMAP.md` e `USER_FLOWS.md`;
5. `spec.md` da feature;
6. `plan.md` e `tasks.md`.

Uma feature referencia contratos superiores; não os reinterpreta. Conflito
real interrompe a implementação até que a fonte correta seja ajustada
explicitamente.

## Unidade de trabalho

Cada diretório numerado representa um incremento verificável. IDs são
permanentes: uma feature cancelada mantém seu número e passa a
`implementation_status: cancelled`.

Arquivos:

- `spec.md`: resultado observável, escopo, requisitos e aceite;
- `plan.md`: abordagem técnica e validações, usado quando há integração ou
  risco relevante;
- `tasks.md`: unidades coesas e verificáveis;
- `review.md`: criado ao encerrar somente quando houver decisões, desvios,
  débitos ou evidências que mereçam registro permanente.

Não se cria documento vazio apenas para completar uma estrutura.

## Fluxo

```text
draft → ready → in_progress → review → done
                  ↘ blocked
draft/ready/in_progress → cancelled
```

Somente uma feature fica `in_progress` por vez, salvo decisão explícita no
`FEATURE_INDEX.md`. Uma tarefa só é marcada após implementação e validação.

## Definition of Ready

Uma feature pode passar a `ready` quando:

- objetivo e fora de escopo estão claros;
- dependências anteriores estão satisfeitas ou simuláveis;
- referências normativas existem;
- critérios de aceite são verificáveis;
- riscos e validações essenciais foram classificados;
- não há decisão arquitetural silenciosamente embutida.

## Definition of Done

Uma feature passa a `done` quando:

- todos os critérios de aceite foram demonstrados;
- tarefas concluídas refletem o estado real;
- lint, typecheck e validações aplicáveis passaram;
- testes obrigatórios pelo risco passaram;
- contratos e documentação afetados foram atualizados;
- desvios e débitos reais foram registrados;
- não restou caminho conhecido para sucesso falso.

## Organização

```text
spec/
├── README.md
├── FEATURE_INDEX.md
├── DEVELOPMENT_RULES.md
├── TEST_STRATEGY.md
├── templates/
└── lex-editor/
    ├── 001-project-foundation/
    ├── 002-legal-domain-contracts/
    ├── 003-first-legal-pipeline/
    ├── 004-full-legal-hierarchy/
    ├── 005-desktop-import-preview-export/
    ├── 006-editorial-review-validation/
    ├── 007-secure-publication/
    ├── 008-legislative-updates/
    ├── 009-complete-current-projections/
    ├── 010-legal-reference-navigation/
    └── 011-official-source-catalog/
```

O primeiro corte jurídico é deliberadamente vertical. Tipos, parser, IDs e
Formatter não viram dezenas de “features” horizontais antes de existir um
resultado executável.
