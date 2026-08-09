# ADR-011 — ADCT, histórico sem nota e decisões editoriais versionadas

**Status:** Aceita  
**Data:** 2026-08-09

## Contexto

A auditoria integral da Constituição e do Código Penal revelou três casos que
os contratos anteriores não representavam sem perda: os artigos do ADCT
colidiam com os artigos do corpo permanente; algumas redações anteriores da
fonte oficial não traziam nota de alteração; e penas cuja ancoragem admite mais
de uma leitura ficavam corretamente em baixa confiança, mas não havia um
artefato versionado para registrar a revisão humana.

## Decisão

1. O ADCT é uma divisão estrutural de topo, `ato_transitorio`, com título
   obrigatório. Seus descendentes recebem sempre o segmento intrínseco `adct`
   logo após a sigla: `cf1988-adct-art-1`. O namespace não depende de colisão.
2. `RedacaoAnterior.nota` passa a ser opcional. Ausência significa apenas que a
   fonte não forneceu a nota; o pipeline não inventa “Redação original”. No
   Markdown, a linha histórica permanece riscada e o trecho em itálico só é
   emitido quando a nota existe.
3. Uma interpretação de baixa confiança só pode avançar depois de uma decisão
   editorial explícita e versionada. A decisão identifica de forma imutável o
   artefato (`sourceArtifactSha256`) e o fragmento (`fragmentSha256`), declara a
   ação e contém justificativa. Sua aplicação acrescenta
   `editorial_override`, mantém a trilha em `editorialNote` e elimina
   `requiresHumanReview`; ela não altera silenciosamente o parser automático.
4. Fonte `primary_current` continua soberana sobre o texto vigente. Fontes
   auxiliares podem enriquecer histórico, estado e rastreabilidade; divergência
   de texto vigente é conflito bloqueante, conforme a ADR-009.

## Consequências

- ADCT deixa de ser tratado como anexo ou como artigos de topo.
- O histórico preserva fielmente lacunas da fonte.
- Revisões humanas são reproduzíveis e auditáveis no repositório.
- Decisões obsoletas ou que não correspondam exatamente a um fragmento são
  recusadas, em vez de aplicadas por aproximação.

