# ADR-009: Fontes compiladas e históricas

## Status

Aceito em 2026-07-31. Atualizado em 2026-10-08 por decisão explícita do
usuário: a URL escolhida na importação manual define a fonte primária.

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
2. **A URL escolhida determina o texto principal da importação manual.** O
   artefato solicitado pelo usuário recebe `primary_current`, após os
   redirecionamentos validados. Uma contraparte descoberta ou configurada não
   substitui automaticamente esse texto, mesmo sendo compilada. Sem seleção
   manual, coletas automáticas usam os papéis versionados no catálogo, com
   preferência inicial pela compilada. Alterar a seleção de uma nova
   importação não reescreve projetos nem bindings existentes.
3. **A contraparte é evidência complementar.** Quando não foi escolhida como
   primária, a anotada recebe `historical_auxiliary`, podendo enriquecer
   `redacoesAnteriores`, `notaStatus`, `preservarTextoRevogado` e a evidência
   de parsing. A compilada complementar recebe `cross_check`. Nenhuma delas
   substitui silenciosamente o texto da URL selecionada. A fonte anotada
   escolhida como primária exige separação segura entre redações atuais e
   anteriores, com revisão humana de ambiguidades.
4. **A ausência de uma contraparte não bloqueia a importação.** A URL
   selecionada continua primária, desde que o parser separe as redações e
   sinalize ambiguidades. Falha ao acessar a própria URL selecionada não
   autoriza substituí-la por outra página. No catálogo, a seleção manual deve
   corresponder a exatamente um artefato autorizado antes da coleta.
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
| Lei nº 9.099/1995 | [Página anotada](https://www.planalto.gov.br/ccivil_03/leis/l9099.htm) | `L.9099-95_Juizados-Especiais.md` (referência externa) | Validar redações anteriores e atuais dos arts. 61 e 62 sem classificar o artigo inteiro como revogado |
| Lei nº 9.605/1998 | [Página anotada](https://www.planalto.gov.br/ccivil_03/leis/l9605.htm) | `L9605.md` (referência externa) | Validar fonte única anotada, alterações e dispositivo parcialmente revogado |
| Lei nº 10.826/2003 | [Página anotada](https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm) e [texto compilado](https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm) | `Estatuto do Desarmamento - L.10826-2006.md` (referência externa; o ano oficial da lei é 2003) | Validar precedência da compilada, enriquecimento histórico e anexos/tabelas superados |

Os arquivos em `exemplos/` são referências editoriais legadas. Eles ajudam a
identificar estrutura, recursos úteis ao estudo e casos jurídicos relevantes,
mas não são fonte normativa, golden file nem saída canônica do Formatter. O
teste deve conferir o resultado contra o snapshot oficial capturado e contra os
contratos atuais de NormaAST, Block IDs e Markdown.

As referências externas adicionadas em 2026-08-11 seguem a mesma regra. Tags
HTML, negrito, realces, Block IDs e outras marcações pessoais devem ser
ignorados na comparação. Um tachado só é tratado como evidência histórica
quando também estiver presente no snapshot oficial.

## Referências

- [LINDB, texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm)
- [LINDB, página anotada](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm)
- [Código Penal, texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm)
- `./ADR-001-block-ids-imutaveis.md`
- `./ADR-006-historico-redacoes-no-corpo.md`
- `./ADR-012-projecoes-completa-e-vigente.md`
- `./DATA_MODEL.md`
- `./UPDATE_PIPELINE.md`


## Ambiguidade dentro da fonte selecionada

Quando a própria fonte mantém um marcador literal de veto sem riscado,
seguido de outra redação da mesma posição, a importação desktop pode
apresentar uma candidata de baixa confiança com o marcador preservado no
histórico e sua referência de suporte. Isso não comprova superação do veto:
requer confirmação editorial explícita antes da aprovação. Não se criam
IDs por contador, não se apaga evidência e não se substitui a fonte
selecionada pela contraparte para contornar a ambiguidade.
