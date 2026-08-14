# Feature 011 — Configuração e catálogo de fontes oficiais

## Metadados

- `implementation_status`: done
- `priority`: P3
- `owner`: não atribuído

## Objetivo

Permitir que o Administrador Técnico cadastre, teste, ative, pause e versione
fontes oficiais compatíveis com adaptadores já instalados, vinculando a cada
lei seu conjunto de artefatos e sua frequência de monitoramento. A importação
desktop e o worker devem consumir a mesma revisão ativa da configuração, sem
alteração de código para uma nova origem compatível.

## Problema

O fluxo atual conhece o Planalto por constantes e regras de código. Isso
impede administrar uma nova origem compatível pela interface e deixa a
importação manual e o worker sujeitos a configurações divergentes. Aceitar
domínios, seletores ou expressões arbitrárias, por outro lado, transformaria o
catálogo em uma expansão perigosa da superfície de rede e de parsing.

## Escopo

- Catálogo versionado de provedores oficiais, separado dos vínculos de fontes
  de cada lei.
- Registro de origem, formato esperado, adaptador instalado e regras
  declarativas limitadas de detecção.
- Vínculo de uma lei a um conjunto de artefatos com função, variante e URL,
  conforme a ADR-009.
- Frequência de monitoramento, ativação, pausa, arquivamento e restauração de
  revisão anterior já validada.
- Teste seguro de amostra antes da ativação, usando o mesmo fetch, limites,
  detecção e adaptador do fluxo real.
- Estado de saúde operacional separado do estado de ativação da configuração.
- Auditoria append-only de criação, teste, ativação, pausa e restauração.
- Uso da revisão ativa tanto na importação por URL quanto no worker.
- Tela administrativa que substitui o item `Configuração de fontes — Em
  breve`.
- Validação com o adaptador Planalto e com uma nova origem de teste compatível
  com esse adaptador, sem mudança de código após o cadastro.

## Fora do escopo

- Baixar ou executar plugins, JavaScript, WebAssembly ou código fornecido pela
  interface.
- Aceitar regex, seletores DOM, templates de URL ou headers arbitrários.
- Criar um parser genérico para qualquer site ou implementar o parser LexML.
- Cadastrar credenciais, cookies, tokens ou fontes autenticadas.
- Alterar as regras jurídicas de precedência entre fonte compilada, anotada e
  de conferência.
- Publicar automaticamente conteúdo obtido por uma fonte recém-configurada.
- Implementar a pesquisa global de logs do RF-23 ou a edição de frontmatter do
  RF-24.
- Administrar fontes locais ou caminhos do filesystem pelo catálogo remoto.

## Dependências

- Features 005, 008 e 009.
- `../../../docs/architecture/ADR-002-norma-ast.md`
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- `../../../docs/architecture/ADR-009-fontes-compiladas-e-historicas.md`
- `../../../docs/architecture/DATA_MODEL.md`
- `../../../docs/architecture/SYSTEM_ARCHITECTURE.md`
- `../../../docs/architecture/UPDATE_PIPELINE.md`
- `../../../docs/lex-editor/PRD.md`, RF-20 e RNF-03/RNF-11/RNF-12.
- `../../../docs/lex-editor/USER_FLOWS.md`, fluxo 6.

## Requisitos

- RF-011-01: representar separadamente o provedor reutilizável e o vínculo de
  uma lei ao seu conjunto de fontes, ambos com schema runtime e revisões
  imutáveis.
- RF-011-02: permitir apenas adaptadores presentes no registro instalado e
  expor pela UI as capacidades e os parâmetros declarativos aceitos por cada
  um.
- RF-011-03: cadastrar uma origem por esquema, host exato, porta permitida e
  restrição de caminho normalizados, sem curingas amplos nem regras
  executáveis.
- RF-011-04: vincular a lei a exatamente um artefato `primary_current` e a
  artefatos opcionais `historical_auxiliary`/`cross_check`, cada qual com
  variante e URL próprias.
- RF-011-05: executar teste de amostra pelo mesmo adaptador e pela mesma
  política de rede do uso real; falha jamais pode ser registrada como teste
  bem-sucedido.
- RF-011-06: impedir ativação de revisão não testada, obsoleta, incompatível
  com o adaptador ou conflitante com outra revisão ativa do mesmo vínculo.
- RF-011-07: registrar ator, instante, revisão anterior/nova, resultado do
  teste e códigos não sensíveis em auditoria append-only.
- RF-011-08: detectar a revisão ativa durante a importação, selecionar o
  adaptador sem escolha manual no caso inequívoco e persistir a identidade da
  configuração usada junto à evidência da importação.
- RF-011-09: fazer o worker consumir somente vínculos ativos, capturar a revisão
  do vínculo no início do job e manter essa revisão até o término da execução.
- RF-011-10: separar `sourceActivationState` de `sourceHealthState`; falhas
  consecutivas degradam/suspendem temporariamente a execução sem reescrever a
  revisão configurada.
- RF-011-11: oferecer verificação imediata idempotente e frequência dentro de
  limites operacionais definidos, preservando backoff, jitter e deduplicação.
- RF-011-12: autorizar mutações somente para identidade autenticada com papel
  `administrador`, revalidado no servidor; renderer e worker não recebem
  autoridade de administração.
- RF-011-13: expor ao renderer DTOs paginados, limitados e sem HTML, AST,
  snapshots, endereços resolvidos, paths ou dados de autenticação.
- RF-011-14: permitir restaurar uma revisão anteriormente testada como nova
  ativação auditada, sem apagar histórico ou alterar jobs já iniciados.

## Invariantes

- Configuração é dado; adaptador e parser continuam sendo código instalado e
  revisado.
- O catálogo não amplia silenciosamente a política de rede: toda origem ativa
  é exata, versionada, testada e auditada.
- DNS e destino são revalidados em cada requisição e redirecionamento; uma
  revisão testada não ganha confiança permanente no endereço resolvido.
- Há exatamente um `primary_current` por vínculo ativo de lei.
- Função da fonte e variante técnica permanecem conceitos independentes.
- Importação e worker interpretam a mesma revisão de forma determinística.
- Alterar ou restaurar configuração não modifica NormaAST, versão publicada,
  pendência editorial ou conteúdo canônico.
- Nenhuma falha de rede, detecção ou parsing ativa a fonte ou produz sucesso
  falso.
- Worker, renderer e usuário editorial comum não podem mutar o catálogo.
- HTML/XML continua sendo dado não executável e nunca é renderizado diretamente.

## Cenários essenciais

### Nova origem compatível

Dado um domínio oficial de teste cujo HTML é compatível com o adaptador
Planalto instalado, quando o administrador cadastra regras limitadas, executa
uma amostra válida e ativa a revisão, então uma importação posterior detecta o
provedor e produz preview sem qualquer alteração de código.

### Conjunto compilado e anotado

Dada a Lei nº 10.826/2003, quando seu vínculo ativo contém a compilada como
`primary_current` e a anotada como `historical_auxiliary`, então importação e
worker usam o mesmo conjunto e preservam função, variante e proveniência de
cada artefato.

### Configuração hostil

Dada uma tentativa de cadastrar credenciais na URL, host curinga, porta não
permitida, rede privada ou regra executável, quando a configuração é validada
ou testada, então ela é rejeitada antes da ativação com código seguro e sem
requisição a destino proibido.

### Falha e recuperação

Dada uma fonte ativa que acumula falhas, quando o limite operacional é
atingido, então sua saúde fica degradada e o agendamento aplica suspensão
temporária. Ao restaurar uma revisão válida ou obter sucesso posterior, a
recuperação é auditada sem perder o histórico de falhas.

### Concorrência de revisão

Dado um job iniciado com a revisão 3 e a ativação concorrente da revisão 4,
quando o job termina, então sua evidência referencia a revisão 3; somente jobs
seguintes usam a revisão 4.

## Critérios de aceite

- [x] Um administrador cadastra pela UI uma nova origem compatível com o
  adaptador Planalto, testa e ativa sem alteração de código.
- [x] A mesma URL é detectada pelo importador e coletada pelo worker com a
  mesma revisão, adaptador e conjunto de fontes.
- [x] Lei nº 10.826/2003 mantém compilada como primária e anotada como
  histórica; leis nº 9.099/1995 e nº 9.605/1998 funcionam com fonte anotada
  primária quando não houver compilada.
- [x] Revisão não testada ou teste falho não pode ser ativado, inclusive por
  chamada direta à fronteira server-side.
- [x] Ativar, pausar e restaurar são operações concorrentes seguras,
  versionadas e auditadas, sem deleção do histórico.
- [x] Worker ignora vínculos pausados/arquivados e preserva a revisão capturada
  em jobs concorrentes.
- [x] SSRF, redirects proibidos, DNS rebinding, resposta excessiva, tipo de
  conteúdo inválido e regras de detecção abusivas são bloqueados em testes.
- [x] Renderer recebe somente DTOs mínimos e uma identidade sem papel de
  administrador não consegue mutar o catálogo.
- [x] Fluxo de teclado cobre listar, cadastrar, testar, ativar, pausar e
  restaurar, com foco e erros acessíveis.
- [x] Testes offline usam fixtures e transporte injetado; CI não depende de
  fonte oficial real.

## Validação mínima

- Risco: alto para fronteira de rede, persistência e operação; crítico quando
  uma configuração incorreta puder alterar a interpretação da fonte jurídica.
- Testes unitários dos schemas, normalização, detecção e seleção de adaptador.
- Testes negativos obrigatórios de SSRF, redirects, DNS, limites, autorização,
  concorrência e sucesso falso.
- Integração de banco para revisões, ativação única, auditoria, grants e leitura
  pelo worker.
- Integração importador/worker com a mesma configuração e fixtures das três
  leis de referência.
- E2E desktop do fluxo administrativo e da importação pela origem recém-ativa.
- Validação manual dirigida da acessibilidade e dos estados operacionalmente
  relevantes.

## Riscos

- Cadastro virar proxy SSRF: origem exata, política por adaptador, validação de
  DNS/destino a cada salto e limites rígidos.
- Regra declarativa causar custo não limitado: vocabulário fechado, strings
  curtas e ausência de regex/seletores executáveis.
- Importador e worker divergirem: pacote compartilhado, revisão capturada e
  testes de contrato cruzados.
- Mudança de configuração no meio do job misturar evidências: snapshot lógico
  imutável da revisão no início da execução.
- Falha de parser parecer indisponibilidade: saúde por etapa e códigos seguros,
  sem marcar teste ou verificação como sucesso.
- Administrador alterar fonte jurídica sem rastreabilidade: autenticação
  server-side, concorrência otimista e auditoria append-only.
