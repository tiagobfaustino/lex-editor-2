# ADR-010: Alínea diretamente sob artigo e parágrafo

## Status

Aceito em 2026-08-05.

Emenda `DATA_MODEL.md` §NormaAST e `BLOCK_ID_SPEC.md` §2.1. As demais decisões
dos dois documentos permanecem em vigor.

## Contexto

O `DATA_MODEL.md` modelava `AlineaNode` exclusivamente como filha de
`IncisoNode`:

```typescript
interface ArtigoNode  { children: (ParagrafoNode | IncisoNode | PenaNode)[]; }
interface IncisoNode  { children: (AlineaNode | PenaNode)[]; }
```

A `BLOCK_ID_SPEC.md` §2.1 acompanhava: `dispositivo-alinea` só era alcançável a
partir de `dispositivo-inciso`, então um ID de alínea sempre continha `inc-`.

Ao processar a LINDB integral pela primeira vez (Feature 004, T004-07), o texto
compilado oficial contradisse o modelo no art. 15:

```
Art. 15. Será executada no Brasil a sentença proferida no estrangeiro, que
reuna os seguintes requisitos:
a) haver sido proferida por juiz competente;
b) terem sido os partes citadas ou haver-se legalmente verificado à revelia;
c) ter passado em julgado e estar revestida das formalidades necessárias...
d) estar traduzida por intérprete autorizado;
e) ter sido homologada pelo Supremo Tribunal Federal.
```

Cinco alíneas pendem do caput, sem inciso intermediário. Não é erro de
extração nem caso isolado: é a estrutura da norma, e a técnica legislativa
brasileira a admite — o art. 10, II, `a` da Lei Complementar 95/1998 trata
alínea como desdobramento de inciso, mas o uso consagrado, inclusive em normas
anteriores a ela, desdobra o caput diretamente em alíneas.

## Decisão

`AlineaNode` passa a ser filha admissível de `ArtigoNode`, `ParagrafoNode` e
`IncisoNode`.

A gramática de Block ID acompanha: `dispositivo-alinea` torna-se alcançável a
partir de `dispositivo-artigo` e `dispositivo-paragrafo`, além de
`dispositivo-inciso`. IDs como `lindb-art-15-ali-a` e `cp-art-1-par-2-ali-b`
passam a ser canônicos.

O que **não** muda:

- a ordem dos segmentos continua hierárquica e cumulativa (§2.3.1): a alínea
  carrega os segmentos de todos os ancestrais que existirem, e apenas eles;
- `ItemNode` continua exclusivamente sob `AlineaNode`;
- nenhum ID já publicado muda. A gramática só passou a aceitar uma cadeia que
  antes não era produzível; nenhuma cadeia existente foi reinterpretada.

## Alternativa rejeitada

**Tratar como irregularidade da fonte**, marcando confiança baixa e exigindo
decisão editorial por ocorrência.

Rejeitada porque a estrutura é corriqueira, não excepcional — só a LINDB tem
cinco ocorrências num único artigo, e CP e CF/88 têm muitas. Marcar tudo isso
para revisão humana transformaria a fila de revisão em ruído e treinaria o
editor a aprovar sem ler, que é o oposto do que a evidência de parsing existe
para produzir. Confiança baixa deve significar "o parser genuinamente não sabe",
e aqui ele sabe.

## Consequências

**Positivas**

- O modelo passa a descrever a legislação real em vez de um subconjunto dela.
- Normas com desdobramento direto do caput em alíneas deixam de exigir exceção.

**Negativas / trade-offs aceitos**

- A cadeia de Block ID de uma alínea deixa de permitir inferir que existe um
  inciso ancestral. Quem dependia disso — nada no código atual depende —
  precisa consultar a árvore, não o ID.
- O espaço de IDs válidos cresce, então a validação de forma fica um pouco mais
  permissiva. A unicidade e a imutabilidade, que são o que protege os links,
  não mudam.

## Verificação

- LINDB art. 15 produz `lindb-art-15-ali-a` a `lindb-art-15-ali-e`.
- Alínea sob parágrafo produz `…-par-{n}-ali-{letra}`.
- Alínea sob inciso continua produzindo `…-inc-{romano}-ali-{letra}`.
- Item continua exigindo alínea como pai.

## Referências

- `./DATA_MODEL.md` §NormaAST
- `./BLOCK_ID_SPEC.md` §2.1 e §2.3
- `../../spec/lex-editor/004-full-legal-hierarchy/COBERTURA.md`
