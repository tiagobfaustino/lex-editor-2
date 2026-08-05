# Fixture — Código Penal, art. 121 (recorte)

## O que é

Recorte do art. 121 do Decreto-Lei nº 2.848, de 7 de dezembro de 1940 (Código
Penal), do caput até a alínea `b` do inciso VII do § 2º.

É a fixture da Feature 003. Foi escolhida porque **um único artigo real cobre
todas as famílias de nó que o corte vertical precisa exercitar**, sem recortes
costurados de partes distantes da lei:

| Exigência da spec    | Onde aparece                                        |
| -------------------- | --------------------------------------------------- |
| artigo               | `Art. 121`                                          |
| pena                 | `Pena - reclusão, de seis a vinte anos.`            |
| parágrafo            | `§ 1º` e `§ 2º`                                     |
| inciso               | `I` a `VII`                                         |
| alínea               | `a)` e `b)` do inciso VII                           |
| dispositivo revogado | inciso VI, `(Revogado pela Lei nº 14.994, de 2024)` |

## O que deliberadamente não está aqui

- **Do § 2º-A em diante.** O recorte para na alínea `b` para manter a fixture
  curta, como o plano pede. Isso a torna um recorte, não o artigo íntegro: o
  `total_artigos` do golden é 1 e o conteúdo não deve ser lido como o art. 121
  completo.
- **As penas do § 2º.** No texto oficial há linhas `Pena` que pertencem ao § 2º
  e ao inciso V, não ao dispositivo imediatamente anterior. O parser desta
  feature ancora a pena no dispositivo que a precede, regra que estaria errada
  nesses dois casos. Em vez de generalizar uma inferência que a fixture não
  sustenta — o `plan.md` proíbe exatamente isso —, essas linhas ficaram de
  fora. Resolver a ancoragem correta é trabalho da Feature 004.
- **Divisões estruturais.** Capítulo e título do CP não entram: o Block ID não
  inclui divisão por padrão (`BLOCK_ID_SPEC.md` §2.4) e o recorte não tem
  colisão de numeração a desambiguar.

## Proveniência e verificação pendente

O texto foi transcrito a partir de `exemplos/Decreto-Lei n° 2.848 (CP).md`,
removendo marcação editorial (spans HTML, realces, âncoras de bloco do Obsidian
e rótulos de nomen juris). A ADR-009 é explícita: os arquivos de `exemplos/`
são referência editorial legada, **não são fonte normativa**.

> **Verificação humana pendente (T003-10).** A conferência do texto contra
> a fonte oficial — <https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm>
> — não foi feita: o ambiente de desenvolvimento não tem acesso à rede e a
> Feature 003 exclui download por URL do escopo. O `manifesto.json` registra o
> SHA-256 do arquivo local, que prova integridade do que está no repositório,
> **não** fidelidade ao texto oficial. Um golden estruturalmente perfeito sobre
> texto jurídico errado é exatamente o risco que a spec nomeia.

## Papel no conjunto de fontes

A ADR-009 §1 exige um artefato `primary_current` por importação. Aqui há
apenas um: o arquivo local, com `sourceRole: primary_current` e
`sourceVariant: compiled`, porque reproduz texto compilado. Não há fonte
`historical_auxiliary` — o recorte não traz redações anteriores riscadas.

## Arquivos

| Arquivo                    | Papel                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `entrada.txt`              | entrada do pipeline; é o artefato de que se tira o SHA-256                      |
| `manifesto.json`           | metadados que o Formatter não pode inventar: datas, SemVer, sigla, URL da fonte |
| `esperado.md`              | golden byte a byte da saída canônica                                            |
| `entrada-inciso-orfao.txt` | variante inválida: inciso sem artigo que o anteceda                             |
