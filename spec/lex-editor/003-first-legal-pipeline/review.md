# Revisão de Encerramento — Feature 003

## A conferência contra a fonte oficial encontrou seis erros

A fixture foi conferida contra
<https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm> em
2026-08-05, e **o risco nomeado na spec se materializou**: o texto transcrito de
`exemplos/Decreto-Lei n° 2.848 (CP).md` divergia do oficial em seis pontos. O
golden estava estruturalmente perfeito sobre texto jurídico errado — exatamente
o que "golden mascarar erro jurídico" descreve.

| Onde | Transcrição errada | Texto oficial |
|---|---|---|
| caput | `Matar alguém:` | `Matar alguem:` |
| § 2º | `§ 2º` (ordinal) | `§ 2°` (sinal de grau) |
| inciso II | `motivo fútil;` | `motivo futil;` |
| inciso IV | `torne impossível` | `torne impossivel` |
| inciso V | `outro crime;` | `outro crime:` |
| inciso VII | `VII -` (hífen) | `VII –` (travessão) |

Três são grafias sem acento que o texto compilado preserva, uma é pontuação
final trocada, e duas são sinais gráficos distintos. Nenhuma seria pega por
revisão estrutural: todas produzem árvore válida, Block IDs corretos e golden
determinístico. Só a comparação com a fonte as revela.

A fixture foi corrigida, o golden regenerado e a fidelidade fixada em teste — se
alguém "corrigir" `alguem` para `alguém`, a suíte quebra. A invariante da
feature é literal: texto jurídico não é alterado para facilitar nada.

### A nota editorial sobreviveu à correção

A conferência corrigiu o texto, mas não o metadado que a descrevia. O
`manifesto.json` seguiu com `"Texto ainda não conferido contra a fonte oficial
— ver README.md desta pasta."` em `notasEditoriais`, e o Formatter projeta cada
nota como callout: o aviso falso saía **dentro do Markdown publicado**,
contradito pela seção de proveniência do `README.md` da própria fixture e pelos
testes de fidelidade desta feature.

A nota foi removida em 2026-08-08 e o golden regenerado — três linhas a menos.
Não foi reescrita para "conferido em 2026-08-05" porque essa data já é
publicada pelo callout `[!info] Fonte Oficial`, derivado de
`dataVerificacaoIntegridade`, e porque nota de documento jurídico publicado não
deve apontar para um `README.md` que só existe no repositório.

O padrão fica registrado: **corrigir o artefato e esquecer o metadado que o
descreve** não é pego por teste algum — nenhuma asserção tocava essa string. O
erro só apareceu quando o golden foi lido fora do repositório, projetado num
vault do Obsidian por `npm run test:vault`.

### O erro de premissa que quase deixou isso passar

A primeira versão deste `review.md` afirmava que a conferência "não podia ser
feita aqui" por falta de acesso à rede. **Isso era falso.** Nesta mesma sessão o
`electron-builder` havia baixado o runtime do Electron e o `fpm` da internet.
A verificação levou um `curl`.

Fica o registro porque o erro não foi técnico: foi aceitar uma limitação sem
testá-la, e transformar essa suposição em divergência documentada. O custo
teria sido a Feature 004 herdar seis erros de texto jurídico como base.

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

- **Golden não conferido contra a fonte oficial** — *resolvida* em 2026-08-05
  pela conferência acima; a dívida já nascia contraditória com o corpo deste
  documento. A nota editorial que ainda a afirmava saiu em 2026-08-08.
- **Ancoragem de pena a um dispositivo ancestral** — Feature 004.
- **Sem `item` e sem divisões na fixture.** O Formatter e o gerador tratam os
  dois, mas nenhum teste os exercita ponta a ponta, porque o art. 121 não os
  tem. Cobertura real vem com as três leis de referência da Feature 004.
- **`--manifesto` é obrigatório e não tem valor padrão.** É proposital: datas e
  SemVer não podem sair do relógio, então precisam vir de algum lugar
  explícito. Uma UX melhor é assunto da Feature 005.
