# ADR-004: Aprovação humana obrigatória em toda publicação

## Status

Aceito

## Contexto

O Vinculex publica conteúdo jurídico consumido por estudantes de
concursos e profissionais que confiam na exatidão do texto normativo
apresentado. Existem dois momentos de publicação no ciclo de vida de uma
lei no sistema:

1. **Publicação inicial**: importação de uma lei nova, do parsing até a
   primeira versão publicada no Git/Supabase.
2. **Publicação de atualização**: quando o worker de atualização
   legislativa detecta uma divergência entre a fonte oficial e a versão
   publicada e gera uma atualização pendente (`UPDATE_PIPELINE.md`).

Em ambos os casos, o conteúdo passa por um pipeline automatizado
(snapshot bruto → Defuddle → Parser → `ParsedNormaAST` → validação →
reconciliação de Block IDs → `IdentifiedNormaAST` → Formatter) que,
por mais robusto que seja, pode produzir erros de interpretação: um
dispositivo mal segmentado, uma ressalva perdida no meio de um parágrafo,
uma confusão entre dispositivo revogado e dispositivo apenas
reordenado, uma falha de parsing silenciosa causada por mudança de leiaute
da fonte oficial. Nenhum desses erros é aceitável em um produto cuja
proposta de valor central é ser a fonte confiável e citável de legislação
estruturada.

Ao mesmo tempo, aprovação humana obrigatória tem um custo real: reduz a
velocidade com que novas leis e atualizações chegam ao acervo, e depende
da disponibilidade de um editor jurídico para revisar cada pendência.

## Decisão

**Nenhum commit chega ao Git (e, por consequência, ao Supabase) sem
revisão humana explícita realizada dentro do Lex Editor**, sem exceção,
tanto para publicação inicial quanto para publicação de atualização.

Isso vale independentemente do tamanho ou aparente trivialidade da
mudança: mesmo uma atualização de aparência simples (por exemplo, uma
correção pontual de digitação identificada pela fonte oficial) passa pelo
mesmo fluxo de revisão e aprovação — não existe caminho de publicação
automática de texto normativo no MVP.

O worker de atualização legislativa está proibido, por regra de negócio e
por design técnico do pipeline, de gravar diretamente no Git ou de marcar
uma pendência como publicada sem uma ação explícita de aprovação
registrada no Lex Editor, associada a um editor jurídico identificado.

Fica registrado como direção futura possível — explicitamente **fora do
escopo do MVP** — considerar publicação automática restrita a mudanças de
metadados não normativos (por exemplo, correção de link de fonte oficial,
atualização de tags de categorização), desde que tal mudança nunca toque o
texto normativo em si nem a estrutura de dispositivos/Block IDs. Essa
possibilidade não está implementada nem especificada em detalhe nesta
decisão; qualquer avanço nessa direção exigirá um ADR próprio.

## Consequências

**Positivas**

- Elimina a classe de risco mais grave do produto: publicação automática
  de uma interpretação jurídica incorreta, que comprometeria a
  credibilidade do acervo inteiro.
- Cria um ponto único e auditável de responsabilidade: toda publicação
  tem um editor jurídico identificável que a aprovou, relevante tanto
  para controle de qualidade interno quanto para defender a fidedignidade
  do conteúdo perante usuários e eventuais questionamentos.
- Simplifica o desenho técnico do worker de atualização, que não precisa
  de nenhuma lógica de "confiança suficiente para publicar sozinho" — sua
  responsabilidade termina em gerar a pendência com diff estrutural
  completo.
- Alinha-se diretamente às regras de negócio inegociáveis do projeto
  (parser/worker nunca publica automaticamente sem validação humana;
  fidelidade máxima ao texto oficial).

**Negativas / trade-offs aceitos**

- Reduz a velocidade de publicação: uma atualização detectada pelo worker
  só chega ao acervo depois que um editor jurídico revisa e aprova,
  criando uma fila de trabalho editorial que precisa ser gerenciada
  (ver `UPDATE_PIPELINE.md`, seções 6 e 8, para a interface de revisão e
  o tratamento de pendências).
- Exige disponibilidade humana como recurso crítico do pipeline: se não
  houver editor jurídico revisando pendências, o acervo fica com
  atualizações pendentes acumuladas, mesmo que a mudança na fonte oficial
  seja simples e óbvia.
- Não há atalho para volumes altos de atualização simultânea (por exemplo,
  uma reforma legislativa ampla que altera muitas leis de uma vez): a
  fila de pendências cresce proporcionalmente, e o MVP não prevê
  priorização automática ou paralelização de revisão além do que a
  interface de lista de pendências já oferece.

## Alternativas consideradas

### Publicação automática com notificação pós-fato

O worker publicaria diretamente a atualização detectada assim que o diff
fosse gerado, notificando o editor jurídico depois, para revisão e
eventual correção/reversão a posteriori.

Rejeitado porque:

- inverte o ônus de risco: o conteúdo potencialmente incorreto fica
  visível para o público durante a janela entre publicação e revisão,
  expondo estudantes a um texto normativo possivelmente errado;
- contraria diretamente a regra de negócio inegociável do projeto de que
  o parser/worker nunca publica automaticamente sem validação humana;
- transformaria a revisão humana em auditoria corretiva em vez de
  controle preventivo, o que é uma postura de risco incompatível com a
  proposta de valor de confiabilidade do Vinculex.

### Aprovação em duas etapas por dois editores diferentes

Exigir que toda publicação (inicial ou de atualização) seja aprovada por
dois editores jurídicos distintos antes de ser commitada, como controle
adicional de qualidade (double-check por par).

Considerado, mas **adiado para além do MVP**, porque:

- introduz complexidade operacional (coordenação entre dois editores,
  possível gargalo de disponibilidade) que não é justificável no estágio
  atual, dado que a decisão já garante que nenhuma publicação ocorre sem
  ao menos uma revisão humana completa;
- é uma extensão natural do fluxo de pull request já suportado pela
  fonte canônica em Git (ver ADR-003), tornando viável adicioná-la
  posteriormente sem redesenho estrutural do pipeline;
- fica registrada como direção futura razoável, especialmente para leis de
  alto impacto ou alta sensibilidade, a ser avaliada em ADR próprio quando
  o volume editorial e a maturidade operacional do time justificarem o
  custo adicional.
