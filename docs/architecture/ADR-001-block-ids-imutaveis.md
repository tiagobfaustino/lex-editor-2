# ADR-001: Block IDs semânticos e imutáveis baseados na posição jurídica

## Status

Aceito — revisado em 2026-07-30

## Contexto

Cada dispositivo normativo (artigo, parágrafo, inciso, alínea, item) do
acervo Vinculex precisa de um identificador estável, capaz de:

- servir como âncora de link no Obsidian (`^block-id`), permitindo que
  notas de estudo, referências cruzadas entre leis e citações internas
  apontem para um dispositivo específico sem quebrar;
- sobreviver a atualizações de texto do dispositivo, já que o worker de
  atualização legislativa (`UPDATE_PIPELINE.md`) precisa reconhecer "este
  é o mesmo dispositivo, só que com redação alterada" e não tratar toda
  alteração de texto como um dispositivo novo;
- sobreviver à inserção de novos dispositivos em posições intermediárias
  (ex.: inserção de um novo inciso entre o III e o IV existentes) sem
  invalidar os IDs dos dispositivos vizinhos que não mudaram de conteúdo;
- ser legível e auditável por um ser humano durante revisão, debug de
  parser e leitura direta do Markdown/frontmatter, sem depender de uma
  tabela de lookup externa para entender a que dispositivo um ID se
  refere;
- ser determinístico na atribuição inicial: antes da primeira publicação,
  a mesma estrutura normativa deve produzir os mesmos candidatos a ID;
- ser reconstruível depois da publicação a partir dos artefatos canônicos
  versionados (Git + registro de Block IDs), sem depender de memória local
  ou de heurísticas que possam renomear IDs já expostos.

Esses requisitos colidem diretamente com o comportamento mais comum de
IDs em sistemas de conteúdo (UUID gerado na criação do registro, ou chave
sequencial de banco de dados), que priorizam unicidade e simplicidade de
geração em detrimento de legibilidade e estabilidade semântica.

## Decisão

O Vinculex usa **Block IDs semânticos**, derivados inicialmente da posição
jurídica do dispositivo dentro da hierarquia normativa (capítulo, artigo,
parágrafo, inciso, alínea, item), no formato canônico ilustrado por
`cp-art-121-par-2-inc-viii`. O caractere `^` não faz parte do valor
persistido: ele é acrescentado apenas pelo Formatter ao materializar a
âncora Obsidian `^cp-art-121-par-2-inc-viii`. A geração e a gramática
completa do formato são especificadas em `BLOCK_ID_SPEC.md`.

Antes da primeira publicação, a geração é determinística e não depende de
estado persistido. No primeiro publish, cada ID é registrado junto da versão
em que foi emitido. A partir desse momento, o registro publicado passa a ser
a autoridade: reprocessamentos e atualizações reconciliam a NormaAST candidata
com a última NormaAST publicada e **reutilizam** os IDs registrados, em vez de
recalculá-los cegamente a partir da árvore atual.

Esse ID é **imutável em relação ao conteúdo do dispositivo**: uma alteração
de redação do artigo 121, § 2º, inciso VIII não gera um novo ID — o
dispositivo alterado continua sendo `cp-art-121-par-2-inc-viii`, apenas
com texto atualizado e histórico de versões no `UPDATE.md`. O ID muda
apenas quando a **posição jurídica** do dispositivo muda de forma que a
identidade jurídica é outra (por exemplo, um artigo inteiramente novo
inserido por lei posterior recebe um ID novo consistente com sua própria
posição).

Dispositivos revogados preservam o Block ID original permanentemente — o
ID nunca é reciclado nem removido, mesmo que o dispositivo deixe de ter
efeito jurídico vigente (a revogação é sinalizada por metadado/callout, não
pela remoção ou alteração do ID).

Colisões seguem duas regras distintas:

- na primeira publicação, se dois dispositivos novos produzirem o mesmo
  candidato, ambos recebem a menor qualificação estrutural suficiente;
- depois da primeira publicação, um ID já emitido nunca é renomeado para
  acomodar um novo dispositivo. Apenas o dispositivo novo recebe a menor
  qualificação estrutural que o torne único diante de todo o registro
  histórico da lei.

Correções excepcionais de um ID já publicado não apagam o valor antigo. O
novo ID é emitido, e um alias/redirecionamento permanente
`id_antigo -> id_novo` é registrado e versionado para preservar links,
favoritos e notas existentes.

## Consequências

**Positivas**

- Links `^block-id` no Obsidian permanecem válidos através de
  atualizações de texto, que são o caso mais comum de mudança em
  legislação vigente (alteração de redação por lei posterior).
- Depois da reconciliação com a versão publicada, o diff estrutural consegue
  distinguir "mesmo dispositivo, texto mudou" de "dispositivo novo". Casos
  ambíguos de renumeração são submetidos à confirmação editorial, nunca
  resolvidos silenciosamente apenas por similaridade textual.
- IDs são legíveis por humanos durante revisão e debug, sem exigir
  consulta a uma tabela de mapeamento externa.
- A atribuição inicial é determinística; depois da publicação, a combinação
  do Git com o registro versionado permite reconstruir a identidade dos
  dispositivos sem depender do estado de uma estação do Lex Editor.
- Colisões introduzidas por alterações futuras não quebram links antigos:
  o namespace histórico é append-only.

**Negativas / trade-offs aceitos**

- A geração de IDs é mais complexa do que emitir um UUID ou um contador:
  exige que o parser resolva corretamente toda a hierarquia (capítulo →
  artigo → parágrafo → inciso → alínea → item) antes de atribuir um ID.
- Atualizações exigem acesso à última versão canônica e ao registro histórico
  de IDs. Uma NormaAST atual isolada não contém informação suficiente para
  reconstruir com segurança todas as decisões históricas de identidade.
- Renumeração de dispositivos (ex.: inserção de um novo inciso que desloca
  a numeração romana dos incisos seguintes) é um caso que precisa de
  tratamento explícito no worker/pipeline de atualização, para não confundir
  "dispositivo deslocado" com "dispositivo revogado + dispositivo novo"
  (ver `UPDATE_PIPELINE.md`, seção 4).
- O formato do ID acopla-se à gramática hierárquica da legislação
  brasileira; suportar hierarquias atípicas (ex.: emendas constitucionais
  com numeração especial) exige extensão cuidadosa da especificação em
  `BLOCK_ID_SPEC.md`.

## Alternativas consideradas

### UUID por dispositivo

Gerar um UUID v4 na criação de cada dispositivo.

Rejeitado porque:

- não é legível nem auditável por humanos durante revisão de diff ou
  leitura direta do Markdown/frontmatter;
- não carrega informação de posição jurídica, exigindo uma tabela de
  lookup externa só para saber a que dispositivo um ID se refere;
- não é determinístico a partir do conteúdo/estrutura — reprocessar a
  mesma lei do zero geraria UUIDs diferentes, dificultando comparação e
  testes de regressão do parser;
- não produz um identificador semântico útil como âncora humana.

### ID incremental global (contador sequencial)

Atribuir um número sequencial crescente a cada dispositivo, na ordem em
que é descoberto pelo parser.

Rejeitado porque:

- não sobrevive a reordenação: a inserção de um novo dispositivo no meio
  da hierarquia deslocaria a numeração de tudo que vem depois, ou exigiria
  numeração fora de ordem que perde qualquer relação com a posição
  jurídica;
- não tem significado legível fora do contexto do banco/sistema que
  gerou o contador;
- não é determinístico entre reprocessamentos independentes da mesma lei.

### Hash do conteúdo do dispositivo como ID

Calcular um hash (ex.: SHA-256) do texto do dispositivo e usá-lo como
identificador.

Rejeitado porque:

- quebra exatamente no caso de uso mais importante do sistema: alteração
  de redação de um dispositivo por lei posterior é o evento mais comum no
  ciclo de vida de uma norma, e um hash de conteúdo muda toda vez que o
  texto muda, invalidando todos os links `^block-id` existentes a cada
  atualização;
- tornaria o worker de atualização incapaz de distinguir "mesmo
  dispositivo com texto novo" de "dispositivo novo", forçando a marcar
  toda alteração de texto como um dispositivo revogado + um dispositivo
  novo, o que é juridicamente incorreto e operacionalmente inviável.
