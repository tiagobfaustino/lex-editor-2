# Feature 002 — Contratos do domínio jurídico

## Metadados

- `implementation_status`: draft
- `priority`: P0
- `owner`: não atribuído

## Objetivo

Entregar contratos TypeScript e runtime independentes de infraestrutura para
`ParsedNormaAST` e `IdentifiedNormaAST`, incluindo nós, estados, origem,
evidência e invariantes estruturais mínimas.

## Problema

Parser, reconciliador, Formatter, worker e publicação precisam compartilhar a
mesma linguagem. Tipos apenas de compilação não protegem dados externos ou
persistidos; schemas isolados dos tipos tendem a divergir.

## Escopo

- Enums e uniões discriminadas descritos em `DATA_MODEL.md`.
- Schemas runtime e tipos inferidos na mesma unidade.
- Fases `parsed` e `identified`.
- `SourceReference`, `ParseEvidence`, históricos e tabelas.
- Validação de IDs internos, ordem, árvore, texto obrigatório e fase de AST.
- Serialização JSON determinística no nível semântico.

## Fora do escopo

- Reconhecer texto do Planalto.
- Gerar ou reconciliar Block IDs.
- Formatar Markdown ou persistir no Postgres.
- Regras completas de hierarquia específicas da fonte.

## Dependências

- Feature 001.
- `../../../docs/architecture/ADR-002-norma-ast.md`
- `../../../docs/architecture/ADR-005-status-fields.md`
- `../../../docs/architecture/ADR-006-historico-redacoes-no-corpo.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-002-01: cada tipo de nó tem discriminante e schema runtime correspondente.
- RF-002-02: fase `parsed` rejeita Block IDs e `identified` os exige em todo
  dispositivo referenciável.
- RF-002-03: dispositivo revogado exige decisão
  `preservarTextoRevogado`.
- RF-002-04: `sourceRef` e `parseEvidence` são obrigatórios em cada nó.
- RF-002-05: nenhum contrato usa campo genérico `status`.

## Invariantes

- A raiz não possui Block ID.
- Divisão estrutural pode não possuir Block ID.
- Nós referenciáveis em AST identificada sempre possuem valor canônico sem
  `^`.
- `redacoesAnteriores` preserva ordem e não cria identidade própria.
- Tabela mantém contagem coerente de colunas.

## Cenários essenciais

### Round-trip válido

Dado um objeto mínimo válido, quando validado, serializado e lido novamente,
então a estrutura e os valores semânticos permanecem iguais.

### Fase inválida

Dado um dispositivo sem Block ID declarado como `identified`, quando validado,
então o contrato o rejeita com localização acionável.

## Critérios de aceite

- [ ] Todos os nós de `DATA_MODEL.md` existem em tipo e schema.
- [ ] Fixtures mínimas `parsed` e `identified` passam.
- [ ] Casos inválidos de fase, hierarquia, tabela e revogação falham.
- [ ] Pacote não importa infraestrutura.
- [ ] Typecheck prova que o tipo é derivado ou testado contra o schema runtime.

## Validação mínima

- Risco: crítico para fidelidade e contratos compartilhados.
- Testes de contrato, propriedades de fase e casos negativos obrigatórios.

## Riscos

- Schema recursivo difícil de inferir: manter exports explícitos e testes.
- Antecipar campos não normativos: implementar somente o modelo aprovado.
