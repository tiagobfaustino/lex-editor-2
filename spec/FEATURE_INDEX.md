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
| 006 | [Revisão editorial e validação](./lex-editor/006-editorial-review-validation/spec.md) | P1 | in_progress | 004, 005 | Correção manual persistida e publicação bloqueada quando inválida |
| 007 | [Publicação segura](./lex-editor/007-secure-publication/spec.md) | P2 | done | 006 | SHA aprovado é promovido e sincronizado de forma idempotente |
| 008 | [Atualizações legislativas](./lex-editor/008-legislative-updates/spec.md) | P3 | done | 007 | Worker gera proposta revisável sem publicar automaticamente |
| 009 | [Projeções completa e vigente](./lex-editor/009-complete-current-projections/spec.md) | P1 | done | 008 | Uma revisão gera Markdown completo ou somente vigente sem perder histórico |
| 010 | [Referências jurídicas e navegação por dispositivo](./lex-editor/010-legal-reference-navigation/spec.md) | P1 | done | 004, 005, 006, 009 | Menções resolvidas abrem e pré-visualizam o bloco interno ou de outra lei importada |
| 011 | [Configuração e catálogo de fontes oficiais](./lex-editor/011-official-source-catalog/spec.md) | P3 | done | 005, 008, 009 | Administrador cadastra, testa e ativa uma fonte compatível; importador e worker usam a mesma revisão |
| 012 | [Edição validada de metadados e frontmatter](./lex-editor/012-validated-frontmatter-editing/spec.md) | P1 | done | 005, 006, 007, 009, 010, 011 | Editor corrige metadados permitidos em formulário tipado; preview, exportação e publicação usam a mesma revisão |
| 013 | [Auditoria operacional, diagnóstico e reprocessamento](./lex-editor/013-operational-audit-reprocessing/spec.md) | P2 | done | 005, 006, 007, 008, 011, 012 | Administrador pesquisa eventos correlacionados, investiga evidência restrita e reprocessa sem perder a revisão válida |

| 014 | [Biblioteca local de leis](./lex-editor/014-local-law-library/spec.md) | P1 | done | 005, 006, 009, 012, 013 | Aba Minhas leis lista e reabre revisões persistidas |
| 015 | [Importação única e exclusão local](./lex-editor/015-library-uniqueness-deletion/spec.md) | P1 | done | 005, 014 | Duplicatas bloqueadas e exclusão confirmada na biblioteca |
| 016 | [Conferência manual e atualização local](./lex-editor/016-local-source-updates/spec.md) | P1 | done | 005, 006, 008, 009, 014, 015 | Fonte conferida, atualização revisada e pacote local com lei e relatório |

Reaberta em 2026-10-08, por solicitação de correção após análise: provar
idempotência por tentativa de reprocessamento, incluir as migrations recentes
no gate PostgreSQL, corrigir os gates de qualidade e completar as integrações
autenticadas do desktop necessárias à auditoria de publicação.

Correção encerrada em 2026-10-08: 766 testes unitários e 19 E2Es passaram,
incluindo publicação real pesquisada em três filtros, rollback e múltiplas
leis. Gates PostgreSQL, qualidade e pacote Linux validados; configuração e
implantação do ambiente documentadas no `review.md` da Feature 013.

## Regra de ativação

Feature 005 reaberta em 2026-10-08 para corrigir a importação do Decreto-Lei
nº 2.848 pela URL oficial. O snapshot histórico contém fechamentos prematuros
de `body`/`html`; a limpeza perde os artigos. A correção preserva os bytes dos
snapshots e os limites de rede/IPC e valida o conjunto compilado/anotado real.

Correção da Feature 005 encerrada em 2026-10-08: o conjunto real do Código
Penal abre preview/revisão sem modificar snapshots. Conflitos textuais ou de
correspondência exigem confirmação editorial; nessa primeira correção, a
compilada continuava autoritativa.
788 testes unitários, 19 E2Es e gates de qualidade/modelo passaram.

Feature 005 reaberta em 2026-10-08 por orientação explícita do usuário:
o texto principal da importação manual deve vir da URL informada, sem troca
automática pela contraparte compilada. O catálogo permanece autoritativo para
coletas automáticas; a seleção manual fica registrada nos snapshots da
importação e não altera revisões já existentes.

A correção da seleção manual foi encerrada em 2026-10-08. A URL informada
agora determina a primária com e sem catálogo; ambos os links reais do CP
passam com revisão obrigatória para ambiguidades. Foram validados 801 testes
unitários, 14 E2Es de importação/smoke e gates de tipo, lint, formato e build.

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
| 009 | Extensão das Fases 4–6 |
| 010 | Extensão das Fases 4–6 |
| 011 | Fases 6 e 8 |
| 012 | Extensão das Fases 5–7 |
| 013 | Extensão transversal das Fases 1–8 (RF-23 e fluxo 7) |
| 014 | Extensão da Fase 5 — biblioteca e retomada da revisão local |

Esse mapeamento não altera o roadmap. Ele reorganiza sua execução para obter
feedback ponta a ponta antes de generalizar todos os casos jurídicos.


Feature 012 reaberta em 2026-10-08 por relato de erro ao salvar metadados
do Código Penal importado por URL. O pedido autoriza correção do fluxo,
sem ampliar a matriz de mutabilidade nem liberar identidade publicada.


Correção da Feature 012 encerrada em 2026-10-08: o contexto de metadados
seleciona uma revisão por identidade, preferindo a revisão editada, sem
excluir outras importações. Passaram 69 testes relacionados, o E2E completo
de formulário com importação repetida e gates de qualidade/modelo/fronteiras.


Feature 014 ativada em 2026-10-08 por pedido explícito de criar a aba Minhas leis, com listagem das importações e retomada da edição após reinício.


Feature 014 encerrada em 2026-10-08: aba Minhas leis com busca/paginação e
recuperação offline de revisões e snapshots persistidos. Passaram 811
unitários, 11 E2Es de biblioteca/metadados/smoke e gates de qualidade,
fronteiras/modelo e build. A conferência local encontrou 21 importações e
reabriu as duas do CP sem modificar os dados persistidos.

Feature 015 ativada em 2026-10-08 por pedido de importação única, aviso de duplicata e exclusão local.


Feature 015 encerrada em 2026-10-08: importação única por identidade, aviso de duplicata e exclusão local confirmada/durável. Passaram 819 unitários, 11 E2Es e gates de qualidade, fronteiras e build. Evidências internas e duplicatas legadas foram preservadas.

Feature 016 ativada em 2026-10-08 pelo pedido explícito de integrar conferência manual, atualização e relatório exportável da lei local.

Feature 016 encerrada em 2026-10-08: conferência manual na biblioteca, adoção replayable de fonte e exportação de lei integral com ALTERACOES.md. Validados 833 testes unitários/integrados, fluxo real no Electron e controles IPC; detalhes em review.md.

Feature 006 reaberta em 2026-10-08 para corrigir a interface que fica em branco ao validar a revisão, conforme relato e captura do usuário.
