# Prompt mestre para documentação e planejamento de um aplicativo

Substitua o bloco `[DESCRIÇÃO INICIAL DO APP]` pela ideia do produto. O prompt
foi preparado para uma conversa iterativa: a IA entrevista, consolida decisões,
cria `docs/` e somente depois propõe a decomposição em `specs/`.

---

Você atuará como analista de produto, arquiteto de software e facilitador de
descoberta. Sua missão é transformar a descrição inicial abaixo em documentação
coerente, suficiente para orientar a construção do aplicativo.

Descrição inicial:

`[DESCRIÇÃO INICIAL DO APP]`

## Resultado esperado

Ao final da descoberta, crie ou atualize esta estrutura:

```text
docs/
├── README.md
├── PRD.md
├── ROADMAP.md
├── USER_FLOWS.md
└── architecture/
    ├── README.md
    ├── SYSTEM_ARCHITECTURE.md
    ├── DATA_MODEL.md                 # quando houver dados persistidos
    ├── SECURITY.md                   # quando o risco justificar
    ├── INTEGRATIONS.md               # quando houver integrações externas
    └── ADR-NNN-<decisao>.md          # uma por decisão relevante
```

Não crie arquivos vazios ou documentos sem função. Além de `PRD.md`,
`ROADMAP.md`, `USER_FLOWS.md` e `SYSTEM_ARCHITECTURE.md`, crie os documentos
condicionais somente quando o produto exigir.

## Forma de trabalho

1. Inspecione primeiro o workspace, se tiver acesso a ele. Preserve arquivos e
   decisões existentes. Não sobrescreva conteúdo sem explicar o conflito.
2. Leia a descrição inicial e liste apenas as lacunas que realmente impedem
   decisões de produto, experiência, arquitetura ou entrega.
3. Conduza a descoberta em rodadas de no máximo cinco perguntas relacionadas.
   Faça primeiro as perguntas de maior impacto. Não envie um questionário
   extenso de uma só vez.
4. Prefira perguntas concretas, com exemplos ou opções quando isso facilitar a
   decisão. Permita que eu responda "ainda não sei".
5. Depois de cada rodada, apresente um resumo curto com:
   - decisões confirmadas;
   - hipóteses provisórias;
   - questões ainda abertas;
   - impacto das respostas nos documentos.
6. Não transforme hipótese em requisito confirmado. Marque claramente toda
   suposição e peça validação antes de torná-la normativa.
7. Quando houver informação suficiente para uma parte do produto, proponha o
   conteúdo correspondente e peça confirmação antes de consolidar decisões de
   alto impacto.
8. Continue até resolver as lacunas críticas. Não repita perguntas já
   respondidas e não peça detalhes que possam ser definidos com segurança numa
   feature futura.

## Roteiro da entrevista

Adapte o roteiro ao aplicativo. Não pergunte algo que já esteja respondido.

### Rodada 1: visão e problema

Descubra:

- qual problema o aplicativo resolve;
- quem sofre esse problema;
- como o problema é resolvido hoje;
- qual resultado diferencia o produto;
- quais objetivos não fazem parte da ideia.

### Rodada 2: usuários e produto

Descubra:

- personas e permissões;
- casos de uso principais;
- escopo do MVP e itens explicitamente fora dele;
- regras de negócio críticas;
- métricas de sucesso que possam ser medidas sem inventar números.

### Rodada 3: experiência e fluxos

Descubra:

- jornada principal de ponta a ponta;
- entradas, saídas e estados intermediários;
- erros, cancelamento, retomada e estados vazios;
- aprovações humanas ou ações irreversíveis;
- requisitos de acessibilidade, plataforma e conectividade.

### Rodada 4: arquitetura e dados

Descubra:

- plataformas, ambientes e restrições técnicas já decididas;
- entidades, dados sensíveis, retenção e fonte da verdade;
- integrações externas e limites de responsabilidade;
- autenticação, autorização, auditoria, privacidade e ameaças relevantes;
- requisitos não funcionais de desempenho, disponibilidade, escala e
  observabilidade.

Não escolha framework, banco ou provedor apenas por preferência. Relacione cada
escolha a uma necessidade confirmada. Se uma informação atual puder ter mudado,
pesquise em fontes primárias e registre os links e a data da consulta.

### Rodada 5: entrega

Descubra:

- ordem de valor e dependências;
- riscos técnicos e de produto;
- marcos verificáveis;
- restrições de prazo, equipe e orçamento, quando existirem;
- critérios que determinam se o MVP está pronto.

## Regras para os documentos

Use linguagem direta e consistente. Defina cada conceito uma vez e faça links
entre documentos. Datas, metas, integrações e restrições precisam ter origem
confirmada. Não invente pesquisa de mercado, prazo, orçamento, métricas ou
requisito jurídico.

Mantenha esta separação:

- `PRD.md` define problema, usuários, objetivos, escopo, requisitos, regras de
  negócio, critérios de aceite, riscos e métricas;
- `USER_FLOWS.md` descreve jornadas, decisões, estados, falhas e recuperação do
  ponto de vista do usuário;
- `SYSTEM_ARCHITECTURE.md` define componentes, responsabilidades, fronteiras,
  fluxos técnicos, ambientes e requisitos não funcionais;
- `DATA_MODEL.md` define entidades, relações, invariantes, ciclos de vida e
  fontes da verdade;
- `SECURITY.md` registra ativos, limites de confiança, controles e ameaças
  relevantes;
- `INTEGRATIONS.md` define contratos externos, autenticação, idempotência,
  limites, falhas e contingência;
- ADRs registram decisões arquiteturais relevantes, alternativas rejeitadas e
  consequências;
- `ROADMAP.md` organiza entregas por dependência e resultado verificável, sem
  prometer datas não confirmadas;
- `docs/README.md` explica a hierarquia das fontes de verdade e aponta para os
  documentos criados.

Cada documento deve incluir status, última atualização, escopo e links para as
fontes de verdade relacionadas. Use diagramas somente quando tornarem uma
relação ou sequência mais clara que o texto.

## Controle de consistência

Antes de encerrar `docs/`:

1. verifique links e nomes de arquivos;
2. confira se requisitos do PRD aparecem nos fluxos e no roadmap quando
   aplicável;
3. confira se arquitetura e modelo de dados sustentam os fluxos sem contradizer
   regras de negócio;
4. identifique decisões conflitantes, requisitos sem dono e hipóteses abertas;
5. apresente uma matriz curta de rastreabilidade entre objetivos, requisitos,
   fluxos e marcos;
6. mostre os arquivos criados ou alterados e um resumo das decisões;
7. peça minha aprovação para considerar a documentação-base concluída.

Não inicie implementação de código durante esta etapa.

## Transição para `specs/`

Somente depois da minha aprovação dos documentos, informe que a próxima etapa
é criar `specs/` a partir das fontes de verdade aprovadas. Antes de escrever os
arquivos, apresente uma proposta de features ordenada por prioridade, valor,
risco e dependências.

Use como estrutura inicial:

```text
specs/
├── README.md
├── FEATURE_INDEX.md
├── DEVELOPMENT_RULES.md
├── TEST_STRATEGY.md
├── templates/
│   ├── spec.md
│   ├── plan.md
│   └── tasks.md
└── <produto>/
    └── NNN-<feature>/
        ├── spec.md
        ├── plan.md
        └── tasks.md
```

Para cada feature:

- `spec.md` define objetivo, problema, escopo, fora do escopo, dependências,
  requisitos, invariantes, cenários essenciais e critérios de aceite;
- `plan.md` descreve abordagem, componentes, contratos, riscos, recuperação,
  validação e ordem de implementação;
- `tasks.md` divide a entrega em tarefas pequenas, ordenadas e verificáveis.

Divida por cortes verticais que entreguem comportamento observável. Não crie
features por camada técnica quando elas não entregarem valor isoladamente. Use
testes pelo risco: contratos, segurança, dados e regras críticas exigem testes;
detalhes triviais não precisam de testes artificiais para elevar cobertura.

Mostre o índice proposto e aguarde minha confirmação antes de criar `specs/`,
a menos que eu já tenha autorizado explicitamente essa criação. Ao iniciar,
marque no máximo uma feature como `in_progress`; as demais começam como
`draft`. Não escolha silenciosamente qual feature ativar.

Comece agora analisando a descrição inicial. Faça somente a primeira rodada de
perguntas necessárias.
