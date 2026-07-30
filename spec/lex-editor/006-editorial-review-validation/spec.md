# Feature 006 — Revisão editorial e validação

## Metadados

- `implementation_status`: draft
- `priority`: P1
- `owner`: não atribuído

## Objetivo

Permitir correção editorial rastreável, revalidação completa, exportação
individual/em lote e geração determinística de `UPDATE.md`, bloqueando toda
saída que viole regra crítica.

## Problema

Parsing automático não elimina ambiguidade. O editor precisa corrigir o modelo
sem editar Markdown derivado e precisa distinguir avisos confirmáveis de erros
que jamais podem chegar à publicação.

## Escopo

- Operações editoriais tipadas sobre cópia de trabalho da NormaAST.
- Revisão de baixa confiança com vínculo ao fragmento original.
- Revalidação incremental para feedback e completa para aprovação.
- Classificação bloqueante/não bloqueante conforme contratos.
- Confirmação explícita de avisos.
- Exportação única/em lote e `UPDATE.md`.
- Diário local de projeto e recuperação após fechamento/falha.

## Fora do escopo

- Publicar ou escrever no Git/Supabase.
- Alterar manualmente Block ID já publicado.
- Aprovação server-side.
- Worker de atualização.

## Dependências

- Features 004 e 005.
- `../../../docs/architecture/MARKDOWN_SPEC.md`
- `../../../docs/architecture/UPDATE_PIPELINE.md`
- `../../../docs/lex-editor/PRD.md`

## Requisitos

- RF-006-01: edição altera AST de trabalho, nunca o Markdown como fonte.
- RF-006-02: toda correção registra operação, ator local, instante e motivo
  quando afetar interpretação jurídica.
- RF-006-03: erros bloqueantes impedem aprovação e exportação final.
- RF-006-04: aviso exige confirmação ligada à revisão atual.
- RF-006-05: reprocessamento não descarta correção sem conflito explícito.

## Invariantes

- Block ID publicado não é editável.
- Mudança estrutural reexecuta reconciliação e invalida aprovação anterior.
- `UPDATE.md` é o único changelog canônico.
- Uma lei inválida em lote não transforma as demais em falha nem em sucesso
  incorreto.

## Cenários essenciais

### Corrigir e aprovar

Dado um nó de baixa confiança, quando o editor corrige sua classificação e
revalida, então a correção persiste e o diagnóstico é resolvido.

### Erro bloqueante

Dada uma AST com inciso órfão ou ID duplicado, quando tenta aprovar/exportar,
então a operação é negada com localização e motivo.

## Critérios de aceite

- [ ] Editor corrige ao menos um erro real e preserva o resultado.
- [ ] Cada regra bloqueante e aviso relevante possui caso automatizado.
- [ ] Fechar/reabrir recupera a cópia de trabalho sem sucesso falso.
- [ ] Exportação em lote isola resultados por lei.
- [ ] `UPDATE.md` descreve corretamente mudanças estruturadas.

## Validação mínima

- Risco: crítico.
- Testes de regras, edição, invalidação de aprovação, persistência e lote.
- E2E importar → corrigir → validar → exportar.

## Riscos

- Operações de edição livres corromperem invariantes: usar comandos tipados.
- Autosave mascarar estado: diário durável e estados explícitos de salvamento.
