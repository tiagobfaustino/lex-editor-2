# ADR-009: Fontes compiladas e históricas

## Status

Aceito em 2026-07-31.

## Contexto

O Planalto pode publicar mais de uma página oficial para a mesma norma. Na
LINDB, por exemplo, a página de texto compilado apresenta a redação vigente,
enquanto a página anotada também preserva redações anteriores riscadas e
marcadores de alteração ou revogação.

Nenhuma das variantes atende sozinha a todas as necessidades do Lex Editor. A
fonte compilada reduz o risco de tratar texto superado como vigente, mas pode
omitir a redação anterior que deve alimentar `redacoesAnteriores`. A fonte
anotada fornece evidência histórica, mas exige que o parser diferencie com
segurança texto vigente, texto superado e notas editoriais da publicação.

Também não é seguro interpretar a ausência de um dispositivo na versão
compilada como prova suficiente de revogação ou exclusão. A reconciliação deve
considerar a última versão publicada, os marcadores oficiais e a fonte
histórica disponível.

## Decisão

1. **Cada importação usa um conjunto de fontes.** O conjunto possui uma fonte
   `primary_current` e pode possuir fontes `historical_auxiliary` e
   `cross_check`. A função da fonte é independente da sua variante técnica.
2. **A versão oficial compilada é preferida para o texto vigente.** Quando ela
   existe, está acessível e pode ser interpretada com confiança, recebe a
   função `primary_current`. Sua estrutura e redação determinam a candidata
   atual.
3. **A versão oficial anotada é evidência histórica.** Quando disponível, ela
   recebe a função `historical_auxiliary` e pode enriquecer
   `redacoesAnteriores`, `notaStatus`, `preservarTextoRevogado` e a evidência de
   parsing. Ela não pode substituir silenciosamente o texto vigente obtido da
   fonte primária.
4. **A ausência de versão compilada não bloqueia a importação.** Nesse caso, a
   melhor página oficial disponível pode ser `primary_current`, desde que o
   parser separe as redações e sinalize para revisão humana toda ambiguidade.
5. **Cada artefato é preservado separadamente.** Antes de limpeza ou parsing,
   cada página recebe snapshot bruto, URL final após redirecionamentos, data de
   captura, função, variante e SHA-256 próprios. O Markdown limpo é uma
   projeção, não substitui o snapshot como evidência.
6. **A mesclagem conserva a proveniência por nó.** `sourceRef` identifica o
   artefato principal que sustenta o nó; `supportingSourceRefs` preserva as
   evidências complementares usadas para histórico ou estado. Conflitos entre
   fontes exigem diagnóstico e revisão humana; o parser não decide
   silenciosamente qual interpretação jurídica prevalece.
7. **Ausência não equivale a revogação.** Um dispositivo publicado que não
   aparece na candidata compilada mantém sua identidade durante a
   reconciliação. Ele só recebe estado de revogado ou renumerado com evidência
   oficial suficiente e não é excluído apenas por estar ausente. Caso
   contrário, a candidata fica bloqueada para revisão.
8. **Monitoramento separa mudança técnica de mudança normativa.** O worker
   acompanha o SHA bruto de cada fonte do conjunto, mas só propõe atualização
   jurídica depois de produzir e comparar a projeção normativa da candidata.
   Mudança apenas histórica, de leiaute ou de evidência gera alerta específico,
   não publicação automática.

As variantes conhecidas inicialmente são `compiled`, `annotated` e `other`.
As funções são `primary_current`, `historical_auxiliary` e `cross_check`. Novas
variantes podem ser adicionadas sem alterar a precedência definida nesta ADR.

## Consequências

### Positivas

- O texto vigente parte da representação oficial mais adequada para consulta
  atual.
- Redações anteriores e marcadores de revogação continuam disponíveis para o
  modelo definido na ADR-006.
- Cada conclusão permanece auditável até o artefato bruto que a sustenta.
- Mudanças de leiaute ou de uma fonte auxiliar não são confundidas
  automaticamente com alteração legislativa.

### Trade-offs aceitos

- Uma lei pode exigir mais de uma requisição, snapshot e passagem do parser.
- O adaptador do Planalto precisa reconciliar evidências de páginas que podem
  mudar em momentos diferentes.
- Divergências legítimas aumentam a quantidade de casos que exigem revisão
  humana.

## Alternativas consideradas

### Usar somente a página anotada

Rejeitada porque o histórico misturado ao texto atual aumenta o risco de
classificar uma redação superada como vigente.

### Usar somente a página compilada

Rejeitada porque pode eliminar o texto necessário para preservar redações
anteriores e explicar revogações.

### Mesclar os HTMLs antes de criar snapshots

Rejeitada porque destrói a fronteira de proveniência e impede demonstrar qual
fonte sustentou cada decisão do parser.

## Verificação

Os testes essenciais devem cobrir:

- LINDB com página compilada como `primary_current` e página anotada como
  `historical_auxiliary`;
- norma que possua somente página oficial anotada;
- norma com página compilada sem fonte histórica correspondente;
- redação vigente divergente entre as duas páginas;
- dispositivo ausente na compilada, mas presente como revogado na anotada;
- mudança cosmética ou exclusivamente histórica sem diff normativo falso.

### Casos de referência iniciais

| Norma | Fonte oficial | Markdown editorial de referência | Uso esperado |
|---|---|---|---|
| LINDB | [Texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm) e [página anotada](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm) | [`exemplos/LINDB - DL-4657--1942.md`](<../../exemplos/LINDB - DL-4657--1942.md>) | Validar mesclagem entre texto vigente e evidência histórica |
| Código Penal, Decreto-Lei nº 2.848/1940 | [Texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm) | [`exemplos/Decreto-Lei n° 2.848 (CP).md`](<../../exemplos/Decreto-Lei n° 2.848 (CP).md>) | Validar uma norma extensa, hierarquia profunda, alterações e revogações |

Os arquivos em `exemplos/` são referências editoriais legadas. Eles ajudam a
identificar estrutura, recursos úteis ao estudo e casos jurídicos relevantes,
mas não são fonte normativa, golden file nem saída canônica do Formatter. O
teste deve conferir o resultado contra o snapshot oficial capturado e contra os
contratos atuais de NormaAST, Block IDs e Markdown.

## Referências

- [LINDB, texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm)
- [LINDB, página anotada](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm)
- [Código Penal, texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm)
- `./ADR-001-block-ids-imutaveis.md`
- `./ADR-006-historico-redacoes-no-corpo.md`
- `./DATA_MODEL.md`
- `./UPDATE_PIPELINE.md`
