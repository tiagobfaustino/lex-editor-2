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

- Allowlist inicial de hosts oficiais do Planalto.
- Revalidação de DNS e destino a cada redirect.
- Renderização virtualizada para lei extensa.

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
