# ADR-005: Separação semântica dos campos de status

## Status

Aceito

## Contexto

As primeiras versões da documentação (`PRD.md`, `DATA_MODEL.md`,
`MARKDOWN_SPEC.md`, `BLOCK_ID_SPEC.md`, `SYSTEM_ARCHITECTURE.md`) usavam um
único campo genérico `status` para representar três conceitos distintos:

- se a **lei** está juridicamente em vigor;
- se o **conteúdo** já passou pelo fluxo editorial e pode ser exibido no
  Vinculex SaaS;
- se um **dispositivo individual** (artigo, parágrafo, inciso, alínea,
  item) está ativo, revogado, vetado ou alterado dentro da própria lei.

A revisão de consistência entre documentos identificou que esses três
conceitos tinham enums divergentes e incompatíveis coexistindo sob o mesmo
nome de campo `status` em lugares diferentes (ex.: `vigente` na
`MARKDOWN_SPEC.md`, `publicado` na `DATA_MODEL.md`, `vigente|revogado|
vetado|renumerado` na `BLOCK_ID_SPEC.md`). Isso é sintoma de um problema
real de modelagem, não apenas de inconsistência textual: os três conceitos
têm ciclos de vida, donos e consumidores diferentes.

- **Vigência jurídica** muda por decisão do Poder Legislativo/Judiciário,
  é externa ao Vinculex, e é o que o worker de atualização (
  `UPDATE_PIPELINE.md`) monitora.
- **Fluxo editorial** muda por decisão do editor jurídico dentro do Lex
  Editor, é interno ao Vinculex, e controla o que chega ao Supabase/SaaS
  (regra de negócio: nada é publicado sem aprovação humana).
- **Estado do dispositivo** muda dispositivo a dispositivo dentro de uma
  mesma lei — uma lei `vigente` pode ter artigos `active` e outros
  `revoked` ao mesmo tempo, o que um único campo no nível da lei jamais
  conseguiria representar.

Misturar os três em um campo `status` gera ambiguidade em runtime (uma
consulta `WHERE status = 'vigente'` não deixa claro se filtra a lei, a
publicação ou o dispositivo), força enums incompatíveis a compartilhar o
mesmo nome de coluna/campo, e propaga a confusão para o schema do banco,
para o frontend do Vinculex SaaS e para as regras de validação do Lex
Editor.

## Decisão

O Vinculex **proíbe o uso de um campo genérico `status`** (ou sinônimos
igualmente genéricos, como `situacao` ou `estado`, sem qualificador
semântico) em qualquer tabela central, no frontmatter Markdown e nos tipos
TypeScript do NormaAST. Todo campo de status deve ter um nome
semanticamente qualificado que identifique de qual entidade e de qual
ciclo de vida ele trata.

O domínio principal desta ADR usa três conceitos distintos, cada um com seu
próprio enum e sua própria fonte da verdade. A convenção de serialização é
explícita: os tipos TypeScript da NormaAST usam `camelCase`
(`legalStatus`, `publicationStatus`, `deviceStatus`); Markdown, JSON de
integração e Postgres usam `snake_case` (`legal_status`,
`publication_status`, `device_status`). Não são campos adicionais: são
projeções do mesmo conceito em fronteiras diferentes.

### 1. `legalStatus` / `legal_status` — vigência jurídica da lei

Fonte da verdade: estado jurídico da norma perante o ordenamento.

```ts
type LegalStatus =
  | 'vigente'
  | 'revogada'
  | 'alterada'
  | 'suspensa'
  | 'sem_eficacia'
  | 'desconhecida'
```

Uso: informar se a lei está juridicamente em vigor; filtrar leis no
catálogo do Vinculex SaaS; alertar o usuário sobre risco jurídico de
citar um dispositivo desatualizado.

### 2. `publicationStatus` / `publication_status` — fluxo editorial dentro do Vinculex

Fonte da verdade: estado editorial do conteúdo dentro do pipeline do Lex
Editor.

```ts
type PublicationStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived'
  | 'outdated'
```

Uso: controlar se o conteúdo pode aparecer no Vinculex SaaS; impedir
publicação automática (ver `ADR-004-pipeline-publicacao.md`); gerenciar a
fila de revisão humana; controlar qual versão está ativa.

### 3. `deviceStatus` / `device_status` — estado individual do dispositivo normativo

Fonte da verdade: estado de cada artigo, parágrafo, inciso, alínea ou
item dentro do NormaAST.

```ts
type DeviceStatus =
  | 'active'
  | 'revoked'
  | 'vetoed'
  | 'included'
  | 'amended'
  | 'renumbered'
  | 'suspended'
  | 'unknown'
```

Uso: renderizar tachado/sinalização visual no Markdown; exibir aviso de
revogação ou veto; preservar o Block ID mesmo após alteração ou
renumeração (ver `ADR-001-block-ids-imutaveis.md`); alimentar o diff
estrutural gerado pelo worker de atualização (`UPDATE_PIPELINE.md`).

### Exemplo

Lei (registro em `leis`, também refletido no frontmatter Markdown):

```json
{
  "sigla": "cp",
  "legal_status": "vigente",
  "publication_status": "published"
}
```

Dispositivo ativo como nó da NormaAST:

```json
{
  "blockId": "cp-art-121-par-2-inc-i",
  "deviceStatus": "active"
}
```

O mesmo dispositivo revogado como registro em `dispositivos` — o Block ID é
preservado, nunca removido ou reciclado:

```json
{
  "block_id": "cp-art-10",
  "device_status": "revoked"
}
```

## Consequências

**Positivas**

- Elimina a ambiguidade de runtime: uma consulta ou uma checagem de
  validação sempre deixa explícito qual dos três ciclos de vida está
  sendo tratado.
- Cada campo pode evoluir seu enum de forma independente sem colidir com
  os outros dois (ex.: adicionar `em_analise` a `publication_status` não
  afeta `legal_status` nem `device_status`).
- Alinha o schema do banco, o frontmatter Markdown e os tipos TypeScript
  da NormaAST sob o mesmo vocabulário, com conversão de casing definida na
  fronteira.
- Torna o diff estrutural do worker de atualização mais preciso: uma
  mudança de `device_status` (ex.: `active` → `revoked`) é distinguível de
  uma mudança de `legal_status` da lei como um todo.

**Negativas / trade-offs aceitos**

- Três campos exigem três validações e três pontos de sincronização em
  vez de um só — mais superfície de código no Lex Editor e no schema
  Supabase.
- Migração do conteúdo já documentado com `status` genérico: todo lugar
  em `DATA_MODEL.md`, `MARKDOWN_SPEC.md`, `BLOCK_ID_SPEC.md`,
  `SYSTEM_ARCHITECTURE.md` e `PRD.md` que citava `status` precisa ser
  atualizado para um dos três campos corretos.

## Status adicionais fora do domínio principal

O processo de detecção e revisão de atualizações legislativas
(`UPDATE_PIPELINE.md`) mantém sua própria fila operacional na entidade
`updates_legislativos`. Esse estado **não é** um dos três campos acima:
não descreve a vigência jurídica da lei, o fluxo editorial da publicação
nem o estado de um dispositivo — descreve o andamento da revisão de uma
mudança específica detectada pelo worker.

Por isso recebe um quarto enum nomeado, formalizado nesta mesma ADR, mas
mantido deliberadamente fora do trio principal:

Campo: `update_review_status`

```ts
type UpdateReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'error'
```

Significado de cada valor:

- `pending` — o worker detectou uma divergência de hash e gerou um diff,
  mas a atualização ainda não foi analisada nem aprovada por um editor.
- `approved` — a decisão editorial de aprovação foi registrada. A publicação
  correspondente pode ainda estar em preparação, push ou sync; seu andamento
  pertence a `publication_attempt_status`.
- `rejected` — a atualização foi analisada e descartada manualmente
  (ex.: falso positivo, diff irrelevante, erro de leitura da fonte).
- `superseded` — a atualização ficou obsoleta porque uma nova divergência
  mais recente foi detectada para a mesma lei antes desta ser aprovada ou
  publicada.
- `error` — falha durante parsing, geração de diff, importação ou
  validação da atualização detectada; requer intervenção do Administrador
  Técnico.

Uso: controlar a fila de revisão exibida no Lex Editor
(`USER_FLOWS.md`, fluxo "Revisar uma atualização legislativa detectada
pelo worker"); impedir que uma atualização `superseded` ou `rejected`
seja publicada por engano; alimentar logs de auditoria do worker.

Nome canônico no Supabase: `update_review_status`.

A operação técnica de publicação possui outro ciclo de vida independente:

Campo: `publication_attempt_status`

```ts
type PublicationAttemptStatus =
  | 'prepared'
  | 'committed_local'
  | 'pushed'
  | 'syncing'
  | 'published'
  | 'failed'
```

Esse enum responde “até onde chegou esta publicação idempotente?”, sem alterar
`publication_status` da lei nem desfazer uma decisão editorial em
`update_review_status`. `published` só é alcançado após o sync transacional e a
troca de `leis.versao_publicada_id`; `failed` é retomável com a mesma chave de
idempotência.

Regra geral: **nenhuma tabela central do
sistema usa um campo genérico `status`, `situacao` ou `estado` sem
qualificador semântico** — sempre `legal_status`, `publication_status`,
`device_status`, `update_review_status`, `publication_attempt_status`, ou um
novo campo igualmente nomeado para seu próprio ciclo de vida.

O SaaS acrescenta dois ciclos independentes:

```ts
type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

type AccountStatus = 'active' | 'suspended';
```

`subscription_status = 'trialing'` pode nascer uma única vez da concessão
server-side definida na ADR-008; os demais estados financeiros refletem
eventos verificados/reconciliados do provedor ou o vencimento calculado do
período. `account_status` controla acesso por abuso/suporte e só muda por
função administrativa auditada. Cancelar uma assinatura não suspende a conta;
suspender a conta não falsifica o estado financeiro.

| Entidade | Campo | Significado |
|---|---|---|
| Lei | `legal_status` | Situação jurídica da norma |
| Publicação | `publication_status` | Situação editorial/publicação |
| Dispositivo | `device_status` | Situação do bloco normativo |
| Atualização legislativa | `update_review_status` | Situação da revisão da atualização detectada pelo worker |
| Tentativa de publicação | `publication_attempt_status` | Progresso técnico da operação idempotente |
| Assinatura | `subscription_status` | Ciclo financeiro sincronizado com o provedor |
| Conta do SaaS | `account_status` | Acesso operacional da conta |

## Alternativas consideradas

### Um único campo `status` com enum unificado

Combinar os três conceitos em um enum único e mais genérico (ex.:
`vigente_publicado`, `revogado_arquivado`).

Rejeitado porque o produto cartesiano dos três ciclos de vida cresce
rápido e ilegível (6 × 6 × 8 combinações teóricas), e porque um dispositivo
individual pode estar `revoked` dentro de uma lei que continua `vigente` —
um enum unificado no nível da lei não consegue representar isso sem perder
granularidade.

### Manter `status` genérico e diferenciar por contexto (tabela/arquivo)

Manter o nome `status` em cada tabela/local e confiar que o contexto (qual
tabela, qual seção do frontmatter) deixa claro o significado.

Rejeitado porque essa foi exatamente a abordagem que gerou a inconsistência
identificada na revisão: nomes iguais convidam a comparações e migrações
erradas (ex.: copiar `status` de `dispositivos` para `leis` por engano), e
dificulta busca/grep no código e na documentação para auditar todos os usos
de um conceito específico.

## Documentos afetados por esta decisão

- `DATA_MODEL.md` — schema SQL de `leis` e `dispositivos`, políticas RLS.
- `MARKDOWN_SPEC.md` — campo `status` do frontmatter renomeado para
  `legal_status`.
- `BLOCK_ID_SPEC.md` — tipo `StatusDispositivo` renomeado/realinhado para
  `device_status` com o enum desta ADR.
- `SYSTEM_ARCHITECTURE.md` — referências genéricas a status de dispositivo.
- `PRD.md` — tabela de campos de frontmatter e requisitos funcionais que
  mencionam status.
- `UPDATE_PIPELINE.md` — categorias de diff por dispositivo, e o campo
  `updates_legislativos.status` renomeado para
  `updates_legislativos.update_review_status`.
