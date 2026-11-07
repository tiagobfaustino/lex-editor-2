# Revisão de Encerramento — Feature 013

## Resultado

Correção validada em 2026-10-08 após reabertura da feature. O encerramento
anterior, de 2026-08-20, não comprovava a pesquisa de publicação nem a conexão
das capacidades remotas ao bootstrap normal do desktop. A importação da LINDB
era evidência local e não demonstrava publicação.

O desktop agora compõe sessão individual, catálogo, atualizações, histórico,
auditoria e publicação. A pesquisa de publicação é exercida no Electron com
Git, publisher e PostgreSQL reais descartáveis e três filtros. Nenhum serviço
foi implantado em produção neste trabalho.

## Contratos preservados e correções permanentes

- Tokens permanecem voláteis no main; o servidor deriva o ator da autenticação
  e revalida o perfil ativo. Administrador Técnico não recebe autoridade de
  publicação. DTOs e IPC continuam fechados, limitados e validados em runtime.
- O gateway usa conexões separadas de menor privilégio. O publisher conserva
  a autoridade exclusiva de promoção por SHA e sincronização transacional.
  Suas leituras passam por RPCs fechadas compatíveis com `lex_publisher`.
- A publicação usa worktree isolada, snapshots íntegros e rascunho durável.
  Confirmação, retry e recuperação preservam bytes, digest, identidade e ator.
  Aprovar uma atualização prepara a confirmação; publicar exige ação humana
  separada. Nenhuma lei é provisionada implicitamente pelo desktop.
- A candidata legislativa e seus snapshots são persistidos de forma privada
  e imutável antes do enqueue. A aprovação verifica artefato, lei, baseline,
  fontes, digest e ator, sem permitir a antiga aprovação sem essa vinculação.
- Solicitações de reprocessamento têm `requestId` próprio, propagado por
  claim, materialização e terminal. Retry é idempotente por solicitação;
  completion obsoleto falha e novas solicitações conservam seus resultados.
  O worker continua sem publicar ou executar dentro do Electron.
- Rollback valida a versão histórica autoritativa no SQL e no Git, conserva
  snapshots originais e redirects permanentes e cria uma release para frente.
  Conteúdo histórico adulterado ou identidade indevida são recusados.
- O pai Git canônico global e a última publicação SQL de uma lei são bases
  distintas. A sequência A → B → A verifica ambas as bases contra alterações
  concorrentes. Aliases equivalentes não divergem por ordenação nem são
  reemitidos.

## Evidência de validação

- `npm run test:unit`: 766 testes, 80 arquivos, sem falhas. Inclui ambos os
  planos e perfis nas Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003,
  recuperação, concorrência, troca de ator e integridade de artefatos.
- `npm run test:publication-db`: migrations completas em PostgreSQL
  descartável, incluindo upgrade, solicitações sucessivas, stale completion,
  candidata imutável, RPCs de leitura e negação por role sem autoridade.
- `npm run test:e2e:only`: 19 testes passaram; corte Electron com pesquisa de publicação real,
  incidente/evidência/reprocessamento por teclado, publicação de várias leis e
  rollback autoritativo, incluindo rejeição de adulteração.
- `npm run lint`, `npm run typecheck`, `npm run format:check` e
  `npm run test:boundaries`; `npm run check:data-model`: 26 interfaces,
  nenhuma divergência.
- Builds de gateway, publisher e reprocessamento; `npm run build:unpacked`.
  `node scripts/inspect-bundle.mjs release/linux-unpacked`: 2.276 entradas,
  fuses verificados e nenhuma violação. Varredura dos artefatos textuais e logs
  gerados sem conteúdo sensível detectado.
- Atualização estrutural do grafo por `graphify update .`, sem API de LLM.

## Implantação e limites

Aplique as migrations em ordem, incluindo `20261008120000`,
`20261008130000`, `20261008140000` e `20261008150000`. Antes da migration de
solicitações, pause novos claims e aguarde a conclusão dos workers antigos;
só depois migre e reinicie a versão atualizada. Claims antigos não carregam
`requestId` e os overloads antigos de conclusão deixam de ser autorizados.
Este trabalho não introduz lease ou recuperação de worker interrompido.

Provisionamento de logins restritos, TLS, hospedagem dos serviços, configuração
da estação, assinatura e distribuição do aplicativo permanecem operações do
ambiente. A validação local não comprova implantação. Consulte
[configuração do gateway](../../../services/desktop-gateway/README.md).
O smoke automatizado usa o app compilado; a inspeção do pacote verifica os
fuses, sem habilitar debugging no binário distribuído. O limite histórico da
integridade ASAR no Linux permanece documentado na Feature 001.
