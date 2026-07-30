# Instruções do workspace

## Processo de features

Antes de implementar:

1. leia `spec/README.md`, `spec/DEVELOPMENT_RULES.md` e
   `spec/TEST_STRATEGY.md`;
2. consulte `spec/FEATURE_INDEX.md`;
3. trabalhe somente na feature com `implementation_status: in_progress`;
4. leia integralmente `spec.md`, `plan.md` e `tasks.md` dessa feature.

Se nenhuma feature estiver `in_progress`, não escolha uma silenciosamente:
prepare ou ative a próxima somente quando o pedido do usuário autorizar
implementação.

## Fontes de verdade

ADRs e especificações normativas em `docs/architecture/` prevalecem sobre
specs de implementação. Em seguida valem arquitetura/modelo, PRD, roadmap,
feature spec, plano e tarefas, na ordem definida em `spec/README.md`.

Não ajuste um contrato superior silenciosamente para fazer o código passar.
Relate conflito real antes de prosseguir.

## Execução

- Não antecipe feature futura sem dependência comprovada.
- Em tarefas de Electron, main, preload, IPC ou empacotamento, use a skill
  `.agents/skills/lex-editor-electron/SKILL.md`.
- Entregue tipo, validação runtime e testes essenciais de um contrato na mesma
  tarefa sempre que possível.
- Aplique testes pelo risco, não por meta artificial de cobertura.
- Atualize checkbox somente depois de implementar e validar.
- Não marque feature `done` enquanto algum critério de aceite estiver
  pendente.
- Crie `review.md` apenas no encerramento quando houver informação permanente
  relevante.
