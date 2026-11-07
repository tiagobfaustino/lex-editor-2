# Plano de Implementação — Feature 005

## Abordagem

Main executa toda I/O e o pipeline; renderer mantém apenas intenção e projeção
visual. Preview deriva de DTO próprio produzido da AST, nunca de HTML bruto.

## Componentes afetados

- `src/main/import/`: arquivo, URL, snapshot e pipeline.
- `src/main/export/`: escrita atômica.
- `src/shared/ipc/import.ts`: comandos e eventos limitados.
- `src/renderer/features/importacao/`
- `src/renderer/features/preview/`
- `src/renderer/features/validacao/`

## Contratos e fluxo

Renderer solicita seleção/download; main valida e processa; eventos de
progresso carregam somente IDs/códigos; resultado oferece metadados, árvore
sanitizada e diagnósticos paginados. Exportação referencia um projeto interno,
não envia conteúdo/path arbitrário.

## Decisões locais

- Allowlist inicial exata de `planalto.gov.br` e `www.planalto.gov.br`, com
  portas padrão de HTTP(S), até 5 redirects, 15 segundos e 20 MiB por
  artefato. Todos os endereços resolvidos precisam ser públicos e o transporte
  conecta usando somente o IP já validado.
- Uma URL inicial pode resolver páginas relacionadas, cada uma novamente
  submetida aos controles de rede e preservada como snapshot próprio.
- Para as variantes conhecidas da ADR-009, o adaptador deriva no máximo a
  contraparte de nome `compilado`. A URL informada é `primary_current`; a
  contraparte anotada é `historical_auxiliary`, e a compilada complementar
  é `cross_check`. Somente 404/410 da
  contraparte opcional é tratado como ausência.
- Revalidação de DNS e destino a cada redirect.
- Renderização virtualizada para lei extensa.
- Contratos paginados usam no máximo 50 nós de preview ou 100 diagnósticos por
  página. Cada chamada tem limites de bytes próprios além dos limites de
  cardinalidade e tamanho de string validados pelo schema.
- IDs de fonte, trabalho, projeto, destino e nós de preview são UUIDs opacos.
  Cursores são tokens opacos limitados; nenhum deles codifica path para uso do
  renderer.

## Dependências adicionadas

- `defuddle@0.19.2`: produz no main as projeções HTML e Markdown limpas exigidas
  pelo fluxo, sempre a partir do snapshot e com seus extratores assíncronos e
  qualquer `fetch` interno desabilitados. A alternativa de manter um limpador
  próprio foi rejeitada porque duplicaria uma etapa explicitamente requerida e
  ampliaria a superfície de sanitização mantida pelo projeto.
- `linkedom@0.18.13`: implementação DOM usada pelo entrypoint Node do Defuddle.
  A alternativa JSDOM tem superfície e custo maiores para esta extração sem
  execução de scripts.

## Erros e recuperação

- Timeout, limite, HTTP, certificado, fonte não reconhecida e parsing têm
  códigos distintos.
- Cancelamento aborta trabalho e mantém último projeto válido.
- Exportação usa temp + rename.

## Estratégia de validação

- Testes de URL/SSRF/redirect, sanitização e IPC.
- Integração arquivo/URL equivalente.
- E2E de importação, preview, diagnóstico e exportação.
- Perfil manual de uma lei grande.

## Ordem

1. DTOs e capacidades.
2. arquivo local.
3. preview e diagnósticos.
4. exportação.
5. URL segura/Defuddle.
6. performance e E2E.

## Não fazer

- Não disponibilizar fetch ou readFile genérico ao renderer.
- Não parsear Markdown renderizado para reconstruir domínio.

## Correção da importação do Código Penal — 2026-10-08

O snapshot preservado na estação reproduz a falha: a página anotada fecha
`body`/`html` após o preâmbulo, deixando os dispositivos fora do corpo que o
Defuddle processa. A padronização do Defuddle também funde blocos da versão
compilada, removendo fronteiras que o extrator jurídico utiliza.

Corrigir no wrapper compartilhado `defuddleSnapshot`: deslocar fechamentos
externos para o fim da cópia de extração e desativar `standardize`. Continuar
produzindo HTML/Markdown limpos sem scripts nem rede, sem mudar snapshots,
autoridade da fonte compilada. Não adicionar dependências.

A investigação também exige corrigir metadados com `N<sup>o</sup>`, sufixos
jurídicos confundidos com palavras após o hífen, ordinais canônicos após
sufixos, divisões com sufixo e notas anteriores à ementa. O extrator preserva
ementas em múltiplas linhas e reconhece negrito/tachado CSS. Uma rubrica sem
ênfase só é descartada quando há correspondência textual exata com rubrica
explícita em outra fonte do conjunto.

A mesclagem não sobrescreve divisões de número repetido. Correspondência
única usa texto ou artigos contidos; ambiguidade continua diagnosticada.
No desktop, conflitos produzem candidata revisável com
`source_text_conflict`, baixa confiança e nota com os dois textos. Histórico
conflitante não é mesclado, mas o snapshot auxiliar é preservado. O fluxo
editorial existente exige confirmação com justificativa e bloqueia aprovação,
exportação e publicação enquanto há pendências. CLI e worker continuam
bloqueando conflitos por padrão. O modelo normativo documenta esse novo motivo
sem alterar a precedência da ADR-009 ou os perfis da ADR-012.

Fixtures derivadas são regeneradas contra os snapshots oficiais intactos.
As 84 decisões de ancoragem do CP só recebem o novo hash da entrada após
verificar que posição e hash de cada fragmento revisado permanecem iguais.
Não há migração automática de identificadores ou aprovações existentes.

Validar regressão reduzida de HTML malformado e preservação de blocos, além
da importação real compilada/anotada pelo serviço desktop e pelo adaptador
compartilhado. Confirmar dados normativos no preview, integridade dos bytes,
falha de página sem norma e a suíte jurídica existente; executar lint,
typecheck, formatação, build e atualização estrutural do Graphify.

## Autoridade da URL informada — 2026-10-08

Na importação manual, atribuir `primary_current` ao artefato solicitado pelo
usuário, considerando redirecionamentos seguros. A contraparte anotada usa
`historical_auxiliary`; a compilada complementar usa `cross_check`. Com
catálogo ativo, coletar somente URLs autorizadas pelo binding, mas registrar
a seleção manual nos papéis dos snapshots. Recusar URL sem correspondência
única no conjunto antes de rede. O worker sem seleção manual continua usando
os papéis da revisão configurada. Não reescrever projetos ou bindings antigos.
Atualizar ADR-009/ADR-012 para refletir essa decisão explícita do usuário.
Provar com textos divergentes que preview e metadados seguem a URL informada,
com e sem catálogo; manter snapshots e revisão de conflitos.


O snapshot anotado real do CP mantém o marcador `§ 2º - (VETADO).`
antes da redação posterior da mesma posição no art. 141, sem riscado.
O parser preserva esse marcador no histórico e sua referência de suporte
somente como candidata de baixa confiança: exige revisão humana, não gera
segundo Block ID e não resolve automaticamente outras duplicidades.
