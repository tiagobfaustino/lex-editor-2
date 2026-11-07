# Revisão de Encerramento — Feature 005

A Feature 005 foi concluída em 2026-08-09. As dez tarefas e os cinco critérios
de aceite estão atendidos; o índice de features registra o estado `done`.

## Resultado

O aplicativo Electron importa snapshots HTML ou Markdown e páginas permitidas
do Planalto, processa tudo no `main`, apresenta uma projeção textual paginada e
exporta atomicamente os bytes do Formatter. O renderer recebe somente DTOs
limitados e IDs opacos; paths, HTML bruto, AST, rede e filesystem permanecem
fora da ponte.

O fluxo visual cobre progresso e cancelamento, metadados, callouts, hierarquia,
históricos, Block IDs e diagnósticos clicáveis. Uma tentativa posterior que
falhe ou seja cancelada não remove o último documento exportável.

## Fronteiras e controles

- A seleção e o destino usam diálogos nativos; nenhum path arbitrário atravessa
  IPC.
- Cada canal valida remetente, frame principal, origem, schema fechado, bytes,
  autorização e DTO de saída antes de executar ou devolver efeitos.
- Rede aceita somente `planalto.gov.br` e `www.planalto.gov.br`, portas padrão,
  até cinco redirects, 15 segundos e 20 MiB por artefato. DNS e destino são
  revalidados em cada salto, e o transporte usa o IP público já aprovado.
- Defuddle e LinkeDOM operam no `main` sobre snapshots, com fetch interno
  negado. Scripts, handlers HTML e o documento bruto nunca são renderizados.
- Preview e diagnósticos são paginados. A árvore usa
  `content-visibility: auto`, e atualizações grandes entram em uma transição do
  React somente quando documento, primeira página e diagnósticos estão prontos.
- Exportação grava arquivo temporário com permissão restrita, sincroniza e
  renomeia; o teste confere tamanho e SHA-256 dos bytes escritos.

## Evidência integrada

O E2E de produção percorre dois cenários no Electron real:

1. importa HTML com `script` e `onerror` injetados, comprova que não houve
   execução nem segundo diálogo privilegiado, importa a LINDB canônica, navega
   pelo diagnóstico, bloqueia host fora da allowlist sem perder o preview e
   exporta Markdown;
2. importa a CF/88 completa, com 411 artigos e 3.428 nós, confere o limite de 25
   nós por página, expansão incremental, `content-visibility` e disponibilidade
   do próximo frame em menos de um segundo.

Na execução de encerramento, os dois cenários levaram 1,2 s e 543 ms,
respectivamente. Esses tempos são evidência local, não um benchmark estável; o
contrato automatizado conserva orçamento de 30 s para o primeiro preview da lei
extensa. A inspeção visual em 1280×800 confirmou metadados legíveis, progresso,
diagnóstico e primeiro dispositivo navegáveis sem materializar toda a árvore.

## Verificações de encerramento

- `npm test`: 262 testes, 20 arquivos;
- `npm run typecheck`;
- `npm run lint`;
- `npm run format:check`;
- `npm run test:boundaries`;
- `npm audit --omit=dev`: zero vulnerabilidades de runtime;
- `npm run build:app`;
- `npm run test:e2e:only`: 10 testes no bundle de produção;
- `git diff --check`.

## Limites conhecidos

O E2E não depende da disponibilidade externa do Planalto: paridade entre URL e
arquivo usa transporte injetado e os mesmos snapshots versionados, enquanto os
controles de rede são cobertos por testes de DNS, IP privado, redirects, tipo,
tamanho e timeout. O audit completo ainda aponta o alerta preexistente de
`nanoid` na cadeia de ferramentas Vite/PostCSS; a árvore de dependências de
runtime usada pelo aplicativo está limpa.

## Correção de importação por URL — 2026-10-08

O erro “fonte não reconhecível” reproduziu com os snapshots reais do Código
Penal: a página anotada fecha `body`/`html` antes dos dispositivos. A cópia de
extração recupera o conteúdo sem modificar os artefatos brutos. Desativar a
padronização do Defuddle preserva fronteiras jurídicas. O extrator agora lê
negrito e tachado CSS, preserva ementas com quebras e confirma rubricas sem
ênfase somente por igualdade textual com rubrica explícita no conjunto.
Metadados e designadores foram corrigidos sem migrar IDs publicados.

A importação desktop do par de 683.487/940.291 bytes conclui, mantém ambos os
snapshots byte a byte e, na primeira correção, conservava a compilada como
fonte atual. A regra foi substituída pela seleção manual descrita abaixo. Histórico
compatível entra na árvore; conflitos e divisões sem correspondência única
recebem baixa confiança, nota com as duas leituras e referências de evidência.
O fluxo editorial existente permite confirmação justificada e auditada, mas
bloqueia aprovação/exportação/publicação antes da revisão. CLI e worker seguem
estritos por padrão. Não há descarte silencioso de conflitos nem aprovação
jurídica automática. Parte das diferenças é tipográfica; não foi implementada
normalização agressiva de palavras, números ou pontuação para ocultá-las.

O teste integrado confirma histórico do art. 218-A, redação atual, DTO fechado,
bloqueio da aprovação, confirmação editorial e integridade das duas fontes.
Os testes da mesclagem também cobrem divisões numeradas repetidas e associação
ambígua. A prova usa transporte injetado com snapshots reais; não afirma
disponibilidade da rede externa do Planalto.

Fixtures de projeção foram corrigidas contra os snapshots oficiais intactos.
As 84 decisões de ancoragem do CP mantêm posição, justificativa e SHA de cada
fragmento; somente o hash da entrada derivada foi atualizado após conferência.
Não se revalidam decisões de projetos de usuário automaticamente.

Validação: 788 unitários em 80 arquivos (`--maxWorkers=4`), 19 E2Es no Electron,
typecheck, lint, format check, build de workspaces/app e auditoria de 26
interfaces do modelo sem divergências. A execução concorrente de todos os
gates teve timeouts por disputa de recursos; a suíte isolada com quatro
workers passou.


## Autoridade da URL na importação manual — 2026-10-08

Por orientação explícita do usuário, a URL informada determina
`primary_current`, seja compilada ou anotada. A contraparte complementa
histórico/comparação e nunca substitui o texto escolhido. Com catálogo ativo,
a URL precisa corresponder a exatamente um artefato autorizado antes de
qualquer acesso à rede; a revisão/digest da configuração permanecem intactos.
As coletas automáticas continuam seguindo os papéis versionados do catálogo.
Falha da URL selecionada não autoriza fallback; ausência 404/410 da contraparte
na descoberta manual continua opcional. Redirect seguro mantém o artefato
solicitado como principal e registra sua URL final.

A matriz de integração usa textos divergentes e os dois snapshots reais do CP.
Confere fonte/metadados, preview, evidência de configuração e integridade dos
bytes. A página anotada mantém dois § 2º do art. 141 sem riscar o primeiro,
que contém apenas `(VETADO)`. O parser preserva esse marcador no histórico com
referência ao fragmento original e baixa confiança; a representação exige
confirmação editorial, sem segundo Block ID. Outras duplicidades e vetos com
conteúdo subordinado não recebem esse tratamento. CLI/worker seguem bloqueando
baixa confiança por padrão; decisões e projetos existentes não são migrados.

Validação final: 801 testes unitários em 80 arquivos, 14 E2Es de
importação/smoke no bundle atualizado, typecheck, lint, format check, builds de
workspaces/app e `git diff --check`. A regressão mínima demonstrou falha antes
da correção e passou após ela. Graphify atualizado por extração AST.
