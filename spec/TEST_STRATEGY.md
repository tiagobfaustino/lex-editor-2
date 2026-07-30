# Estratégia de Testes por Risco

O objetivo é evitar tanto regressões silenciosas quanto testes sem valor. A
unidade de decisão é o risco da mudança.

## Classificação

| Nível | Consequência de uma falha | Validação mínima |
|---|---|---|
| Crítico | Publica texto jurídico incorreto, corrompe identidade, contorna autorização ou perde histórico | Testes unitários/integrados obrigatórios, caso negativo e evidência ponta a ponta quando aplicável |
| Alto | Perde dados, duplica publicação, quebra recuperação ou atravessa fronteira de segurança | Teste automatizado obrigatório da regra e da falha |
| Médio | Interrompe fluxo operacional de forma visível e reversível | Unitário ou integração seletiva; E2E se atravessar componentes |
| Baixo | Defeito visual ou interação facilmente reversível | Validação manual direcionada ou regressão visual seletiva |
| Trivial | Código declarativo ou delegação sem lógica própria | Sem teste específico; coberto por typecheck/lint ou teste consumidor |

## Sempre automatizar

- parsing e hierarquia jurídica;
- fases e invariantes da NormaAST;
- geração, reconciliação, aliases e imutabilidade de Block IDs;
- Markdown canônico, histórico de redações e round-trip;
- validações que bloqueiam exportação/publicação;
- manifesto, SemVer, idempotência, concorrência e rollback;
- recuperação após falha parcial;
- IPC, CSP, sanitização, SSRF, traversal, symlink e argumentos Git;
- grants/RLS e negação de escrita por identidades sem autoridade;
- qualquer regra que possa produzir sucesso falso.

## Normalmente não testar isoladamente

- texto estático de botão;
- cor ou espaçamento sem significado funcional;
- wrapper sem transformação ou decisão;
- getter trivial;
- comportamento interno já garantido pela biblioteca externa.

Isso não elimina teste de acessibilidade, foco, teclado ou estado visual quando
esses comportamentos fizerem parte do critério de aceite.

## Pirâmide prática

1. Testes puros e rápidos para domínio, parser, IDs, Formatter e validadores.
2. Integração para filesystem, Git, banco, IPC e serviços.
3. Poucos E2E cobrindo cortes reais:
   - abrir o aplicativo;
   - importar → processar → visualizar → exportar;
   - corrigir → revalidar → aprovar;
   - candidate → publicação server-side → confirmação;
   - pendência legislativa → decisão humana → publicação.

## Regra de mudança

Pergunte, na ordem:

1. Pode alterar silenciosamente conteúdo jurídico ou identidade?
2. Pode conceder autoridade, publicar ou expor dado indevidamente?
3. Pode perder/duplicar dados ou impedir recuperação?
4. Cruza mais de um processo ou serviço?
5. É apenas apresentação reversível?

As três primeiras respostas positivas tornam o teste automatizado obrigatório.
A quarta normalmente exige integração. Somente a quinta pode ficar em
validação manual.

## Evidência

O `review.md`, quando necessário, registra comandos executados, fixtures
relevantes e limitações conhecidas. Não se copiam logs extensos para a spec.
