# Índice de Features — Lex Editor

## Vocabulário

- Prioridade `P0`: fundação e prova do domínio.
- Prioridade `P1`: ferramenta editorial utilizável.
- Prioridade `P2`: publicação confiável em produção.
- Prioridade `P3`: automação pós-MVP.
- `implementation_status`: `draft`, `ready`, `in_progress`, `blocked`,
  `review`, `done` ou `cancelled`.

## Sequência

| ID | Feature | Prioridade | Implementation status | Dependências | Resultado verificável |
|---|---|---:|---|---|---|
| 001 | [Fundação do projeto](./lex-editor/001-project-foundation/spec.md) | P0 | done | — | Workspace, qualidade, shell seguro e smoke test executáveis |
| 002 | [Contratos do domínio jurídico](./lex-editor/002-legal-domain-contracts/spec.md) | P0 | done | 001 | Objetos `parsed`/`identified` validados em runtime sem Electron |
| 003 | [Primeiro pipeline jurídico vertical](./lex-editor/003-first-legal-pipeline/spec.md) | P0 | done | 002 | Fixture local produz Markdown canônico por CLI |
| 004 | [Hierarquia jurídica completa](./lex-editor/004-full-legal-hierarchy/spec.md) | P0 | done | 003 | Três leis de referência cobrem a gramática normativa completa |
| 005 | [Importação, preview e exportação desktop](./lex-editor/005-desktop-import-preview-export/spec.md) | P1 | done | 001, 004 | Usuário importa, revisa e exporta no Electron |
| 006 | [Revisão editorial e validação](./lex-editor/006-editorial-review-validation/spec.md) | P1 | draft | 004, 005 | Correção manual persistida e publicação bloqueada quando inválida |
| 007 | [Publicação segura](./lex-editor/007-secure-publication/spec.md) | P2 | draft | 006 | SHA aprovado é promovido e sincronizado de forma idempotente |
| 008 | [Atualizações legislativas](./lex-editor/008-legislative-updates/spec.md) | P3 | draft | 007 | Worker gera proposta revisável sem publicar automaticamente |

## Regra de ativação

Antes de alterar uma feature para `in_progress`:

1. confirmar suas dependências como `done`;
2. revisar `spec.md`, `plan.md` e `tasks.md`;
3. confirmar que não surgiu conflito com `docs/`;
4. registrar aqui a mudança de estado;
5. trabalhar somente no escopo ativado.

## Mapeamento para o roadmap

| Feature | Fases predominantes de `docs/lex-editor/ROADMAP.md` |
|---|---|
| 001 | Fase 0 |
| 002 | Base da Fase 2 e contratos compartilhados |
| 003 | Primeiro corte das Fases 1–4 |
| 004 | Endurecimento das Fases 1–4 |
| 005 | Fases 0, 1, 5 e parte da 6 |
| 006 | Fases 5 e 6 |
| 007 | Fase 7 |
| 008 | Fase 8 |

Esse mapeamento não altera o roadmap. Ele reorganiza sua execução para obter
feedback ponta a ponta antes de generalizar todos os casos jurídicos.
