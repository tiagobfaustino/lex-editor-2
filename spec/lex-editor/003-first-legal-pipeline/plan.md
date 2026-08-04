# Plano de Implementação — Feature 003

## Abordagem

Construir um pipeline funcional sobre uma fixture pequena. Cada estágio recebe
e devolve contrato validado; a CLI apenas orquestra e faz escrita atômica.

## Componentes afetados

- `packages/legal-domain/src/source/`: snapshot e referência.
- `packages/legal-domain/src/parser/`: parser mínimo.
- `packages/legal-domain/src/block-id/`: atribuição inicial.
- `packages/legal-domain/src/formatter/`: Markdown canônico.
- `packages/cli/`: comando `lex process`.
- `fixtures/legal/`: entrada, expectativa semântica e golden.

## Contratos e fluxo

```text
arquivo(s) → SourceSnapshot[] → ParsedNormaAST → IdentifiedNormaAST
            → validation report → Markdown bytes
```

O arquivo final é escrito em temporário no mesmo diretório e renomeado somente
depois que todas as etapas passam.

## Decisões locais

- A fixture deve ser curta, mas conter profundidade e estado jurídico.
- Datas e SemVer são argumentos/fixture, nunca relógio do Formatter.
- CLI retorna códigos distintos para entrada, parsing, validação e I/O.

## Erros e recuperação

- Falha não cria saída final.
- Arquivo temporário incompleto é removido/ignorado com alvo explicitamente
  resolvido.
- Diagnóstico textual deriva de códigos estruturados.

## Estratégia de validação

- Unitários mínimos por estágio.
- Integração CLI e golden byte a byte.
- Variante inválida e duas execuções determinísticas.
- Revisão humana da fixture contra fonte.

## Ordem

1. Selecionar e documentar fixture.
2. Conjunto de snapshots, com exatamente uma fonte primária.
3. Parser mínimo.
4. IDs.
5. Formatter.
6. CLI e integração.

## Não fazer

- Não generalizar padrões ausentes da fixture.
- Não aceitar AST parcial para “continuar”.
