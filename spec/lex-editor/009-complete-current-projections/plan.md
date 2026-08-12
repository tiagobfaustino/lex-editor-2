# Plano de Implementação — Feature 009

## Abordagem

Projetar uma cópia validada da `IdentifiedNormaAST` antes do Formatter. A árvore
completa permanece imutável; preview e exportação recebem o perfil escolhido e
consomem a mesma função pura.

## Componentes afetados

- `packages/legal-domain/src/content-projection/`
- `packages/legal-domain/src/formatter/`
- contratos IPC de preview/exportação.
- `src/main/` para orquestração da exportação.
- `src/renderer/` para o seletor de projeção.
- `fixtures/legal/{l9099,l9605,l10826}/`

## Contratos e fluxo

Conjunto de fontes completo → NormaAST autoritativa → perfil de projeção → AST
derivada validada → Formatter → preview/exportação. A AST derivada não é
persistida como revisão independente.

## Decisões locais

- `complete_with_history` é o padrão retrocompatível.
- `current_only` filtra por `deviceStatus` conforme a ADR-012 e remove divisões
  vazias depois da filtragem.
- O perfil integra o hash do artefato exportado, mas não altera o hash da
  revisão ou dos snapshots.
- Markdown pessoal serve apenas à conferência textual depois de remover
  decoração; snapshots oficiais versionados sustentam os asserts.
- `redacoesAnteriores` permanecem valores históricos do nó, sem identidade
  própria. A projeção completa preserva esses valores e o único Block ID do nó;
  a vigente remove apenas o histórico. Revogação integral preserva o ID no nó
  canônico completo, embora esse nó seja omitido de `current_only`.

## Erros e recuperação

- `unknown` retorna diagnóstico bloqueante com caminho/Block ID.
- Uma falha ao gerar a projeção derivada não altera a revisão completa.
- Alternar de volta ao perfil completo restaura a visualização a partir da AST
  autoritativa, não de cache filtrado.

## Estratégia de validação

- Casos mínimos para cada `deviceStatus` e para poda de divisões vazias.
- Goldens completos e vigentes das três leis reais.
- Testes de imutabilidade e determinismo.
- Integração IPC e E2E seletivo do seletor de preview/exportação.

## Ordem

1. Contrato e projeção pura.
2. Formatter e identificação do perfil.
3. Preview e exportação.
4. Fixtures reais, integração e E2E.

## Não fazer

- Não modificar a AST original para filtrar a saída.
- Não gerar Block IDs novos para a projeção derivada.
- Não tratar a página compilada como substituta do snapshot anotado.
