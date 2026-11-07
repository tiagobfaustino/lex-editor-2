# Contexto de Desenvolvimento — Lex Editor

> Última atualização: 2026-10-08
> Escopo: registro do que já foi construído, decidido e validado neste
> repositório até a data acima.

Esta pasta é **memória de projeto**, não contrato normativo. Ela responde a
"o que já existe, por que existe assim e o que falta", sem substituir nenhuma
fonte de verdade.

## Precedência

Esta pasta é o último nível na ordem de precedência do repositório. Se algo
aqui divergir de um documento superior, o documento superior vence e este
registro está desatualizado:

1. ADR aceito e especificação normativa (`docs/architecture/`);
2. `DATA_MODEL.md`, `SYSTEM_ARCHITECTURE.md`, `UPDATE_PIPELINE.md`;
3. `docs/lex-editor/PRD.md`;
4. `docs/lex-editor/ROADMAP.md` e `USER_FLOWS.md`;
5. `spec/lex-editor/<feature>/spec.md`, `plan.md`, `tasks.md`;
6. `docs/contexto/` (este registro).

## Documentos

| Arquivo | Responde a |
|---|---|
| [01-linha-do-tempo.md](./01-linha-do-tempo.md) | Em que ordem o projeto foi construído e o que cada etapa entregou |
| [02-estado-atual.md](./02-estado-atual.md) | O que existe hoje no repositório e quais comandos passam |
| [03-arquitetura-implementada.md](./03-arquitetura-implementada.md) | Como o código realmente está organizado, arquivo a arquivo |
| [04-decisoes-de-implementacao.md](./04-decisoes-de-implementacao.md) | Por que cada escolha técnica foi feita e o que foi rejeitado |
| [05-processo-e-ferramentas.md](./05-processo-e-ferramentas.md) | Como se trabalha aqui: fluxo de specs, comandos, hooks e skills |
| [06-pendencias-e-riscos.md](./06-pendencias-e-riscos.md) | O que está aberto, o que é dívida e o que pode dar errado |

## Resumo em cinco linhas

O Lex Editor é a ferramenta editorial interna do ecossistema Vinculex: importa
legislação de fontes oficiais, converte em NormaAST, atribui Block IDs, gera
Markdown Obsidian-first, permite revisão humana e publica de forma auditável.
A arquitetura, o modelo de dados e catorze ADRs já estão escritos e aceitos.
Consulte `spec/FEATURE_INDEX.md` para o estado atual; a Feature 013 foi reaberta
e encerrada em 2026-10-08 após corrigir integrações e comprovar a pesquisa de
publicação. O repositório inclui pipeline jurídico,
revisão, publicação, atualizações, catálogo, edição de metadados e auditoria
operacional/reprocessamento seguro, inclusive a correlação assíncrona do worker
sem credencial ou executor remoto no Electron.
