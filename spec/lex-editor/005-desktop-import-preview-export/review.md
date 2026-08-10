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
