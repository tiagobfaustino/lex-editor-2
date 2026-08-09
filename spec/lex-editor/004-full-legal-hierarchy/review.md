# Revisão de Encerramento — Feature 004

A feature 004 foi concluída em 2026-08-09. As dez tarefas e os seis critérios
de aceite estão atendidos; o índice de features registra o estado `done`.

## Resultado

O pipeline processa integralmente as três normas de referência a partir de
snapshots oficiais versionados:

| Norma | Artigos | Dispositivos | Block IDs |
|---|---:|---:|---:|
| LINDB | 30 | 89 | 89 |
| Código Penal | 434 | 1.769 | 1.684 |
| Constituição Federal e ADCT | 411 | 3.428 | 3.328 |

As projeções extraídas dos snapshots reproduzem `entrada.txt` byte a byte, e
os resultados da CLI reproduzem os goldens. As 84 penas de ancoragem ambígua
do CP permanecem bloqueantes sem decisão; a fixture integral fornece decisões
editoriais versionadas e vinculadas aos hashes do artefato e de cada fragmento.

## Contratos fechados

- A ADR-010 admite alínea diretamente sob artigo ou parágrafo, sem inventar
  ancestral no Block ID.
- A ADR-011 define ADCT como divisão estrutural com namespace próprio, histórico
  sem nota inventada e decisões editoriais rastreáveis.
- A fonte `primary_current` é soberana; fontes auxiliares enriquecem histórico
  e rastreabilidade, e divergências bloqueiam.
- Reconciliação preserva IDs após mudança textual, cria aliases para
  renumeração, não recicla identificadores e bloqueia colisão ambígua.
- A projeção AST ↔ Postgres mantém a semântica e alcança ponto fixo.
- O Formatter usa a profundidade real da AST, inclusive nos níveis jurídicos
  omitidos pela fonte, e aplica as validações canônicas antes da publicação.

## Evidência nas leis reais

A execução integral levou a correções gerais, sem exceções por nome de lei:
decodificação UTF-8/Windows-1252 estrita, separação de dispositivos
concatenados somente após parentético editorial confirmado, distinção entre
rubrica e ementa por contexto, preservação de redações riscadas, cabeçalho e
namespace do ADCT, e remoção conservadora do rodapé de assinaturas da CF/88.

Os snapshots completos, projeções e goldens de LINDB, CP e CF/88 estão
versionados. Casos mínimos continuam cobrindo cada ramificação da matriz para
que uma falha em arquivo grande tenha diagnóstico localizado.

## Validação no Obsidian

Os quatro goldens foram regenerados em vault temporário e comparados byte a
byte. No Obsidian Desktop 1.13.4 foram conferidos propriedades, callouts,
listas recolhíveis e navegação por Block ID nas três leis, incluindo:

- inciso revogado e alíneas do art. 121 do CP;
- transição limpa do art. 250 da CF/88 para o ADCT;
- alíneas diretamente sob o art. 15 da LINDB, cada uma indexada e navegável.

Essa inspeção revelou a indentação semântica fixa das alíneas da LINDB: seis
espaços representavam ancestrais inexistentes e faziam o Obsidian indexar só o
último item da sequência. A correção usa a hierarquia efetiva da AST e tem
teste de regressão.

## Verificações de encerramento

- `npm test`: 219 testes, 15 arquivos;
- `npm run typecheck`;
- `npm run lint`;
- `npm run format:check`;
- `npm run check:data-model`;
- `npm run test:boundaries`;
- `npm run build:workspaces`;
- `git diff --check`;
- `npm run test:vault -- <vault-temporario>`: quatro fixtures idênticas aos
  goldens.

A matriz detalhada e a rastreabilidade por regra permanecem em `COBERTURA.md`.
