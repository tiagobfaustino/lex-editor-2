# Feature 009 — Projeções completa e vigente

## Metadados

- `implementation_status`: done
- `priority`: P1
- `owner`: não atribuído

## Objetivo

Permitir que uma única revisão aprovada gere uma lei completa, com histórico e
partes sem eficácia, ou uma lei contendo somente o texto vigente, sem perder
evidência, identidade ou rastreabilidade.

## Problema

O Markdown completo é valioso para auditoria e estudo histórico, mas pode
dificultar a leitura de quem precisa apenas da redação eficaz atual. Criar duas
importações ou duas árvores editáveis produziria divergência jurídica e de
Block IDs.

## Escopo

- Manter importação completa do conjunto de fontes da ADR-009.
- Implementar as projeções `complete_with_history` e `current_only` da
  ADR-012 como funções puras sobre a mesma `IdentifiedNormaAST`.
- Expor seleção de projeção no preview e na exportação desktop.
- Identificar o perfil no artefato derivado e manter o arquivo completo como
  publicação canônica.
- Validar as duas saídas com snapshots reais das Leis nº 9.099/1995,
  nº 9.605/1998 e nº 10.826/2003.

## Fora do escopo

- Duas NormaASTs editáveis para a mesma revisão.
- Excluir histórico dos snapshots, banco ou registro de Block IDs.
- Inferir revogação apenas porque um dispositivo não aparece na compilada.
- Usar Markdown pessoal como fonte normativa ou golden.

## Dependências

- Feature 008.
- `../../../docs/architecture/ADR-005-status-fields.md`
- `../../../docs/architecture/ADR-006-historico-redacoes-no-corpo.md`
- `../../../docs/architecture/ADR-009-fontes-compiladas-e-historicas.md`
- `../../../docs/architecture/ADR-012-projecoes-completa-e-vigente.md`
- `../../../docs/architecture/MARKDOWN_SPEC.md`

## Requisitos

- RF-009-01: importar e armazenar sempre a representação completa e suas
  fontes, independentemente da projeção selecionada.
- RF-009-02: `complete_with_history` mantém redações anteriores e dispositivos
  sem eficácia com a sinalização canônica.
- RF-009-03: `current_only` omite histórico e subárvores sem eficácia, mas
  preserva texto vigente, hierarquia e Block IDs dos nós mantidos.
- RF-009-04: alternar a projeção não modifica a NormaAST nem cria nova revisão.
- RF-009-05: estado desconhecido bloqueia a projeção vigente até decisão
  editorial.

## Invariantes

- Uma revisão possui uma única NormaAST autoritativa.
- A publicação canônica continua `complete_with_history`.
- IDs omitidos da projeção vigente permanecem reservados.
- A opção de visualização nunca decide vigência jurídica.
- Redações anteriores tachadas são histórico do dispositivo e não recebem
  Block ID próprio; somente a redação canônica atual materializa a âncora. Um
  dispositivo integralmente revogado sem substituição continua sendo o nó
  canônico da posição e preserva seu Block ID na projeção completa.

## Cenários essenciais

### Lei alterada

Dado um artigo com redação anterior e atual, quando o editor alterna de
`complete_with_history` para `current_only`, então a redação anterior some e a
atual permanece com o mesmo Block ID.

### Dispositivo revogado

Dado um artigo ou subordinado revogado, quando a projeção vigente é gerada,
então toda a subárvore sem eficácia é omitida, mas seus IDs continuam no
registro histórico e reaparecem ao voltar à projeção completa.

### Estado incerto

Dado um dispositivo com `deviceStatus: unknown`, quando a projeção vigente é
solicitada, então o sistema bloqueia a geração e aponta o dispositivo para
decisão editorial.

## Critérios de aceite

- [x] Preview alterna entre completo e somente vigente sem reprocessamento.
- [x] Exportação gera os dois perfis de forma determinística e identificável.
- [x] Saída vigente não contém redação anterior nem dispositivo sem eficácia.
- [x] Saída completa preserva integralmente histórico e estados.
- [x] Alternância não altera AST, hashes, revisão ou Block IDs.
- [x] As três leis reais passam nos dois perfis com snapshots offline.

## Validação mínima

- Risco: crítico para fidelidade jurídica.
- Testes puros de projeção, goldens separados, integração preview/exportação e
  E2E seletivo com as três leis de referência.

## Riscos

- Omitir texto ainda vigente: bloquear `unknown` e não usar ausência como
  revogação.
- Usuário confundir saída derivada com fonte canônica: identificar o perfil no
  arquivo e na UI.
- Duplicar lógica entre preview e exportação: ambos consomem a mesma projeção
  pura do domínio.
