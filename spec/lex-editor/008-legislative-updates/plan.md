# Plano de Implementação — Feature 008

## Abordagem

Executar worker com identidade própria e reutilizar bibliotecas do domínio.
Separar detecção, proposta, decisão editorial e publicação em estados e
autoridades diferentes.

## Componentes afetados

- `services/update-worker/`: scheduler, fetch seguro e detecção.
- `packages/legal-domain/src/normative-projection/`
- `packages/legal-domain/src/diff/`
- funções/RPCs privadas da fila.
- `src/main/updates/` e `src/renderer/features/atualizacoes/`

## Contratos e fluxo

Conjunto de snapshots atual → ParsedAST → projeção normativa/hash → comparação →
reconciliação/diff → pendência. Aprovação cria nova revisão e entra na Feature
007; rejeição/supersessão nunca altera conteúdo público.

## Decisões locais

- Hash bruto de cada artefato e hash normativo são persistidos separadamente.
- A projeção normativa aceita `ParsedNormaAST` e `IdentifiedNormaAST`, mas
  remove fase, IDs internos, Block IDs, proveniência, evidência de parsing e
  metadados operacionais antes da serialização canônica. Texto, hierarquia,
  ordem, vigência e estados jurídicos permanecem; assim a mesma candidata pode
  ser comparada à última versão publicada sem ruído de reconciliação.
- O pacote de domínio permanece puro: recebe uma função SHA-256 injetada e
  valida o digest, enquanto CLI/worker fornecem a implementação criptográfica.
- O inventário bruto é derivado do `ConjuntoDeFontes`, contém uma entrada por
  artefato e ordenação canônica independente da ordem de captura. Conteúdo
  bruto não integra a projeção normativa e não é copiado para logs.
- O diff compara dispositivos pelo Block ID reconciliado e registra texto,
  caminho, estado e confiança dos dois lados. Ausência na candidata permanece
  pendência de revisão, nunca revogação automática. Renumeração exige mapeamento
  explícito, estado jurídico compatível e evidência auditável; similaridade de
  texto não estabelece identidade.
- Chave de deduplicação inclui lei, base publicada e hash candidato.
- Scheduler aplica backoff/jitter e suspende fonte degradada.
- O worker recebe coletor de fontes, relógio, aleatoriedade, SHA-256 e fila por
  interfaces injetadas. Assim o processo Node reutiliza o domínio sem carregar
  rede, Electron ou credencial de banco no núcleo e os testes rodam offline.
- A chave de detecção é SHA-256 de lei, versão-base publicada e hash normativo
  candidato. Repetição incrementa a evidência da mesma linha; nova candidata
  supersede apenas propostas ainda não aprovadas. Reprocessar mantém o estado
  `error`/`rejected` até o worker produzir outro resultado, evitando que uma
  candidata ausente ou inválida pareça aprovável.
- Postgres separa `lex_update_worker` e `lex_update_editor`. Ambas executam
  somente funções privadas fechadas; o worker não recebe grants de escrita em
  `leis`, `versoes_lei`, `dispositivos`, Block IDs ou publicação.
- O renderer recebe resumos e lados textuais limitados do diff. AST, snapshots,
  URIs internas, paths e identidade do ator permanecem fora do IPC; o ator é
  derivado e revalidado pelo endpoint editorial.
- A preparação da publicação recebe explicitamente a identidade editorial
  validada junto com a proposta. O manifesto e a aprovação da Feature 007 ficam
  assim vinculados ao mesmo ator que decide a pendência; o worker nunca fornece
  nem escolhe essa identidade.

## Erros e recuperação

- Falha de rede/parser atualiza a pendência/telemetria apropriada sem publicar.
- Nova divergência supersede proposta antiga incompatível.
- Retry com mesmos hashes não duplica.

## Estratégia de validação

- Fixtures antes/depois para cada tipo de mudança.
- Mudança cosmética e ambiguidade.
- Integração fila/revisão/permissões.
- E2E aprovação e rejeição.
- O E2E de atualização usa repositório Git descartável e o publicador real da
  Feature 007 para validar manifesto, aprovação, candidate, promoção e
  transação. As permissões e a transação SQL são provadas separadamente em
  PostgreSQL descartável, evitando depender de rede no CI.

### Matriz de leis reais

Recortes textuais normalizados das páginas oficiais são versionados com URL,
data e SHA-256 por arquivo. Testes de CI não acessam a rede. Os Markdown de estudo
fornecidos externamente servem apenas à auditoria editorial: tags HTML,
negrito, realces, Block IDs pessoais e outras decorações são ignorados; texto,
estado e tachado esperado precisam ser confirmados na fonte oficial.

| Norma | Conjunto de fontes | Evidência mínima esperada |
|---|---|---|
| Lei nº 9.099/1995 | `l9099.htm` como anotada e `primary_current`, na ausência de compilada | Arts. 61 e 62 mantêm redações anteriores separadas das redações atuais; alteração não vira revogação do artigo |
| Lei nº 9.605/1998 | `l9605.htm` como anotada e `primary_current`, sem pressupor compilada | Art. 67 separa redação anterior, redação atual e parágrafo revogado; ausência de segunda fonte não bloqueia caso inequívoco |
| Lei nº 10.826/2003 | `l10.826compilado.htm` como `primary_current`; `l10.826.htm` como `historical_auxiliary` | Texto vigente vem da compilada; redações/anexos superados vêm da anotada; divergência real bloqueia revisão |

As projeções `complete_with_history` e `current_only` serão implementadas na
Feature 009. Na Feature 008, a matriz comprova que detecção e diff preservam os
dados necessários para ambas sem criar mudança normativa falsa.

## Ordem

1. Projeção/hash.
2. diff/reconciliação.
3. worker e deduplicação.
4. fila/RPCs.
5. UI de revisão.
6. integração com publicação e operação.

## Não fazer

- Não conceder ao worker função de publicação.
- Não avançar atualização somente por score de confiança.
