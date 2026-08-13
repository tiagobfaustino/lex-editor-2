# Plano de Implementação — Feature 011

## Abordagem

Separar o problema em dois contratos versionados: o catálogo de provedores
descreve origens compatíveis com adaptadores instalados; o vínculo por lei
seleciona URLs, funções, variantes e frequência. Extrair o comportamento de
ingestão Planalto hoje preso ao processo principal para uma biblioteca Node
compartilhada, mantendo rede e persistência fora do domínio jurídico puro.

As mutações do catálogo passam por uma fronteira server-side autenticada. Uma
revisão só pode ser ativada depois de um dry-run que use exatamente a política
normalizada que será consumida pela importação e pelo worker. Ativação troca um
ponteiro de revisão de forma transacional; não atualiza registros históricos.

## Componentes afetados

- `docs/architecture/DATA_MODEL.md`: contratos normativos das revisões,
  estados, auditoria e vínculos com lei/job/evidência.
- `packages/source-ingestion/`: schemas puros, registro de adaptadores,
  políticas declarativas, seleção determinística e implementação Node
  compartilhada do fetch/adaptador Planalto.
- `src/main/import/`: integração do catálogo com importação por URL e
  persistência da revisão usada.
- `services/update-worker/`: obtenção de vínculos ativos, captura da revisão,
  agendamento e saúde por configuração.
- `services/source-catalog/`: autenticação, autorização administrativa,
  casos de uso de teste/ativação/pausa/restauração e porta de persistência.
- `supabase/migrations/`: revisões imutáveis, ponteiros ativos, saúde e eventos
  append-only, com funções privadas e grants mínimos.
- `src/shared/ipc/`, `src/preload/` e `src/main/ipc/`: capacidades nomeadas e
  DTOs mínimos do catálogo.
- `src/renderer/src/features/sources/`: listagem, formulários, teste, ativação,
  pausa, restauração e estados acessíveis.
- testes de domínio operacional, main, worker, banco e E2E.

## Contratos e fluxo

```text
Administrador autenticado
  → Source Catalog Service
  → cria revisão de Provider + LawSourceBinding
  → valida política declarativa contra AdapterDescriptor instalado
  → dry-run pelo Secure Source Fetcher + adapter
  → grava evidência limitada do teste
  → ativa revisão transacionalmente

Importação por URL
  → resolve ProviderRevision ativa
  → valida URL novamente
  → adapter instalado
  → snapshots + ParsedNormaAST
  → evidência referencia providerRevisionId/bindingRevisionId

Worker
  → busca LawSourceBindingRevision ativa e devida
  → captura revisão + base publicada
  → coleta pelo mesmo adapter
  → diff/pendência da Feature 008
  → atualiza SourceHealth sem mutar a configuração
```

`ProviderRevision` contém nome, formato, `adapterId`/versão de contrato,
origem exata e parâmetros declarativos aceitos pelo descriptor. A revisão de
`LawSourceBinding` contém lei, artefatos com `sourceRole`/`sourceVariant`,
intervalo e referência à revisão do provedor. Estados de ativação e saúde são
contratos distintos e não usam um campo genérico `status`.

## Decisões locais

- O registro de adaptadores é construído no build. A UI cria configuração,
  nunca código ou um novo parser.
- Parâmetros de detecção usam um vocabulário fechado por adaptador, com schema
  runtime e limites; regex, seletores DOM e templates livres são rejeitados.
- Host é armazenado em forma ASCII/IDNA normalizada e comparado por igualdade;
  esquema, porta e prefixo de path são explícitos. URL de artefato precisa
  satisfazer tanto a política do provedor quanto a política do adaptador.
- O fetch seguro atual do Planalto é movido sem enfraquecer revalidação de DNS,
  redirects, timeout, tamanho ou tipo de conteúdo. Electron main e worker
  injetam transporte, armazenamento de snapshot e relógio.
- Dry-run persiste digest, revisão, adaptador, resultado por etapa e código de
  erro; não persiste HTML/AST em logs nem cria projeto, pendência ou publicação.
- Alterações criam nova revisão. Pausa e ativação também geram evento e usam
  controle otimista; restauração reaponta para revisão já testada por uma nova
  operação auditada.
- Um job recebe a revisão completa na criação. Mudança de ponteiro ativo não
  altera jobs em andamento.
- Saúde é derivada de verificações e pode aplicar suspensão temporária. Ela
  não transforma a configuração ativa em outra revisão.
- O endpoint administrativo deriva o ator da autenticação e revalida
  `usuarios_perfil.papel = 'administrador'`; `actorUserId` não vem do renderer.
- A listagem pode mostrar URL oficial e códigos de saúde, mas nunca snapshots,
  resoluções DNS, headers ou payloads do parser.

## Erros e recuperação

- Provider sem adapter instalado ou com versão incompatível: revisão pode ser
  lida para auditoria, mas não testada/ativada até atualização compatível.
- URL fora da política: rejeição antes do fetch e evento sem conteúdo sensível.
- Falha transitória no dry-run: revisão permanece inativa; novo teste cria nova
  evidência sem apagar tentativas anteriores.
- Falha depois de ativar: transação preserva o ponteiro anterior; não existe
  estado parcialmente ativo.
- Conflito de edição: retornar revisão atual e exigir recarga, sem last-write-wins.
- Configuração removida durante job: arquivamento bloqueia novos jobs, mas a
  revisão histórica permanece disponível para concluir/auditar o job capturado.
- Parser passa a rejeitar uma revisão antiga: saúde fica degradada e nenhuma
  candidata jurídica é produzida; administrador pode pausar ou ativar revisão
  corrigida.
- Store remoto indisponível: importação por URL e novos jobs falham de forma
  explícita; projetos e conteúdo já importados continuam disponíveis offline.

## Estratégia de validação

- Unitários para schemas, IDNA/URL, políticas, precedência, detecção, estados e
  seleção do adapter.
- Regressão do adaptador Planalto sobre as fixtures já versionadas.
- Testes negativos com transporte injetado para credenciais em URL, host
  semelhante, wildcard, porta, IP privado, DNS rebinding, redirects, timeout,
  MIME e tamanho.
- Integração server-side/Postgres para autenticação, papel administrador,
  revisão imutável, ativação única, concorrência, auditoria e grants do worker.
- Contrato cruzado provando que main e worker interpretam os mesmos bytes da
  configuração e registram a mesma revisão.
- E2E com servidor local controlado e resolvedor/transporte de teste, sem
  relaxar a política de produção ou depender de internet no CI.
- E2E de teclado e estados de erro na tela de configuração.
- `lint`, `typecheck`, testes relacionados, suíte SQL e `graphify update .`.

## Ordem

1. Normatizar dados, autoridade, revisões e auditoria.
2. Criar contratos compartilhados e extrair o adaptador/fetch Planalto.
3. Implementar persistência e serviço administrativo server-side.
4. Integrar a revisão ativa à importação desktop.
5. Integrar vínculos, agendamento e saúde ao worker.
6. Expor IPC/preload e construir a UI administrativa.
7. Executar matriz de segurança, integração, E2E e leis reais.

## Não fazer

- Não avaliar código, regex, selector ou template vindo do catálogo.
- Não aceitar domínio por substring, wildcard amplo ou confiança no DNS do
  teste anterior.
- Não duplicar um fetch simplificado no dry-run, importador ou worker.
- Não armazenar HTML/XML, AST ou headers de autenticação em auditoria.
- Não permitir mutação direta do catálogo por renderer, worker, editor jurídico
  ou cliente SaaS.
- Não migrar automaticamente uma lei publicada para a nova fonte nem produzir
  publicação durante teste/ativação.
- Não incluir RF-23/RF-24 ou implementar LexML neste incremento.

