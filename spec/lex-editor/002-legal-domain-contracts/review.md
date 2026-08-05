# Revisão de Encerramento — Feature 002

Registro do que não se deduz do código: decisões forçadas por limites reais da
toolchain, o que sustenta cada critério de aceite e o que ficou deliberadamente
de fora.

## Desvio: os tipos não são `z.infer` direto

O `DATA_MODEL.md` §NormaAST pede que "o tipo TypeScript de cada fase seja
inferido do respectivo schema de runtime". A árvore recursiva completa estoura
o limite de serialização de declarações do TypeScript (**TS7056**) no momento
de emitir o `.d.ts` do pacote, que é `composite`. Não é ajuste de configuração:
o tipo inferido é grande demais para ser escrito no arquivo de declaração.

A saída foi manter as duas formas e **provar a equivalência em tempo de
compilação**, o que o quinto critério de aceite admite explicitamente ("o tipo é
derivado **ou testado** contra o schema runtime"):

- `nodes.ts` declara as interfaces públicas;
- `schemas.ts` constrói a árvore e mantém `_PROVA_DE_EQUIVALENCIA`, um objeto
  cujas propriedades só tipam como `true` quando schema e interface são
  mutuamente atribuíveis, encerrado por `satisfies Record<string, true>`.

A prova é bidirecional e foi falsificada antes de ser aceita: acrescentar um
campo só na interface produz 8 erros de compilação; trocar o slot de Block ID
da fase `parsed` produz 3; o estado correto produz 0. Uma prova que não pode
falhar não vale nada, e esta pode.

Consequência prática: **ao mexer em `nodes.ts` ou em `schemas.ts`, mexa nos
dois**. O typecheck não deixa passar de outro jeito, que é justamente a
intenção.

## Decisão: Block ID como "slot", não como tipo

Com `exactOptionalPropertyTypes`, uma propriedade ausente é diferente de uma
propriedade com valor `undefined`, e a fase muda exatamente isso. Um parâmetro
`B` do tipo do valor não bastava: `blockId: B` deixa a chave obrigatória mesmo
quando `B` inclui `undefined`.

As fases então recebem fragmentos de forma — `SlotSemBlockId`,
`SlotComBlockId`, `SlotBlockIdOpcional` — combinados por intersecção. Isso faz a
RF-002-02 valer em tempo de compilação: em `parsed`, `blockId` é `undefined` no
tipo, e código a jusante não consegue ler um Block ID de uma árvore ainda não
identificada.

Efeito colateral aceito: as famílias de nó são `type` com intersecção, não
`interface`, porque uma interface não pode estender um parâmetro de tipo.

## Descoberta: a validação produz forma canônica

A validação não devolve o objeto de entrada; o zod o reconstrói na ordem
declarada pelo schema. Duas árvores semanticamente iguais, escritas com as
chaves em ordens diferentes, saem como a **mesma** string JSON — verificado por
teste que inverte a ordem de todas as chaves da árvore.

Isso é mais forte do que o escopo pedia ("serialização determinística no nível
semântico") e é exatamente o que `versoes_lei.conteudo_sha256` vai precisar na
Feature 007. Em compensação, a saída **não** preserva a ordem de chaves da
entrada: quem esperar identidade byte a byte com o texto original vai se
frustrar. O teste de round-trip afirma igualdade semântica e ponto fixo, não
igualdade de bytes com a entrada.

## Divisão entre schema e validador

O `plan.md` manda separar forma de invariante global, e a separação tem uma
razão operacional além da organização: **um schema recursivo entra em laço
infinito diante de um ciclo de referências**. Por isso o percurso de
`validate.ts` é iterativo, com `WeakSet` de nós visitados, e pode rodar sobre
árvore não confiável antes ou depois do parse. Detecção de ciclo em `superRefine`
nunca chegaria a executar.

O validador reaplica algumas regras que o schema já cobre (revogação, tabela,
texto). É deliberado: ele precisa funcionar sozinho sobre uma árvore já tipada,
vinda de outro processo ou do banco, sem exigir um novo parse.

## Fora de escopo, confirmado

- **Formato do Block ID é validado, não gerado.** O schema recusa valor fora de
  `[a-z0-9]` separado por hífen e recusa o prefixo `^`, conforme
  `BLOCK_ID_SPEC.md` §2.3. Gerar e reconciliar é a Feature 003.
- **Conjunto de fontes não é validado como conjunto.** A ADR-009 §1 exige uma
  fonte `primary_current` por importação, mas isso é propriedade do conjunto de
  artefatos, não de uma árvore isolada; `sourceRole` e `sourceVariant` são
  validados por nó. A regra de conjunto pertence a quem orquestra a importação.
- **`redacoesAnteriores` é bloco opaco** (ADR-006 §4): ordem preservada, sem
  identidade nem Block ID próprio, sem subárvore navegável.

## Evidência dos critérios de aceite

| Critério | Como foi demonstrado |
|---|---|
| Todos os nós do `DATA_MODEL` existem em tipo e schema | `npm run check:data-model`: 21 interfaces conferidas pelo compilador do TypeScript, 0 divergências, nos dois sentidos |
| Fixtures mínimas `parsed` e `identified` passam | `parsedMinima`, `identifiedMinima` e `identifiedCompleta`, esta exercitando os 14 tipos de nó |
| Casos inválidos de fase, hierarquia, tabela e revogação falham | 36 testes de contrato, cada família com seu caso negativo |
| Pacote não importa infraestrutura | teste que lê a fonte e recusa qualquer import fora de `zod`; falsificado com um `node:fs` plantado |
| Typecheck prova tipo contra schema runtime | `_PROVA_DE_EQUIVALENCIA`, falsificada em dois cenários |

Comandos executados em 2026-08-05: `lint`, `format:check`, `typecheck`,
`test:unit` (57 testes, 5 arquivos), `test:boundaries`, `check:data-model`.

`scripts/audit-data-model.mjs` lê os blocos TypeScript do `DATA_MODEL.md` e
compara com a implementação usando o próprio compilador — ele resolve `extends`,
intersecção e genéricos, coisa que uma comparação textual não faz de forma
confiável. Fica fora da suíte padrão porque depende da formatação do documento;
rode-o ao alterar o modelo.

## Nota de configuração

`tsconfig.node.json` e `vitest.config.ts` passam a resolver
`@lex-editor/legal-domain` pela **fonte**, não por `dist/`. Sem isso, typecheck,
lint e testes enxergariam o último build: um contrato novo apareceria como
export inexistente e um contrato velho passaria despercebido. O artefato
compilado continua verificado por `typecheck:workspaces` e pelo build do
pacote, que usa `"types": []` e é o que realmente garante a pureza declarada.
