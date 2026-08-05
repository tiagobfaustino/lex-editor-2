# Feature 004 — Hierarquia jurídica completa

## Metadados

- `implementation_status`: in_progress
- `priority`: P0
- `owner`: não atribuído

## Objetivo

Expandir o primeiro pipeline para toda a gramática normativa aprovada e
demonstrá-la com Código Penal, Constituição Federal de 1988 e uma lei curta.

## Problema

O corte inicial prova integração, mas não cobre profundidade, irregularidades,
históricos, tabelas, anexos, colisões ou reconciliação. Essas regras determinam
a fidelidade do produto.

## Escopo

- Importação de fixtures HTML/Markdown locais e extração Planalto.
- Todos os nós e casos especiais de `DATA_MODEL.md`.
- Evidência de parsing e revisão obrigatória para baixa confiança.
- Geração e reconciliação histórica completa de Block IDs.
- Aliases, renumeração, colisões históricas e namespace reservado.
- Formatter canônico completo, referências cruzadas resolvíveis e golden
  files das três leis.
- Projeção de ida e volta AST ↔ Postgres em ambiente de teste ou adaptador
  fiel de contrato.

## Fora do escopo

- UI desktop, importação de rede e edição manual.
- Publicação de produção.
- LexML ou fontes adicionais.

## Dependências

- Feature 003.
- `../../../docs/architecture/ADR-001-block-ids-imutaveis.md`
- `../../../docs/architecture/ADR-006-historico-redacoes-no-corpo.md`
- `../../../docs/architecture/ADR-009-fontes-compiladas-e-historicas.md`
- `../../../docs/architecture/BLOCK_ID_SPEC.md`
- `../../../docs/architecture/MARKDOWN_SPEC.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-004-01: reconhecer todos os níveis normativos previstos.
- RF-004-02: preservar texto, ordem, origem, evidência e histórico.
- RF-004-03: reconciliar atualização sem alterar ID por mudança textual.
- RF-004-04: bloquear ambiguidade de identidade para decisão editorial.
- RF-004-05: Markdown completo permanece determinístico e válido.

## Invariantes

- Baixa confiança nunca avança silenciosamente para AST identificada.
- ID publicado não é reciclado, removido nem recalculado.
- Histórico riscado não recebe novo Block ID.
- Alias é permanente, acíclico e resolvido no servidor consumidor.

## Cenários essenciais

### Lei complexa

Dado o snapshot do [Código Penal compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm),
quando processado, então todos os artigos e a amostra acordada de subordinados
correspondem à fonte oficial. O arquivo
`../../../exemplos/Decreto-Lei n° 2.848 (CP).md` serve apenas como referência
editorial comparativa.

### Atualização

Dadas versões antes/depois com alteração, inclusão e renumeração, quando
reconciliadas, então IDs antigos permanecem, novos são reservados e redirects
corretos são produzidos.

## Critérios de aceite

- [ ] Três leis de referência atendem aos critérios do roadmap.
- [ ] Todos os tipos de composição de Block ID têm cobertura.
- [ ] Alteração textual não altera identidade.
- [ ] Colisão tardia não renomeia dispositivo publicado.
- [ ] Round-trip Postgres não perde semântica.
- [ ] Goldens abrem corretamente no Obsidian por revisão manual.

## Validação mínima

- Risco: crítico.
- Testes unitários extensivos por regra, fixtures reais, propriedades de
  imutabilidade, integração e auditoria manual amostral.

## Riscos

- HTML oficial variar: separar evidência de fonte de regra jurídica.
- Fixtures enormes dificultarem diagnóstico: manter casos mínimos por regra
  além das três leis completas.
