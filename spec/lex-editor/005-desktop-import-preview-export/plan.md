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
  contraparte de nome `compilado`: quando disponível ela é
  `primary_current`; a anotada é `historical_auxiliary`. Somente 404/410 da
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
