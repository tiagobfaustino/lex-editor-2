# Regras de Desenvolvimento

## Escopo

1. Implementar somente a feature marcada `in_progress`.
2. Não antecipar uma feature futura sem dependência técnica comprovada.
3. Preservar mudanças preexistentes e não relacionadas no workspace.
4. Não alterar ADR ou especificação normativa silenciosamente para acomodar o
   código.
5. Em conflito documental real, parar a implementação e registrar a
   divergência.

## Contratos

6. `packages/legal-domain` não depende de Electron, React, filesystem, rede ou
   banco.
7. O renderer não recebe HTML bruto, AST integral, paths reais, secrets ou
   clientes privilegiados.
8. Tipos TypeScript e validação runtime do mesmo contrato são entregues na
   mesma tarefa sempre que possível.
9. Não usar campo genérico `status` em contratos do produto; usar os nomes
   definidos em ADR-005.
10. Block IDs são armazenados sem `^` e obedecem integralmente à especificação
    normativa.

## Implementação

11. Não adicionar dependência sem registrar finalidade e alternativa no
    `plan.md`.
12. Não criar abstração para caso puramente hipotético.
13. Uma tarefa deve entregar comportamento coeso e verificável; evitar
    “primeiro todos os tipos, depois todos os schemas” quando isso deixar um
    contrato parcialmente utilizável.
14. Operações privilegiadas usam capacidades nomeadas e payload mínimo.
15. Erro não pode ser convertido em sucesso apenas para manter o fluxo.

## Validação

16. Aplicar `TEST_STRATEGY.md` pelo impacto da mudança, não pelo nome da
    camada.
17. Testar obrigatoriamente fidelidade jurídica, identidade, persistência,
    publicação, recuperação e fronteiras de segurança.
18. Não escrever teste trivial apenas para elevar cobertura.
19. Executar ao menos lint, typecheck e testes diretamente relacionados antes
    de concluir uma tarefa de código.
20. Não marcar checkbox nem feature como concluída sem evidência da validação.

## Documentação e encerramento

21. Atualizar `tasks.md` no mesmo trabalho que conclui a tarefa.
22. Alteração de escopo exige primeiro atualizar `spec.md`.
23. Decisão arquitetural duradoura exige ADR; detalhe local pertence ao
    `plan.md`.
24. Criar `review.md` no encerramento quando houver desvio, dívida, decisão ou
    evidência relevante; não criar relatório cerimonial vazio.
