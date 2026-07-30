# Plano de Implementação — Feature 002

## Abordagem

Organizar contratos por domínio, usando schemas runtime como limite de entrada
e tipos inferidos/compatíveis. Separar validação de forma (schema) de
invariantes globais da árvore (validador estrutural).

## Componentes afetados

- `packages/legal-domain/src/ast/enums.ts`
- `packages/legal-domain/src/ast/nodes.ts`
- `packages/legal-domain/src/ast/schemas.ts`
- `packages/legal-domain/src/ast/validate.ts`
- `packages/legal-domain/src/ast/fixtures/`
- `packages/legal-domain/src/index.ts`

## Contratos e fluxo

`unknown → schema de fase → AST tipada → validação estrutural → resultado`.
Erros carregam caminho do nó e código estável, sem depender da mensagem textual
do validador subjacente.

## Decisões locais

- Uniões discriminadas por `tipo`.
- Helpers recursivos compartilhados, mas schemas `parsed` e `identified`
  públicos e distintos.
- IDs internos de runtime e Block IDs são validados separadamente.

## Erros e recuperação

- Schema inválido retorna lista limitada e estruturada.
- Validador acumula problemas independentes quando seguro; interrompe em
  estrutura impossível de percorrer.

## Estratégia de validação

- Fixture mínima por família de nó.
- Casos negativos por fase/invariante.
- Round-trip JSON e teste de ausência de dependências proibidas.

## Ordem

1. Enums, bases e erros.
2. Cada família de nó junto de seu schema.
3. Fases da raiz.
4. Validador global.
5. fixtures, exports e testes.

## Não fazer

- Não implementar regex de fonte.
- Não criar campos além de `DATA_MODEL.md`.
