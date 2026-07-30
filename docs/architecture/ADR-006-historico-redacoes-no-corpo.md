# ADR-006: Histórico de redações e revogações materializado no corpo

## Status

Aceito (2026-07-06). Proposto em 2026-07-04; ratificado pela equipe em 2026-07-06.

Supera parcialmente `ADR-001` / `BLOCK_ID_SPEC.md` §5.1 (que determinava que
apenas a redação vigente permanece no corpo) e estende o modelo de
`DATA_MODEL.md` (que registrava alteração apenas via metadado
`redacao_dada_por`). As demais decisões desses documentos permanecem em vigor.

## Contexto

As fontes oficiais (Planalto) exibem o histórico de um dispositivo com o texto
superado **riscado** logo acima da redação vigente. Um mesmo dispositivo pode
acumular várias redações antigas riscadas — cada uma com sua nota
`(Redação dada pela Lei/MP ...)` — seguidas da redação em vigor. Exemplos reais
na Lei nº 10.826/2003 (Art. 5º; § 3º com quatro redações sucessivas) e no
próprio Código Penal (Art. 61, II, alínea `h`: redação de 1996 riscada,
substituída pela de 2003).

O contrato anterior mandava manter no corpo apenas a redação vigente e registrar
a lei alteradora em `redacao_dada_por` (metadado, sem materializar o texto
antigo). A equipe editorial decidiu que o valor de estudo exige **preservar o
histórico visível** — o leitor precisa ver o que o dispositivo dizia antes,
riscado, sem perder a leitura da redação atual.

Isso se soma à regra já vigente para **revogação** (ADR-005 / `MARKDOWN_SPEC.md`
§5): o dispositivo revogado não é excluído; seu texto permanece riscado com a
nota `(Revogado pela Lei ...)`.

## Decisão

1. **Dispositivos alterados preservam o histórico no corpo.** Cada redação
   anterior de um dispositivo é materializada como uma linha riscada
   (`~~...~~`), na mesma indentação do dispositivo, imediatamente **acima** da
   redação vigente, na ordem cronológica (mais antiga → mais nova → vigente).
2. **Somente a redação vigente recebe Block ID.** As linhas de histórico
   (redações anteriores) e as linhas de dispositivos totalmente revogados sem
   redação substituta **não** recebem Block ID. O Block ID posicional pertence
   exclusivamente ao dispositivo em vigor (ou, no caso de revogação sem
   substituição, ao próprio dispositivo revogado, que continua sendo o nó atual
   daquela posição). Isso preserva a estabilidade de links: o histórico é
   apresentação, não uma posição referenciável independente.
3. **A nota em itálico distingue o estado:**
   - `*(Redação dada pela Lei nº X, de Y)*` → **alteração**; o dispositivo está
     **vigente** com a redação atual (não riscada). As linhas riscadas são
     redações anteriores.
   - `*(Revogado pela Lei nº X, de Y)*` → **revogação**; o dispositivo está
     revogado e seu texto permanece riscado (ADR-005, `preservarTextoRevogado`).
4. **Representação na NormaAST.** Cada nó de dispositivo ganha um campo opcional
   `redacoesAnteriores: { texto, nota }[]` (ordenado, mais antiga → mais nova),
   onde `texto` é o conteúdo riscado exato (designador + texto antigo, tratado
   como bloco de apresentação) e `nota` é a nota de redação correspondente. O
   `texto`/`caput` do nó continua sendo a redação vigente. O histórico não gera
   nós próprios nem Block IDs.

## Consequências

**Positivas**

- Fidelidade histórica: o acervo preserva o que o dispositivo dizia antes,
  como a fonte oficial exibe, agregando valor de estudo.
- Estabilidade de links mantida: apenas a redação vigente é referenciável; o
  histórico não fragmenta o namespace de Block IDs.
- Reaproveita a mesma sintaxe de riscado já usada para revogação; parser e
  formatter tratam ambos com uma regra única de linha riscada sem Block ID.

**Negativas / trade-offs aceitos**

- O corpo do Markdown fica mais longo (uma linha por redação anterior).
- A validação "todo item de lista tem exatamente um Block ID"
  (`MARKDOWN_SPEC.md` §9.3) passa a ter exceção explícita: linhas de histórico
  não têm Block ID. A contagem de artigos (§9.4) passa a basear-se nos nós
  `artigo` da NormaAST, não em contar itens de lista de nível 0.
- O histórico é modelado como bloco de apresentação opaco (não como subárvore
  navegável); recuperar a estrutura interna de uma redação antiga (ex.: incisos
  antigos individualmente) fica fora deste modelo por ora.

## Alternativas consideradas

### Manter só a redação vigente + `redacao_dada_por` (contrato anterior)

Rejeitado a pedido da equipe editorial: perde a exibição do texto superado, que
é justamente o valor de estudo pretendido.

### Modelar cada redação anterior como subárvore completa de nós

Rejeitado por ora: multiplicaria nós e exigiria decidir identidade/ordem de nós
sem Block ID; o blob de apresentação opaco cobre a necessidade de exibição com
custo muito menor. Pode ser revisto se surgir necessidade de navegar o histórico
estruturalmente.
