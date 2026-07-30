# Plano de Implementação — Feature 006

## Abordagem

Representar correções como comandos tipados aplicados à AST de trabalho.
Persistir snapshot-base mais log de comandos/checkpoints, permitindo
revalidação e recuperação sem tornar Markdown editado a fonte.

## Componentes afetados

- `packages/legal-domain/src/editorial-commands/`
- `packages/legal-domain/src/validation/`
- `packages/legal-domain/src/changelog/`
- `src/main/projects/`: armazenamento e recuperação.
- `src/main/export/`: lote.
- `src/renderer/features/preview/editor/`
- `src/renderer/features/validacao/`

## Contratos e fluxo

Comando validado → cópia de trabalho → invariantes → diagnósticos →
reconciliação/Formatter. Aprovação referencia hash da revisão atual; qualquer
novo comando a invalida.

## Decisões locais

- Sem autosave invisível da UI: comandos confirmados entram no diário
  imediatamente e a tela mostra estado.
- Checkpoint reduz replay, mas o log continua auditável.
- Avisos confirmados são ligados ao código e hash da revisão.

## Erros e recuperação

- Comando inválido não altera cópia.
- Crash recupera até o último comando confirmado.
- Conflito após reparse exige escolha explícita, nunca descarte automático.

## Estratégia de validação

- Unitários por comando e regra.
- Propriedades de undo/replay quando suportado.
- Integração crash/reabertura e lote parcial.
- E2E de correção.

## Ordem

1. Modelo de comando/diário.
2. operações essenciais.
3. motor de validação.
4. UI de revisão.
5. changelog e lote.
6. recuperação/E2E.

## Não fazer

- Não permitir edição livre de YAML/Markdown como estado canônico.
- Não permitir override de erro bloqueante.
