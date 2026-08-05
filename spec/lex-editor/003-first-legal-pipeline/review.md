# Revisão de Encerramento — Feature 003

## Divergência aberta: o golden não foi conferido contra a fonte oficial

A spec pede "revisão manual da fixture contra a fonte oficial" e a T003-10
repete a exigência. **Isso não foi feito, e não podia ser feito aqui**: o
ambiente de desenvolvimento não tem acesso à rede e a feature exclui download
por URL do escopo.

O texto da fixture foi transcrito de `exemplos/Decreto-Lei n° 2.848 (CP).md`,
removendo marcação editorial. A ADR-009 é explícita ao classificar esses
arquivos como referência editorial legada, **não fonte normativa**. O SHA-256
registrado prova integridade do arquivo no repositório; não prova fidelidade ao
texto do Planalto.

O próprio risco nomeado na spec — "golden mascarar erro jurídico: revisar
conteúdo, não apenas snapshot" — está, portanto, **em aberto**. Tudo que é
estrutural foi verificado por automação; a fidelidade jurídica do texto
depende de um humano com acesso a
<https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm>.

Antes de a Feature 004 usar esta fixture como base, a conferência precisa
acontecer.

## Decisões que o código não explica sozinho

### A fixture é um artigo só, e é de propósito

O art. 121 do CP cobre sozinho as seis exigências da spec — artigo, pena,
parágrafo, inciso, alínea e dispositivo revogado (inciso VI). Costurar trechos
distantes da lei daria a mesma cobertura com um artefato que não corresponde a
nada real. O recorte para na alínea `b` do inciso VII para ficar curto, e o
`README.md` da fixture registra que é recorte, não o artigo íntegro.

### Duas linhas `Pena` do texto oficial ficaram de fora

No art. 121 há linhas `Pena` que pertencem ao § 2º e ao inciso V, não ao
dispositivo imediatamente anterior. O parser desta feature ancora a pena no
dispositivo que a precede — regra correta para a pena do caput e **errada**
para essas duas.

Havia duas saídas: inventar uma heurística de reancoragem que a fixture não
sustenta, ou tirar as linhas ambíguas. O `plan.md` decide por mim ("não
generalizar padrões ausentes da fixture"), e a segunda é honesta: a ancoragem
correta depende de sinal que o texto plano não carrega. É trabalho da
Feature 004, com fonte que preserve a estrutura.

### O parser recusa linha desconhecida em vez de anexá-la

Uma linha que não casa com designador algum poderia ser tratada como
continuação do dispositivo anterior. Seria conveniente e silenciosamente
alteraria conteúdo jurídico — o pior sucesso falso possível neste pipeline.
Linha não reconhecida é erro de parsing.

### Colisão de Block ID falha, sem contador

A `BLOCK_ID_SPEC.md` §7.3 proíbe resolver colisão sufixando `-2`. A razão é
concreta: um link estável passaria a apontar para o dispositivo errado. A única
resolução automática permitida é qualificação por divisão estrutural, e a
fixture não tem divisões — então aqui a colisão só falha. Há teste para isso.

### `fixtures/` entrou no `.prettierignore`

O golden é a saída canônica do Formatter, definida pela `MARKDOWN_SPEC.md`
§2.4. O Prettier reescreveu o arquivo no primeiro commit e o teste byte a byte
falhou — corretamente: ele estava comparando a saída do Formatter com a
formatação de outra ferramenta.

### A CLI é um pacote separado por causa da pureza do domínio

`packages/legal-domain` não pode importar `node:fs` nem `node:crypto`, e o
teste de pureza da Feature 002 recusa isso. Ler arquivo, calcular SHA-256 e
gravar são as três coisas que a CLI faz; todo o resto — parsing, IDs,
validação, serialização — é decisão de domínio e mora no domínio. A CLI usa
referência de projeto do TypeScript para o domínio, e não `paths` para a fonte,
porque o domínio tem `rootDir` próprio.

## Evidência dos critérios de aceite

| Critério | Como foi demonstrado |
|---|---|
| Comando ponta a ponta sem Electron ou rede | `node packages/cli/dist/main.js process …` gera o Markdown; nada no caminho toca rede |
| Golden idêntico byte a byte em duas execuções | duas execuções da CLI e o golden compartilham **um único SHA-256** |
| Todo nó referenciável recebe ID válido e único | 13 dispositivos, 13 Block IDs; unicidade conferida no gerador, no validador estrutural e de novo sobre o Markdown final |
| Frontmatter e corpo passam nas validações aplicáveis | testes de ordem dos 13 campos, callouts obrigatórios, indentação em múltiplos de 2, `^id` como último token, ausência de callout no corpo |
| Caso inválido demonstra falha segura e acionável | inciso órfão → etapa `parsing`, código `dispositivo_orfao`, caminho `/linhas/1`, saída **não** gravada, exit 3 |

Os Block IDs gerados batem com os exemplos da própria `MARKDOWN_SPEC.md`
(`cp-art-121`, `cp-art-121-par-2-inc-i`), o que é uma conferência independente
do gerador contra o documento normativo.

Comandos executados em 2026-08-05: `lint`, `format:check`, `typecheck`,
`test:unit` (80 testes, 6 arquivos), `test:boundaries`, `check:data-model`,
mais as execuções manuais da CLI acima.

## Dívidas

- **Golden não conferido contra a fonte oficial** — a divergência acima.
- **Ancoragem de pena a um dispositivo ancestral** — Feature 004.
- **Sem `item` e sem divisões na fixture.** O Formatter e o gerador tratam os
  dois, mas nenhum teste os exercita ponta a ponta, porque o art. 121 não os
  tem. Cobertura real vem com as três leis de referência da Feature 004.
- **`--manifesto` é obrigatório e não tem valor padrão.** É proposital: datas e
  SemVer não podem sair do relógio, então precisam vir de algum lugar
  explícito. Uma UX melhor é assunto da Feature 005.
