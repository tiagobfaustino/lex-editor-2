# Plano de Implementação — Feature 004

## Abordagem

Generalizar por casos jurídicos mínimos antes de executar leis completas.
Manter adaptador Planalto separado do reconhecedor hierárquico e do
reconciliador de identidade.

## Componentes afetados

- `packages/legal-domain/src/source/planalto/`
- `packages/legal-domain/src/parser/rules/`
- `packages/legal-domain/src/reconciliation/`
- `packages/legal-domain/src/block-id/`
- `packages/legal-domain/src/formatter/`
- `packages/legal-domain/src/postgres-projection/`
- `fixtures/legal/{cp,cf1988,lei-curta}/`

## Contratos e fluxo

HTMLs compilado/anotado, projeções limpas e sinais dos snapshots alimentam
candidatos com `sourceRef` e `supportingSourceRefs`; regras constroem
`ParsedNormaAST`; reconciliação compara base publicada e candidata;
IDs/redirects produzem AST identificada; Formatter e projeção consomem a mesma
AST.

## Decisões locais

- Uma fixture mínima por ramificação precede a lei completa.
- Texto vigente vem de `primary_current`; história de
  `historical_auxiliary` nunca o sobrescreve silenciosamente.
- Match de identidade retorna confiança/evidência; não apenas booleano.
- Projeção Postgres é testada como adaptador puro antes de banco real.

## Erros e recuperação

- Ambiguidade vira diagnóstico bloqueante.
- Mudança de markup não apaga evidência bruta.
- Colisão histórica nunca é resolvida renomeando ID publicado.

## Estratégia de validação

- Tabela de cobertura ligada às seções das specs.
- Testes de propriedades de unicidade/imutabilidade.
- Goldens e round-trip.
- Auditoria manual de artigos e amostra estratificada de subordinados.

## Ordem

1. Catálogo de casos mínimos.
2. Gramática completa.
3. estados/históricos/tabelas/anexos.
4. reconciliação/aliases.
5. formatter completo.
6. leis integrais e projeção.

## Não fazer

- Não codificar exceção pelo nome da lei quando a regra é estrutural.
- Não usar snapshot de golden como única evidência de correção.
