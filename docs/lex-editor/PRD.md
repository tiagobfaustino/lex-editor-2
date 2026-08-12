# PRD — Lex Editor

> Versão do documento: 2.2
> Produto: Lex Editor (ferramenta editorial interna do ecossistema Vinculex)
> Última atualização: 2026-08-11
> Documentos relacionados: `../architecture/SYSTEM_ARCHITECTURE.md`, `../architecture/DATA_MODEL.md`, `../architecture/BLOCK_ID_SPEC.md`, `../architecture/MARKDOWN_SPEC.md`, `../architecture/UPDATE_PIPELINE.md`, `../architecture/ADR-013-referencias-juridicas-resolvidas.md`, `./ROADMAP.md`, `./USER_FLOWS.md`

## Sumário

1. [Visão do Produto](#1-visão-do-produto)
2. [Objetivos Estratégicos](#2-objetivos-estratégicos)
3. [Personas](#3-personas)
4. [Problema](#4-problema)
5. [Escopo](#5-escopo)
6. [Fora do Escopo](#6-fora-do-escopo)
7. [Casos de Uso](#7-casos-de-uso)
8. [Fluxos do Editor](#8-fluxos-do-editor)
9. [Arquitetura](#9-arquitetura)
10. [NormaAST](#10-normaast)
11. [Parser](#11-parser)
12. [Defuddle](#12-defuddle)
13. [Block IDs](#13-block-ids)
14. [Markdown Formatter](#14-markdown-formatter)
15. [Frontmatter](#15-frontmatter)
16. [Versionamento](#16-versionamento)
17. [UPDATE.md](#17-updatemd)
18. [Publicação](#18-publicação)
19. [Requisitos Funcionais](#19-requisitos-funcionais)
20. [Requisitos Não Funcionais](#20-requisitos-não-funcionais)
21. [Validação](#21-validação)
22. [Logs](#22-logs)
23. [Modelo de Dados](#23-modelo-de-dados)
24. [APIs Internas](#24-apis-internas)
25. [Roadmap](#25-roadmap)
26. [Critérios de Aceite](#26-critérios-de-aceite)
27. [Riscos](#27-riscos)
28. [Métricas](#28-métricas)
29. [ADRs Relacionados](#29-adrs-relacionados)

---

## 1. Visão do Produto

O Lex Editor é a ferramenta editorial oficial do ecossistema Vinculex, usada exclusivamente pela equipe interna responsável por transformar legislação brasileira bruta (publicada em portais oficiais como Planalto, LexML ou diários oficiais) em conteúdo jurídico estruturado, versionado e pronto para consumo por estudantes de Direito e concursos públicos através do Vinculex SaaS.

O produto resolve um problema de engenharia editorial: leis brasileiras não têm formato padronizado, sofrem alterações ao longo do tempo, contêm dispositivos revogados e vetados que precisam ser sinalizados, e exigem uma estrutura hierárquica (livro, título, capítulo, seção, subseção, artigo, parágrafo, inciso, alínea, item) que a maioria das fontes oficiais não expõe de forma consistente ou lisível por máquina.

O Lex Editor cobre a preparação editorial entre a fonte oficial e um release
candidate: importação, extração, parsing para NormaAST, geração de Block IDs,
formatação Markdown, preview, validação, exportação e aprovação. Ele envia o
candidate a um branch limitado e solicita a publicação; somente o Serviço de
Publicação server-side promove o SHA ao branch canônico e sincroniza o
Supabase. Cada etapa é auditável e nenhuma publicação ocorre sem revisão
humana explícita.

O Lex Editor não é um produto de mercado: não tem usuários externos, não tem modelo de monetização próprio e seu sucesso é medido pela qualidade, velocidade e confiabilidade com que ele abastece o Vinculex SaaS com conteúdo jurídico correto.

## 2. Objetivos Estratégicos

Os objetivos abaixo medem o valor de negócio do Lex Editor — não devem ser confundidos com os critérios de aceite técnicos do capítulo 26.

| Objetivo | Racional | Métrica de sucesso |
|---|---|---|
| Reduzir o custo de produção de conteúdo jurídico | Hoje a curadoria manual de uma lei é o maior gargalo para o crescimento do catálogo do Vinculex SaaS | Reduzir em pelo menos 70% o tempo médio entre "URL da lei" e "lei publicada e disponível no SaaS", comparado ao processo manual atual |
| Garantir confiabilidade jurídica do acervo | O SaaS vende exatidão como diferencial (foco em concursos como CFO/PMMG); um erro de transcrição compromete a credibilidade do produto | Zero divergências de texto legal identificadas em auditoria amostral trimestral entre o Markdown publicado e a fonte oficial |
| Viabilizar escala do catálogo | Cobrir CF/88, CP, CPP, CPPM, ECA, CTB, Lei 14.133 e legislação correlata em prazo competitivo com concorrentes de conteúdo jurídico | Permitir que um único editor publique, em regime de rotina, ao menos uma lei de porte médio por dia útil |
| Preservar histórico e rastreabilidade | Alterações legislativas são frequentes; o produto precisa suportar atualização sem quebrar links/anotações de usuários do SaaS | 100% das publicações com Markdown, entrada de `UPDATE.md` e manifesto no mesmo release commit |
| Reduzir dependência de conhecimento tácito | O processo manual hoje depende de know-how não documentado de poucas pessoas | Onboarding de um novo editor jurídico capaz de publicar uma lei simples sozinho em até 2 dias de uso da ferramenta |

## 3. Personas

### Editor Jurídico

**Quem é:** profissional com formação em Direito (ou em fase final de graduação), responsável por importar, revisar e aprovar o conteúdo de cada lei antes da publicação. É o principal usuário do Lex Editor no dia a dia.

**Responsabilidades:**
- Iniciar a importação de uma lei por URL ou arquivo local.
- Revisar o resultado do parser (NormaAST) e do preview Markdown/Obsidian, comparando com a fonte oficial.
- Corrigir manualmente trechos em que o parser falhou (ambiguidades de hierarquia, dispositivos revogados/vetados mal identificados, formatação de tabelas ou incisos numerados de forma não padrão).
- Preencher e validar o frontmatter de cada lei.
- Aprovar ou rejeitar diffs de atualização legislativa levantados pelo worker.
- Aprovar editorialmente o release candidate e acompanhar a execução
  server-side até a confirmação do ponteiro público.

**Dores no processo manual atual:**
- Copiar e formatar artigo por artigo manualmente em editor de texto, processo lento e sujeito a erro humano de transcrição.
- Dificuldade em manter numeração/hierarquia consistente em leis longas (ex.: Lei 14.133, CPPM) com centenas de artigos.
- Falta de visibilidade sobre o que mudou quando uma lei já publicada sofre alteração legislativa.
- Nenhuma checagem automática de fidelidade ao texto oficial — a revisão hoje é 100% visual.

**Nível técnico:** baixo a médio. Não escreve código, mas está confortável com interfaces desktop, Markdown básico e conceitos de versão/histórico (não necessariamente Git via linha de comando). A ferramenta precisa expor Git através de ações de UI (comparar, aprovar, publicar), nunca exigir comandos de terminal.

### Administrador Técnico / Mantenedor do Acervo

**Quem é:** desenvolvedor(a) ou engenheiro(a) responsável pela infraestrutura do Lex Editor, pela saúde do pipeline de importação/publicação e pela integridade técnica do repositório Git e do Supabase.

**Responsabilidades:**
- Configurar e manter as fontes de importação suportadas (Planalto, LexML, novos domínios).
- Diagnosticar e corrigir falhas do parser quando uma fonte muda de estrutura HTML.
- Gerenciar o worker de atualização legislativa (cron, agendamento, monitoramento de falhas).
- Resolver colisões de Block ID, inconsistências estruturais e problemas de sincronização com o Supabase.
- Auditar logs de importação, parsing, validação e publicação.
- Realizar rollback de uma publicação problemática.

**Dores no processo manual atual:**
- Sem uma AST intermediária, qualquer mudança de fonte (ex.: o Planalto reestrutura o HTML de uma página) quebra scripts pontuais sem aviso.
- Ausência de logs estruturados torna a investigação de erros de publicação lenta e artesanal.
- Nenhuma trilha de auditoria clara entre "o que o worker detectou" e "o que foi de fato publicado".

**Nível técnico:** alto. Confortável com TypeScript, Git, SQL/Supabase, leitura de logs estruturados e depuração de parsers. É o público que vai interagir com as camadas mais técnicas da ferramenta (configuração de fontes, resolução de conflitos, telas de log/auditoria).

### Mantenedor do Acervo (papel transversal)

Em times pequenos, o mantenedor do acervo é frequentemente a mesma pessoa que acumula responsabilidades de Editor Jurídico e Administrador Técnico. O Lex Editor deve funcionar bem tanto em um fluxo com papéis separados (editor jurídico aprova conteúdo, administrador técnico aprova infraestrutura) quanto em um fluxo em que uma única pessoa exerce ambos os papéis — por isso permissões e telas não devem assumir rigidamente uma separação de equipes.

## 4. Problema

Hoje a produção de conteúdo jurídico estruturado para o Vinculex é feita de forma essencialmente manual:

1. Um editor acessa a página da lei no Planalto (ou outra fonte oficial), copia o HTML/texto e cola em um editor de texto genérico.
2. A hierarquia jurídica (capítulos, artigos, parágrafos, incisos, alíneas) é reconstruída manualmente, com formatação aplicada artigo por artigo.
3. Block IDs, quando usados, são digitados manualmente — sem verificação de duplicidade ou de aderência ao padrão semântico definido em `../architecture/BLOCK_ID_SPEC.md`.
4. O frontmatter é copiado de um arquivo anterior e editado à mão, com alto risco de campos desatualizados ou incompletos.
5. Não há verificação estrutural antes de considerar o arquivo "pronto": erros como um inciso sem parágrafo-pai, um artigo duplicado ou uma seção sem numeração só são percebidos quando um usuário do SaaS reporta o problema.
6. Quando a lei sofre alteração legislativa posterior, não existe um mecanismo sistemático de detecção — a atualização depende de alguém perceber a mudança e refazer parte do processo manual do zero.
7. Não há histórico de versões nem changelog: é difícil responder "o que mudou entre a versão publicada em janeiro e a de junho".

**Custos desse processo:**

- **Tempo:** uma lei de porte médio (100–300 artigos, ex.: CTB, ECA) leva de um a três dias de trabalho manual; leis extensas (CP, CPPM, Lei 14.133) podem levar mais de uma semana.
- **Erros de fidelidade:** transcrição manual introduz risco de erro de digitação, omissão de dispositivo ou quebra de hierarquia, que é especialmente grave em um produto cujo diferencial é a exatidão jurídica.
- **Erros de Block ID:** IDs digitados manualmente têm risco de colisão (dois dispositivos diferentes com o mesmo ID) ou de inconsistência de padrão (ex.: `-inciso-` em vez de `-inc-`), o que quebra a promessa de estabilidade de links no Obsidian.
- **Falta de escala:** o processo manual não escala para o volume de legislação necessário para cobrir o roadmap de concursos (CFO/PMMG, CP, CPP, CF/88, Administrativo, Constitucional, ECA, CTB, Lei 14.133) em prazo competitivo.
- **Risco de publicação de conteúdo desatualizado:** sem worker de monitoramento, uma alteração legislativa pode passar despercebida por meses, e o SaaS continuaria servindo texto revogado como se fosse vigente.

O Lex Editor existe para eliminar esses custos automatizando as etapas mecânicas do processo (extração, parsing, geração de ID, formatação, validação estrutural, detecção de mudança) e concentrando o esforço humano exclusivamente na revisão jurídica de alto valor.

## 5. Escopo

O Lex Editor cobre integralmente o pipeline entre a fonte oficial de uma lei e sua publicação para o Vinculex SaaS:

- **Importação**: por URL de fonte oficial suportada ou por arquivo local
  (HTML, Markdown ou texto); para o Planalto, preserva a página anotada/completa
  e também a compilada quando disponível, como artefatos separados.
- **Aquisição e extração**: preservação do artefato bruto imutável com SHA-256 e produção, pelo Defuddle, de uma projeção em Markdown limpo.
- **Parser**: reconhecimento da estrutura jurídica, incluindo pena, anexo e tabela suportada, e produção de `ParsedNormaAST` rastreável.
- **NormaAST**: contrato intermediário validado em duas fases, `ParsedNormaAST` e `IdentifiedNormaAST`.
- **Geração e reconciliação de Block IDs**: cálculo determinístico na primeira publicação; nas atualizações, reutilização do registro histórico e verificação de unicidade contra todo o namespace reservado.
- **Formatter Markdown/Obsidian**: geração do arquivo `.md` final, incluindo frontmatter e lista indentada hierárquica.
- **Projeções de conteúdo**: geração, a partir da mesma NormaAST aprovada, do
  Markdown completo com histórico ou de uma saída somente com texto vigente,
  conforme a ADR-012.
- **Referências jurídicas**: análise de remissões internas e entre leis,
  resolução por identidade canônica e Block ID, preview do bloco ao hover/foco
  e navegação ao alvo, conforme a ADR-013.
- **Preview**: visualização dentro do app do resultado como ele apareceria no Obsidian.
- **Validação estrutural**: checagem de integridade antes de permitir exportação/publicação.
- **Exportação**: arquivo `.md` único ou pacote em lote de múltiplas leis.
- **Versionamento**: commits Git como fonte canônica, com numeração de versão e changelog (`UPDATE.md`).
- **Publicação**: release candidate no Git seguido de revalidação, promoção e sync transacional pelo Serviço de Publicação.
- **Revisão de atualização legislativa**: exibição de diffs gerados pelo worker de monitoramento e fluxo de aprovação/rejeição pelo editor.
- **Logs e auditoria**: registro pesquisável de todas as etapas acima.

## 6. Fora do Escopo

- Autenticação pública, cadastro de usuários finais, planos e cobrança — pertencem ao Vinculex SaaS.
- Funcionalidades de consumo do SaaS: favoritos, anotações de usuário, busca voltada ao estudante, trilhas de estudo, flashcards, simulados.
- Qualquer interface pública ou multiusuário externo — o Lex Editor é usado apenas pela equipe interna (Editor Jurídico e Administrador Técnico/Mantenedor do Acervo).
- Geração de conteúdo jurídico original (resumos, doutrina, jurisprudência comentada) — o Lex Editor trabalha exclusivamente com o texto legal oficial e seus metadados estruturais.
- Tradução ou suporte a legislação de outros países.
- Mecanismos de pagamento, faturamento ou gestão de assinatura, mesmo que indiretamente relacionados ao Vinculex SaaS.
- Infraestrutura de hospedagem do Vinculex SaaS em si (o Lex Editor apenas publica dados nela).

## 7. Casos de Uso

| ID | Caso de uso |
|---|---|
| CU-01 | Como Editor Jurídico, quero importar uma lei a partir de uma URL do Planalto, para não precisar copiar e colar o texto manualmente. |
| CU-02 | Como Editor Jurídico, quero importar um arquivo local (HTML ou Markdown) de uma lei, para lidar com fontes que não têm URL pública estável (ex.: diário oficial digitalizado). |
| CU-03 | Como Editor Jurídico, quero que o parser reconheça automaticamente a hierarquia da lei (livro, título, capítulo, seção, artigo, parágrafo, inciso, alínea, item), para não montar essa estrutura manualmente. |
| CU-04 | Como Editor Jurídico, quero que cada dispositivo receba automaticamente um Block ID semântico, para garantir que links e anotações no Obsidian permaneçam estáveis mesmo após atualizações futuras. |
| CU-05 | Como Administrador Técnico, quero que o sistema detecte e impeça colisões de Block ID antes da publicação, para preservar a garantia de unicidade e imutabilidade dos IDs. |
| CU-06 | Como Editor Jurídico, quero visualizar um preview fiel ao resultado no Obsidian antes de publicar, para revisar a formatação sem sair do Lex Editor. |
| CU-07 | Como Editor Jurídico, quero que dispositivos revogados ou vetados sejam sinalizados visualmente no preview, para não confundir texto vigente com texto sem efeito. |
| CU-08 | Como Editor Jurídico, quero exportar o Markdown final de uma lei como arquivo único, para conferência offline ou uso fora do pipeline de publicação. |
| CU-09 | Como Administrador Técnico, quero exportar um pacote em lote com várias leis, para migrações ou backups fora do Git. |
| CU-10 | Como Editor Jurídico, quero que a validação estrutural rode automaticamente antes de eu conseguir publicar, para não publicar uma lei com hierarquia quebrada ou frontmatter incompleto. |
| CU-11 | Como Editor Jurídico, quero solicitar a publicação de uma lei aprovada com um clique, para que candidate, revalidação, promoção e sync ocorram sem operações técnicas manuais. |
| CU-12 | Como Editor Jurídico, quero revisar o diff gerado pelo worker quando uma lei já publicada sofre alteração legislativa, para decidir se aprovo ou rejeito a nova versão. |
| CU-13 | Como Administrador Técnico, quero configurar novas fontes de importação (novo domínio, novo formato), para expandir a cobertura de legislação sem alterar código a cada nova fonte. |
| CU-14 | Como Administrador Técnico, quero consultar o histórico de versões de uma lei e reverter uma publicação problemática, para corrigir rapidamente um erro identificado após publicação. |
| CU-15 | Como Editor Jurídico, quero editar manualmente o frontmatter de uma lei antes de publicar, para corrigir metadados que o parser não conseguiu inferir com segurança. |
| CU-16 | Como Administrador Técnico, quero consultar logs de importação, parsing, validação e publicação de forma pesquisável, para diagnosticar falhas sem precisar reproduzir o problema do zero. |
| CU-17 | Como Editor Jurídico, quero que o sistema gere automaticamente o `UPDATE.md` a cada publicação, para manter um changelog legível sem esforço manual adicional. |
| CU-18 | Como Editor Jurídico, quero alternar o preview e a exportação entre a lei completa, com histórico e tachados oficiais, e somente o texto vigente, para atender auditoria e leitura corrente sem manter duas versões editáveis. |
| CU-19 | Como leitor/editor, quero pré-visualizar uma remissão e abrir diretamente o dispositivo da própria lei ou de outra lei importada, para consultar o fundamento sem perder o contexto de leitura. |

## 8. Fluxos do Editor

Esta seção resume, em alto nível, os fluxos operacionais principais do Lex Editor. O detalhamento passo a passo de cada tela, estado e transição está em `./USER_FLOWS.md`; o sequenciamento de entregas por fase está em `./ROADMAP.md`.

**Fluxo 1 — Importação e primeira publicação de uma lei nova**
Importar (URL ou arquivo) → preservar o conjunto de artefatos brutos e seus
SHA-256 → Defuddle produz Markdown limpo → adaptador gera `ParsedNormaAST` com
rastreabilidade → validar → reconciliar Block IDs → obter
`IdentifiedNormaAST` → Formatter gera Markdown/Obsidian completo por padrão e
analisador resolve referências jurídicas por catálogo + Block ID → Formatter
gera Markdown/Obsidian completo por padrão e permite a projeção somente vigente
no preview/exportação → editor revisa e
corrige pontos assinalados → validação final → exportação opcional → aprovação
→ release candidate → publicação server-side.

**Fluxo 2 — Atualização legislativa de lei já publicada**
Worker detecta divergência normativa ou do snapshot da fonte oficial → reprocessa e reconcilia a candidata → gera diff estrutural por dispositivo → Lex Editor exibe notificação de atualização pendente → editor abre o diff lado a lado (versão publicada vs. candidata) → editor aprova (dispara nova publicação com novo commit e `UPDATE.md`) ou rejeita (mantém versão publicada e registra a rejeição com motivo).

**Fluxo 3 — Correção pós-publicação (rollback)**
Administrador Técnico identifica problema → seleciona uma versão anterior e
justifica → sistema exibe o diff → se houver mudança normativa, Editor Jurídico
aprova → snapshot escolhido vira nova publicação com novo SemVer,
`numero_publicacao`, release commit, sync transacional e entrada em `UPDATE.md`.

**Fluxo 4 — Configuração de nova fonte de importação**
Administrador Técnico cadastra domínio/formato da nova fonte → define regras de detecção automática de fonte → testa importação de amostra → valida se o parser reconhece a estrutura corretamente → fonte fica disponível para uso por Editores Jurídicos.

## 9. Arquitetura

O Lex Editor é um aplicativo Electron com processo principal (Node.js) e processo renderer (React + TypeScript via Vite). A arquitetura interna é organizada em camadas, cada uma com responsabilidade única no pipeline:

```
┌───────────────────────────────────────────────────────────────┐
│                      UI / React (renderer)                     │
│  Telas: Importação, Preview, Diff/Atualização, Publicação,     │
│  Configuração de Fontes, Logs/Auditoria                        │
│  React Hook Form + Zod (formulários) · TanStack Query (dados)  │
└───────────────────────────┬─────────────────────────────────────┘
                             │ IPC (contextBridge / invoke-handle)
┌───────────────────────────┴─────────────────────────────────────┐
│                    Serviços (processo principal)                │
│  ImportService · ValidationService · PublishService ·           │
│  UpdateWorkerClient · SourceConfigService · AuditLogService      │
└───────────────┬───────────────────────────┬─────────────────────┘
                │                           │
┌───────────────┴───────────────┐ ┌─────────┴─────────────────────┐
│   Defuddle (extração)          │ │ Git candidato / Publisher API  │
│   HTML bruto → Markdown limpo  │ │ sem secret administrativa local │
└───────────────┬───────────────┘ └────────────────────────────────┘
                │
┌───────────────┴───────────────┐
│           Parser               │
│  Planalto · LexML · Markdown · │
│  arquivo local (plugins)       │
└───────────────┬───────────────┘
                │
┌───────────────┴───────────────┐
│          NormaAST              │
│  árvore normativa intermediária│
└───────────────┬───────────────┘
                │
┌───────────────┴───────────────┐
│    Block ID Generator          │
│  geração inicial + reconciliação│
│  histórica e de colisão         │
└───────────────┬───────────────┘
                │
┌───────────────┴───────────────┐
│    Markdown Formatter          │
│  lista indentada + frontmatter │
│  + callouts institucionais     │
└────────────────────────────────┘
```

- **UI/React**: telas de importação, preview, revisão de diff de atualização legislativa, publicação, configuração de fontes e consulta de logs. Formulários (URL de importação, edição de frontmatter, configuração de fonte) usam React Hook Form + Zod. Consultas assíncronas de pendências e do estado server-side da publicação usam TanStack Query; o renderer não chama Git, Supabase ou worker diretamente.
- **Serviços**: camada no processo principal que orquestra o pipeline, expõe
  capacidades mínimas ao renderer e concentra filesystem, fetch e Git
  candidato. O processo principal chama a API autenticada do Serviço de
  Publicação, mas não possui cliente administrativo nem secret do Supabase.
- **Parser**: recebe os artefatos adequados à fonte e produz `ParsedNormaAST`, com estratégia modular por fonte/código legal (ver capítulo 11).
- **NormaAST**: modelo intermediário independente de origem; o reconciliador transforma a fase `parsed` na fase `identified`.
- **Formatter**: aceita somente `IdentifiedNormaAST` validada e gera Markdown final compatível com Obsidian, incluindo frontmatter.
- **Publicação**: a estação cria e envia somente o release candidate; a
  integração com o branch canônico e o Supabase pertence ao Serviço de
  Publicação, acionado após validação estrutural e aprovação humana.

A visão de arquitetura de todo o ecossistema Vinculex (incluindo como o Lex Editor se relaciona com o worker de atualização legislativa, o repositório Git e o Supabase do SaaS) está detalhada em `../architecture/SYSTEM_ARCHITECTURE.md`.

## 10. NormaAST

NormaAST é a árvore normativa intermediária que representa qualquer norma jurídica de forma independente da fonte de origem (HTML do Planalto, LexML, Markdown ou arquivo local). É o contrato central do domínio: cada adaptador produz uma `ParsedNormaAST`; validação e reconciliação produzem uma `IdentifiedNormaAST`, que habilita formatação e publicação.

Tipos de nó reconhecidos:

- **Norma** (raiz): metadados gerais da lei (tipo, número, ano, ementa).
- **Livro**, **Título**, **Capítulo**, **Seção**, **Subseção**: nós de divisão estrutural, aninháveis conforme a hierarquia real da lei (nem toda lei usa todos os níveis).
- **Artigo**: unidade central de conteúdo normativo.
- **Parágrafo** (incluindo parágrafo único): subdivisão do artigo.
- **Inciso**: subdivisão numerada em algarismos romanos.
- **Alínea**: subdivisão em letras, filha de inciso.
- **Item**: subdivisão numerada em algarismos arábicos, filha de alínea (uso mais raro, presente por exemplo em partes da Lei 14.133).
- **Pena**: linha de pena autônoma vinculada ao dispositivo que a comina.
- **Anexo** e **Tabela**: estruturas oficiais suportadas quando sua forma é
  determinística e validável.
- **Dispositivo revogado**: marcação de estado aplicável a qualquer nó acima, preservando o texto original e a informação da norma revogadora.
- **Dispositivo vetado**: marcação de estado equivalente, com referência à razão do veto quando disponível na fonte oficial.
- **Intervalo de artigos por divisão**: dado derivado dos filhos da divisão,
  não um tipo de nó ou metadado duplicado.

Cada nó carrega tipo, conteúdo, posição, `deviceStatus`, `sourceRef` e
`parseEvidence`. O Parser produz `ParsedNormaAST`; o reconciliador produz
`IdentifiedNormaAST`, única fase aceita pelo Formatter. O contrato completo
está em `../architecture/DATA_MODEL.md`.

## 11. Parser

O parser é responsável por transformar os artefatos de origem em
`ParsedNormaAST`. No adaptador Planalto ele recebe o conjunto de snapshots
brutos e as projeções limpas do Defuddle. O texto oficial compilado é preferido
para a redação vigente; a página anotada preserva evidência histórica. A
precedência completa está na
`../architecture/ADR-009-fontes-compiladas-e-historicas.md`.

**Fontes suportadas:**

- **Planalto (HTML)**: fonte primária para a maior parte da legislação federal
  (CF/88, CP, CPP, ECA, CTB, Lei 14.133 e correlatas). Quando disponíveis, a
  página compilada fornece o texto vigente e a página anotada fornece o
  histórico; cada uma mantém snapshot e proveniência próprios.
- **LexML**: fonte posterior ao MVP inicial, usada como parser adicional e
  checagem cruzada depois que o Planalto estiver validado de ponta a ponta.
- **Markdown**: entrada direta de Markdown já semi-estruturado (ex.: reimportação de conteúdo já processado, ou fontes que fornecem Markdown nativamente).
- **Arquivo local**: HTML, Markdown ou texto fornecido manualmente pelo editor, para casos em que não há URL pública estável (diários oficiais digitalizados, cópias de segurança).

**Detecção automática de fonte:** o parser identifica o tipo de fonte a partir da URL (domínio conhecido, ex. `planalto.gov.br`, `lexml.gov.br`) ou, no caso de arquivo local, a partir de heurísticas sobre o conteúdo (presença de marcação LexML, estrutura típica de HTML do Planalto, ou Markdown já formatado). Cada fonte é implementada como um módulo plugável, permitindo adicionar suporte a novas fontes sem alterar o núcleo do parser (ver RNF de modularidade, capítulo 20).

**Estratégia de reconhecimento de dispositivos:** o parser aplica uma combinação de regras de padrão textual (ex.: `Art\. \d+`, `§\s*\d+`, algarismos romanos seguidos de hífen para incisos, letras seguidas de fecha-parêntese para alíneas) e de análise de indentação/estrutura de lista quando a fonte já chega semiestruturada (Markdown pós-Defuddle). A hierarquia de divisões (livro > título > capítulo > seção > subseção) é reconstruída a partir de cabeçalhos e de âncoras de navegação presentes na fonte, quando existentes, com fallback para inferência por proximidade textual quando a fonte não expõe essa estrutura de forma explícita.

**Tratamento de casos especiais:**

- **Dispositivo revogado**: o parser reconhece marcadores textuais típicos da
  fonte oficial e marca o nó correspondente com `deviceStatus: 'revoked'`,
  preservando o texto histórico e a referência à norma revogadora. Ausência na
  página compilada, sem evidência oficial complementar, não prova revogação.
- **Dispositivo vetado**: reconhecido por marcadores como "(VETADO)" ou notas de rodapé oficiais de veto; o nó é marcado com `deviceStatus: 'vetoed'` e, quando disponível na fonte, a mensagem de veto é preservada como metadado.
- **Redação dada por lei posterior**: quando a fonte indica "(Redação dada pela Lei nº ...)", o parser preserva essa informação como metadado do nó (histórico de redação), sem afetar o Block ID do dispositivo — o ID identifica a posição jurídica, não a redação vigente.
- **Ambiguidade estrutural**: o nó recebe `parseEvidence.confidence = 'low'`,
  razões tipadas e `requiresHumanReview = true`. Não existe pseudo-status
  `pendente-revisao`; revisão é evidência operacional, não `deviceStatus`.

## 12. Defuddle

O Defuddle atua como etapa de pré-processamento, antes do parser jurídico: sua responsabilidade é converter o HTML bruto de uma página de origem em Markdown limpo, removendo elementos de navegação, scripts, estilos inline, propaganda, cabeçalhos/rodapés de portal e qualquer marcação que não carregue conteúdo normativo.

O Defuddle não é parser jurídico nem substitui o artefato original. Cada
adaptador decide quais sinais usa: o parser do Planalto pode consultar HTML
bruto e Markdown limpo; um futuro parser LexML usa o XML original. O núcleo da
NormaAST permanece desacoplado desses formatos.

**Limitações conhecidas e quando falha:**

- **Páginas dinâmicas (JavaScript-rendered)**: o Defuddle opera sobre o HTML estático recebido; páginas que renderizam o conteúdo da lei via JavaScript no client-side podem retornar Markdown vazio ou incompleto. Nesses casos, a importação por URL falha e o Lex Editor deve orientar o editor a usar importação por arquivo local (salvando o HTML já renderizado do navegador).
- **HTML malformado ou com tabelas complexas**: leis com tabelas (ex.: tabelas de infrações do CTB, tabelas de valores da Lei 14.133) podem ser extraídas de forma imprecisa; o resultado precisa ser conferido no preview antes da publicação.
- **Múltiplas versões na mesma página**: páginas anotadas do Planalto podem
  misturar redação vigente, texto superado e notas extensas. O adaptador usa a
  página compilada quando disponível e exige revisão quando as fontes
  divergem ou não permitem separar as redações com confiança.
- **Falha silenciosa de estrutura**: o Defuddle otimiza para legibilidade geral de artigo, não para hierarquia jurídica; cabeçalhos de capítulo/seção podem ser "achatados" no Markdown resultante, exigindo que o parser jurídico (não o Defuddle) reconstrua essa hierarquia por outras heurísticas.

Quando o Defuddle falha ou produz uma saída de baixa confiança, o Lex Editor sinaliza a falha explicitamente na UI (nunca publica um resultado degradado sem aviso) e oferece como alternativa a importação manual por arquivo local ou colagem direta de Markdown.

## 13. Block IDs

Cada dispositivo legal reconhecido pelo parser recebe um Block ID semântico e
imutável. Na primeira publicação, ele é calculado deterministicamente a partir
da posição hierárquica — nunca do texto. Depois de publicado, o Git e o
registro histórico tornam-se autoritativos: o Lex Editor reconcilia a árvore
candidata com a versão anterior e reutiliza IDs existentes. O valor canônico é
armazenado sem `^`; o Formatter acrescenta o prefixo somente na âncora
Obsidian.

Exemplos:

| Dispositivo | Block ID |
|---|---|
| CF/88, art. 5º, inciso LVII | `cf1988-art-5-inc-lvii` |
| CP, art. 121, § 2º, inciso VIII | `cp-art-121-par-2-inc-viii` |
| CPPM, art. 296, § 1º | `cppm-art-296-par-1` |
| Lei 14.133 (NLLC), art. 1º, § 3º, inciso II, alínea b | `nllc-art-1-par-3-inc-ii-ali-b` |
| ECA, art. 4º, parágrafo único | `eca-art-4-par-unico` |
| CTB, art. 165, inciso I | `ctb-art-165-inc-i` |

O reconciliador/gerador de Block IDs faz parte do pipeline
`Parser → ParsedNormaAST → validação → reconciliador → IdentifiedNormaAST → Formatter`
e roda automaticamente após o parsing. Na
primeira publicação, colisões entre dispositivos inéditos são resolvidas por
qualificação estrutural de todos os conflitantes. Em atualizações, IDs
publicados nunca são renomeados: somente o dispositivo novo é qualificado. Uma
colisão que não possa ser resolvida semanticamente bloqueia a publicação e
exige decisão editorial — ver RF-09 e capítulo 21.

A especificação formal completa do formato de Block ID (regras de abreviação de sigla por código legal, tratamento de artigos com letras — ex. "art. 5º-A" —, tratamento de revogação e numeração de itens) está em `../architecture/BLOCK_ID_SPEC.md`; este PRD não a duplica.

## 14. Markdown Formatter

O Formatter aceita exclusivamente `IdentifiedNormaAST` e produz o Markdown
final. Divisões estruturais viram headings; artigo, parágrafo, inciso, alínea,
item, pena e tabela viram itens de lista referenciáveis; anexos usam heading
próprio com Block ID.

Callouts são usados **apenas no cabeçalho do arquivo**, nunca por artigo: aviso de fonte oficial, aviso de última atualização, observação de segurança jurídica (ex.: alerta de dispositivo com eficácia suspensa por decisão judicial, quando aplicável) e notas editoriais gerais sobre a norma como um todo.

Exemplo de saída (trecho do Código Penal):

```markdown
- Art. 121. Matar alguém. ^cp-art-121
  - § 1º Se o agente comete o crime impelido por motivo de relevante valor social ou moral, ou sob o domínio de violenta emoção, logo em seguida a injusta provocação da vítima, o juiz pode reduzir a pena de um sexto a um terço. ^cp-art-121-par-1
  - § 2º Se o homicídio é cometido: ^cp-art-121-par-2
    - I - mediante paga ou promessa de recompensa, ou por outro motivo torpe; ^cp-art-121-par-2-inc-i
    - II - por motivo fútil; ^cp-art-121-par-2-inc-ii
```

O Formatter também é responsável por sinalizar visualmente, dentro da própria lista, dispositivos revogados ou vetados (ex.: marcação de estado e nota de referência à norma revogadora, sem remover o texto histórico), conforme regra de negócio inegociável de que revogação/veto deve ser sinalizado tanto no texto quanto nos metadados.

A especificação formal completa do formato Markdown (regras de indentação, uso de callouts, tratamento de tabelas, convenções de heading) está em `../architecture/MARKDOWN_SPEC.md`; este PRD apresenta apenas a visão geral necessária para o contexto do produto.

## 15. Frontmatter

Todo arquivo `.md` de lei gerado pelo Lex Editor carrega frontmatter YAML com, no mínimo, os campos abaixo:

| Campo | Tipo | Exemplo |
|---|---|---|
| `title` | string | `"Código Penal"` |
| `sigla` | string | `"cp"` |
| `tipo` | string (enum) | `"decreto-lei"` |
| `numero` | string | `"2.848"` |
| `ano` | number | `1940` |
| `ramo` | string | `"penal"` |
| `fonte` | string (URL) | `"https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm"` |
| `data_publicacao` | date (ISO 8601) | `1940-12-07` |
| `data_atualizacao_legal` | date (ISO 8601) | `2024-11-15` |
| `data_formatacao_vinculex` | date (ISO 8601) | `2026-07-01` |
| `total_artigos` | number | `361` |
| `versao_vinculex` | string (semver) | `"1.3.0"` |
| `legal_status` | string (enum) | `"vigente"` |

O campo `legal_status` reflete apenas a vigência jurídica da lei (`vigente`, `revogada`, `alterada`, `suspensa`, `sem_eficacia`, `desconhecida`); o fluxo editorial de publicação (`publication_status` no banco, `publicationStatus` na NormaAST) e o estado de cada dispositivo individual (`device_status` no banco, `deviceStatus` na NormaAST) são campos distintos e não vivem no frontmatter — ver `../architecture/ADR-005-status-fields.md`.

O Lex Editor pré-preenche automaticamente os campos que o parser consegue inferir com segurança a partir da fonte (`title`, `sigla`, `tipo`, `numero`, `ano`, `fonte`, `data_publicacao`, `total_artigos`) e deixa explícitos para revisão manual os campos que dependem de julgamento editorial (`ramo`, `legal_status`) ou de contexto de publicação (`data_formatacao_vinculex`, `versao_vinculex`, calculados no momento da publicação). O formulário de edição de frontmatter usa React Hook Form + Zod para validar tipos, formatos de data e valores permitidos de enum antes de liberar a publicação.

O schema completo de frontmatter (campos adicionais opcionais, enums permitidos para `tipo` e `legal_status`, regras de compatibilidade com versões anteriores do schema) está especificado em `../architecture/MARKDOWN_SPEC.md`.

## 16. Versionamento

O Git é a fonte canônica do conteúdo produzido pelo Lex Editor — não o Supabase Storage. Essa escolha garante histórico completo, diff textual entre versões, possibilidade de rollback e revisão por pull request, conforme decisão registrada em `../architecture/ADR-003-versionamento-git.md`.

**Estratégia de branches e commits:**

- Cada lei vive em um caminho estável dentro do repositório privado (ex.: `leis/codigo-penal/cp.md`), preservando o mesmo caminho entre versões para que o histórico Git seja contínuo.
- Publicações de conteúdo novo (primeira publicação de uma lei) e publicações de atualização (aprovação de diff do worker) geram commits distintos e identificáveis, com mensagem de commit padronizada (ex.: `publish(cp): primeira publicação` ou `update(cp): redação do art. 121, §2º alterada pela Lei nº 14.994/2024`).
- A estação envia cada release commit somente para
  `releases/{publicationId}`. Após validação server-side, o Serviço de
  Publicação promove o mesmo SHA ao branch canônico protegido.
- O branch canônico contém apenas conteúdo aprovado e pode ficar
  temporariamente à frente do Supabase quando o sync falha. Nesse estado a UI
  mostra “push concluído, sincronização pendente”; nunca afirma que a versão já
  está publicada no SaaS.

**Numeração de versão:** cada lei carrega `versao_vinculex` em SemVer
`MAJOR.MINOR.PATCH`, sem prefixo `v` no frontmatter ou banco. A primeira
publicação é `1.0.0`. `MAJOR` indica mudança incompatível do contrato de
representação; `MINOR`, qualquer mudança da projeção normativa; `PATCH`,
correção de metadado, formatação ou evidência sem mudança normativa. Toda
publicação bem-sucedida também recebe `numero_publicacao` monotônico. Versões
nunca são reutilizadas, reduzidas ou inferidas por ordenação textual.

## 17. UPDATE.md

A cada publicação, inclusive a inicial, o Lex Editor gera ou atualiza
`leis/<diretorio-da-lei>/UPDATE.md`. Ele é o único changelog canônico da lei,
usa entradas em ordem decrescente de `numero_publicacao` e integra o mesmo
release commit do Markdown. Não existe `CHANGELOG.md` paralelo.

**Conteúdo mínimo de cada entrada:**

- Data da publicação.
- Versão (`versao_vinculex`) resultante.
- Número monotônico da publicação.
- Tipo de publicação: primeira publicação, atualização legislativa aprovada, correção editorial ou rollback.
- Resumo em linguagem natural do que mudou (ex.: "§ 2º do art. 121 recebeu novo inciso IX pela Lei nº 14.994/2024").
- Lista de Block IDs afetados.
- Referência à norma alteradora, quando aplicável (número, tipo e data da lei/decreto que motivou a alteração).
- Atribuição pública genérica (`Equipe editorial Vinculex`) ou identificador
  editorial não pessoal. O `user_id` real do aprovador permanece apenas na
  auditoria privada.

Exemplo de entrada:

```markdown
## [1.4.0] - 2026-07-01
### Atualização legislativa aprovada
- Publicação: 7
- Fonte da alteração: Lei nº 15.201/2026
- Dispositivos afetados: `^cp-art-121-par-2-inc-ix` (novo inciso)
- Resumo: adicionado o inciso IX ao § 2º do art. 121, tipificando nova qualificadora.
- Aprovado por: Equipe editorial Vinculex
```

O `UPDATE.md` é gerado automaticamente pelo `PublishService` a partir dos
metadados da publicação. O editor pode complementar o resumo antes da
confirmação; após ela, a entrada fica congelada no manifesto. Rollback inclui
obrigatoriamente a versão restaurada e a justificativa.

## 18. Publicação

O fluxo de publicação é sempre: **validação aprovada → fixação da versão →
geração do Markdown + `UPDATE.md` + manifesto → aprovação server-side do
digest → release candidate → validação/promoção pelo Serviço de Publicação →
sincronização transacional → ativação do ponteiro público**.

**Quem aprova:** o Editor Jurídico é responsável por aprovar a publicação de conteúdo (primeira publicação ou atualização legislativa). O Administrador Técnico/Mantenedor do Acervo pode publicar em nome do fluxo técnico (ex.: correções de infraestrutura que não alteram texto legal), mas alterações de conteúdo normativo sempre exigem aprovação de um Editor Jurídico, mesmo que a mesma pessoa acumule os dois papéis.

**Sequência técnica:**

1. `ValidationService` valida a `IdentifiedNormaAST`; erro bloqueante encerra o
   fluxo antes de criar artefatos de release.
2. `PublishService` fixa SemVer, `numero_publicacao`, tipo de publicação e uma
   chave de idempotência; gera Markdown, entrada do `UPDATE.md` e manifesto com
   hashes e commit-base esperado.
3. A confirmação final registra no servidor o aprovador, papel, timestamp e
   digest. Os três artefatos entram no mesmo release commit, enviado pela
   estação apenas ao branch candidato `releases/{publicationId}`.
4. O Serviço de Publicação busca o SHA no Git, revalida aprovação, manifesto,
   paths, hashes, base e permissões e promove exatamente esse SHA ao branch
   protegido.
5. O mesmo serviço executa a função privada que, em uma única transação, cria
   `versoes_lei`, persiste o snapshot completo, registra IDs/redirecionamentos
   e troca `leis.versao_publicada_id`.
6. Somente após o commit da transação a UI mostra “publicado”. A decisão
   editorial já está `approved`; nesse momento a versão é vinculada à
   pendência e o hash de referência avança. Falhas
   preservam o diário da publicação e são retomadas com a mesma chave, versão,
   manifesto e SHA.

O Electron nunca possui secret administrativa do Supabase, credencial do
branch protegido ou acesso direto às tabelas normativas de produção. Ver
`../architecture/ADR-007-fronteira-segura-publicacao.md`.

**Rollback:** o Administrador Técnico seleciona uma `versoes_lei` anterior e
informa justificativa. O sistema restaura seu snapshot como nova
`IdentifiedNormaAST`, calcula o diff contra a versão corrente e executa o mesmo
pipeline como `tipo_publicacao = 'rollback'`, com novo SemVer, novo
`numero_publicacao`, novo release commit e `restaura_versao_id`. Nunca há
reescrita do Git nem simples troca do Supabase para uma versão histórica.

## 19. Requisitos Funcionais

| ID | Título | Descrição | Critério de aceite |
|---|---|---|---|
| RF-01 | Importação por URL | O sistema deve permitir que o editor informe a URL de uma lei em fonte oficial suportada e inicie a importação automaticamente, disparando extração via Defuddle e parsing subsequente. | Ao submeter uma URL válida de fonte suportada, o sistema exibe progresso da importação e, ao final, apresenta o preview do resultado sem intervenção manual adicional. |
| RF-02 | Importação de arquivo local | O sistema deve permitir importar uma lei a partir de um arquivo local (HTML, Markdown ou texto), para fontes sem URL pública estável. | Ao selecionar um arquivo local válido, o sistema processa o conteúdo pelo mesmo pipeline de parsing usado na importação por URL e apresenta o preview correspondente. |
| RF-03 | Detecção automática de fonte | O sistema deve identificar automaticamente o tipo de fonte (Planalto, LexML, Markdown, arquivo local genérico) a partir da URL ou do conteúdo, selecionando o módulo de parser adequado sem exigir escolha manual do editor no caso comum. | Para uma URL de domínio conhecido (ex. planalto.gov.br), o sistema seleciona o parser correto sem prompt adicional; para fontes ambíguas, o sistema pergunta ao editor antes de prosseguir. |
| RF-04 | Parsing de fonte → `ParsedNormaAST` | O adaptador deve converter os artefatos adequados à fonte em árvore validada, preservando rastreabilidade por nó. | Para o CP, `ParsedNormaASTSchema` aceita a árvore, 100% dos artigos estão na ordem e cada nó resolve para o snapshot original. |
| RF-05 | Reconhecimento de todos os níveis hierárquicos | O parser deve reconhecer livro, título, capítulo, seção, subseção, artigo, parágrafo, inciso, alínea, item, pena, anexo e tabela quando presentes. | Testes cobrem ao menos um exemplo real de cada tipo e validam o resultado com `ParsedNormaASTSchema`. |
| RF-06 | Tratamento de dispositivo revogado | O parser deve identificar marcadores de revogação na fonte oficial e marcar o nó correspondente com `deviceStatus: 'revoked'`, preservando o texto original e a referência à norma revogadora. | Um dispositivo revogado de teste é importado com `deviceStatus: 'revoked'` corretamente atribuído e sinalizado visualmente no preview, sem perda do texto histórico. |
| RF-07 | Tratamento de dispositivo vetado | O parser deve identificar marcadores de veto e marcar o nó correspondente com `deviceStatus: 'vetoed'`, preservando a mensagem de veto quando disponível na fonte. | Um dispositivo vetado de teste é importado com `deviceStatus: 'vetoed'` corretamente atribuído e sinalizado visualmente no preview. |
| RF-08 | Geração de Block IDs | O sistema deve gerar automaticamente um Block ID semântico para cada dispositivo do NormaAST, seguindo o padrão definido em `../architecture/BLOCK_ID_SPEC.md`. | 100% dos dispositivos de uma lei de teste recebem Block ID válido, sem necessidade de digitação manual pelo editor. |
| RF-09 | Detecção e prevenção de colisão de Block ID | O sistema deve validar candidatos contra a árvore atual, o registro histórico e os aliases; aplicar somente a qualificação estrutural permitida pela spec e bloquear colisões não resolvíveis semanticamente. | Ao introduzir um dispositivo novo cujo candidato simples já foi publicado, o ID antigo permanece byte a byte e apenas o novo é qualificado; uma colisão sem qualificação possível bloqueia a publicação e identifica os nós em conflito. |
| RF-10 | Geração de Markdown formatado | O sistema deve gerar o arquivo Markdown final em lista indentada hierárquica compatível com Obsidian, a partir do NormaAST com Block IDs atribuídos. | O Markdown gerado para uma lei de teste é aberto no Obsidian sem erros de renderização e preserva a hierarquia visual esperada. |
| RF-11 | Geração de frontmatter | O sistema deve gerar automaticamente o frontmatter YAML com todos os campos mínimos definidos no capítulo 15, pré-preenchendo os campos inferíveis da fonte. | O frontmatter gerado para uma lei de teste contém todos os 13 campos mínimos, com tipos e formatos válidos segundo o schema Zod correspondente. |
| RF-12 | Preview estilo Obsidian | O sistema deve exibir, dentro do próprio app, um preview do Markdown final que reproduza fielmente a renderização esperada no Obsidian (incluindo callouts de cabeçalho e lista indentada). | O preview exibido no Lex Editor é visualmente equivalente ao resultado real de abrir o mesmo arquivo no Obsidian, validado por comparação manual em pelo menos 3 leis de teste de portes diferentes. |
| RF-13 | Validação estrutural pré-publicação | O sistema deve executar validação estrutural completa (capítulo 21) e bloquear a publicação enquanto houver erro classificado como bloqueante. | Uma lei de teste com erro estrutural proposital (ex. inciso órfão) não pode ser publicada até o erro ser corrigido; o botão de publicar permanece desabilitado com motivo explícito. |
| RF-14 | Exportação de arquivo .md único | O sistema deve permitir exportar o Markdown final de uma lei como arquivo `.md` único para o sistema de arquivos local, independente do fluxo de publicação. | Ao exportar uma lei de teste, o arquivo `.md` resultante é idêntico ao conteúdo apresentado no preview. |
| RF-15 | Exportação em lote / pacote de leis | O sistema deve permitir selecionar múltiplas leis já processadas e exportá-las em um único pacote (ex. arquivo compactado) preservando a estrutura de pastas esperada pelo Obsidian. | Ao exportar um lote de 3 leis de teste, o pacote resultante contém os 3 arquivos `.md` corretos, cada um íntegro e com seu frontmatter. |
| RF-16 | Geração automática de UPDATE.md | O sistema deve gerar ou atualizar automaticamente o único `UPDATE.md` da lei em toda publicação, inclusive a inicial. | O `UPDATE.md` contém exatamente uma nova entrada com versão, `numero_publicacao`, tipo, resumo e Block IDs afetados e integra o mesmo release commit do Markdown. |
| RF-17 | Release candidate Git | A estação cria o release commit com Markdown, `UPDATE.md` e manifesto e o envia somente para `releases/{publicationId}`. | Credencial local não consegue escrever o branch protegido; retry reutiliza o mesmo SHA/chave. |
| RF-18 | Publicação server-side | O Serviço de Publicação revalida aprovação/manifesto, promove o SHA e sincroniza o snapshot completo de forma transacional e idempotente. | Manifesto adulterado ou base obsoleta é bloqueado; falha no sync não troca o ponteiro e retry cria uma única `versoes_lei`. |
| RF-19 | Histórico de versões e rollback | O sistema deve exibir o histórico por `numero_publicacao` e restaurar snapshot anterior como nova publicação para frente. | O rollback cria novo SemVer, release commit, `versoes_lei`, `restaura_versao_id` e entrada em `UPDATE.md`, sem reescrever Git/banco; mudança normativa exige aprovação jurídica. |
| RF-20 | Configuração de fontes de importação | O sistema deve permitir ao Administrador Técnico cadastrar e configurar novas fontes de importação (domínio, formato esperado, regras de detecção), sem necessidade de alteração de código para fontes compatíveis com os parsers existentes. | Uma nova fonte de teste, compatível com um parser já existente, pode ser cadastrada via UI e usada em uma importação de teste com sucesso. |
| RF-21 | Exibição de diff de atualização legislativa | O sistema deve exibir, de forma clara e lado a lado, o diff textual gerado pelo worker quando detecta divergência entre a fonte oficial e a versão publicada. | Para uma divergência de teste simulada, o diff exibido identifica corretamente os trechos alterados, adicionados e removidos, referenciando os Block IDs afetados. |
| RF-22 | Aprovação/rejeição de atualização pelo editor | O sistema deve permitir que o Editor Jurídico aprove (disparando nova publicação) ou rejeite (mantendo a versão atual, com motivo registrado) uma atualização legislativa detectada pelo worker. | Ao aprovar uma atualização de teste, uma nova publicação é criada conforme fluxo do capítulo 18; ao rejeitar, nenhuma alteração é publicada e o motivo da rejeição fica registrado em log. |
| RF-23 | Logs de auditoria pesquisáveis | O sistema deve registrar eventos de importação, parsing, validação e publicação em logs estruturados e pesquisáveis pela UI, filtráveis por lei, por tipo de evento e por período. | Um Administrador Técnico consegue localizar, em até 3 filtros, o log de uma publicação específica realizada em uma lei de teste. |
| RF-24 | Edição manual de frontmatter | O sistema deve permitir que o Editor Jurídico edite manualmente qualquer campo do frontmatter antes da publicação, com validação de tipo e formato em tempo real. | Ao editar um campo de frontmatter com valor inválido (ex. data mal formatada), o sistema exibe erro de validação e impede a submissão até a correção. |
| RF-25 | Referências jurídicas navegáveis | O sistema deve detectar remissões no texto canônico, resolver referências internas e a leis importadas por identidade + Block ID e oferecer preview por hover/foco e navegação por clique, sem alterar a NormaAST. | Na Lei nº 14.133/2021, `§ 3º deste artigo` no art. 1º, § 4º abre `nllc-art-1-par-3`, e `caput do art. 37 da Constituição Federal` no § 5º abre `cf1988-art-37`; alvo ausente permanece texto literal com diagnóstico. |

## 20. Requisitos Não Funcionais

| ID | Categoria | Descrição | Critério de aceite |
|---|---|---|---|
| RNF-01 | Performance | A importação e o parsing completo de uma lei de porte médio (até 300 artigos, ex. CTB, ECA) devem ser concluídos em até 30 segundos; leis de grande porte (CP, CPPM, Lei 14.133, acima de 300 artigos) em até 2 minutos, em hardware de referência de desenvolvimento (notebook padrão da equipe). | Testes de performance automatizados confirmam os tempos-alvo para pelo menos uma lei de cada faixa de porte. |
| RNF-02 | Offline | O parser e o preview devem funcionar sem conexão à internet para leis já importadas/localmente disponíveis; apenas importação por URL, envio do release candidate, solicitação/consulta da publicação server-side e verificação do worker exigem conectividade. | Com a rede desligada, é possível reabrir uma lei já importada, editar frontmatter e visualizar o preview sem erro. |
| RNF-03 | Modularidade do parser | O parser deve ser implementado como núcleo comum + plugins por fonte/código legal, permitindo adicionar suporte a uma nova fonte sem alterar a lógica de geração de NormaAST, Block ID ou Formatter. | Um novo plugin de fonte pode ser adicionado e testado isoladamente via Vitest, sem exigir alteração em módulos fora da pasta do parser. |
| RNF-04 | Cobertura de testes | O parser e o gerador de Block IDs devem manter cobertura mínima de 80% em testes unitários (Vitest); os fluxos críticos de importação, publicação e revisão de atualização devem ter cobertura E2E (Playwright) para o caminho feliz e para os principais caminhos de erro. | Relatório de cobertura do CI reporta ≥80% em `parser/` e `block-id/`; suíte Playwright cobre ao menos os fluxos 1, 2 e 3 do capítulo 8. |
| RNF-05 | Logs estruturados | Todos os logs do sistema devem seguir formato estruturado (JSON) com campos mínimos: timestamp, nível, módulo de origem, lei/entidade relacionada e mensagem, permitindo filtragem programática. | Uma amostra de log de cada categoria (importação, parsing, validação, publicação) contém todos os campos mínimos em formato JSON válido. |
| RNF-06 | Acessibilidade | A UI do Lex Editor deve seguir diretrizes WCAG 2.1 nível AA no que for aplicável a um app desktop Electron: navegação por teclado em todos os fluxos principais, contraste mínimo de texto, rótulos acessíveis em formulários. | Auditoria com ferramenta automatizada de acessibilidade (ex. axe) não reporta violações de nível crítico nas telas de importação, preview e publicação. |
| RNF-07 | Portabilidade | O Lex Editor deve rodar em Windows, macOS e Linux a partir da mesma base de código Electron, sem funcionalidades exclusivas de uma plataforma no caminho crítico do pipeline. | Build gerado a partir do mesmo código-fonte é executado com sucesso nos três sistemas operacionais, cobrindo o fluxo de importação até publicação em ambiente de teste. |
| RNF-08 | Resiliência de sincronização | Falha de sincronização com o Supabase não deve corromper nem reverter o commit Git já criado; o sistema deve permitir nova tentativa de sincronização sem reprocessar o parsing. | Ao simular indisponibilidade do Supabase durante a publicação, o commit Git é criado normalmente e a lei fica marcada como "pendente de sincronização", com opção de retry. |
| RNF-09 | Hardening Electron | Renderer roda com `contextIsolation`, sandbox e `webSecurity`; sem Node integration, navegação, popup, webview, código remoto ou rede direta. IPC valida frame/origem/schema/autorização. | Teste automatizado e inspeção do build confirmam preferências, CSP, fuses e rejeição de IPC forjado/XSS. |
| RNF-10 | Segredos e autoridade | Nenhuma secret administrativa do Supabase ou credencial do branch protegido existe no bundle, renderer, preload, processo principal, `.env` de produção ou logs. | Varredura do artefato e teste de permissões provam que a estação só envia branch candidato e não escreve banco/branch canônico. |
| RNF-11 | Entradas hostis | URL, redirects, DNS, resposta, arquivo e path são tratados como não confiáveis; SSRF, traversal, symlink escape, HTML executável e injeção de argumento são bloqueados. | Suíte negativa cobre loopback/redes privadas/metadata, redirect proibido, arquivo grande, traversal, symlink e argumento Git malicioso. |
| RNF-12 | Redação e auditoria | Logs/DTOs/crash reports usam allowlist e nunca carregam secrets, headers, HTML bruto ou AST integral; aprovação/publicação gera auditoria append-only. | Testes de redaction e consulta de auditoria por `publicationId` passam sem payload proibido. |

## 21. Validação

Nenhuma lei pode ser publicada sem passar pela validação estrutural. As regras abaixo são executadas pelo `ValidationService` antes de habilitar o botão de publicação:

- **Contagem de artigos**: o número de artigos reconhecidos no NormaAST deve ser consistente com o `total_artigos` declarado no frontmatter; divergência gera erro bloqueante (frontmatter deve ser corrigido ou o parser revisado).
- **IDs órfãos**: todo Block ID referenciado (ex. em metadado de "redação dada por") deve corresponder a um nó existente na árvore; ID referenciado sem nó correspondente é erro bloqueante.
- **IDs duplicados**: dois nós com o mesmo Block ID é erro bloqueante — indica falha do gerador ou edição manual indevida.
- **Dispositivos sem hierarquia definida**: nós com
  `parseEvidence.confidence = 'low'` e `requiresHumanReview = true` bloqueiam
  a publicação até decisão editorial registrada.
- **Frontmatter incompleto**: ausência de qualquer um dos 13 campos mínimos definidos no capítulo 15, ou valor fora do schema Zod esperado (ex. `tipo` fora do enum permitido, `ano` não numérico), é erro bloqueante.
- **Dispositivos revogados/vetados sem sinalização**: um nó com `deviceStatus: 'revoked'` ou `deviceStatus: 'vetoed'` sem a marcação visual correspondente no Markdown gerado é erro bloqueante — a regra de negócio de sinalização (capítulo 4, regra 4) é verificada automaticamente aqui.
- **Consistência de intervalo de divisão**: o intervalo de artigos declarado em um nó de divisão (ex. "Capítulo II: arts. 121 a 154") deve corresponder aos artigos de fato aninhados sob esse nó; divergência gera aviso não bloqueante, revisável pelo editor (pode ser intencional em leis com renumeração histórica).

Erros classificados como **bloqueantes** impedem a publicação até correção. Erros classificados como **avisos** permitem publicação, mas exigem confirmação explícita do editor reconhecendo o alerta, e ficam registrados no log de auditoria da publicação.

## 22. Logs

O Lex Editor registra eventos estruturados (JSON, conforme RNF-05) em cada etapa do pipeline, permitindo auditoria completa e diagnóstico de falhas sem necessidade de reproduzir o problema manualmente.

**O que é logado:**

- **Importação**: fonte utilizada, URL ou caminho de arquivo, resultado do Defuddle (sucesso/falha, tamanho do Markdown resultante), tempo de execução.
- **Parsing**: quantidade de nós por tipo e confiança, razões de baixa
  confiança, revisões editoriais exigidas, dispositivos revogados/vetados,
  tempo de execução, erros e exceções.
- **Geração de Block ID**: IDs gerados, colisões detectadas (e como foram resolvidas ou se bloquearam a publicação), tempo de execução.
- **Validação**: lista completa de regras executadas, resultado de cada uma (passou, aviso, erro bloqueante), decisão final (publicação liberada ou bloqueada).
- **Publicação**: hash do commit Git criado, autor da aprovação, resultado da sincronização com o Supabase, versão resultante (`versao_vinculex`), entrada gerada no `UPDATE.md`.
- **Revisão de atualização legislativa**: hash da fonte antes/depois, diff gerado pelo worker, decisão do editor (aprovado/rejeitado) e motivo quando rejeitado.

**Formato:** cada entrada de log é um objeto JSON com, no mínimo: `timestamp` (ISO 8601), `nivel` (`info`, `warn`, `error`), `modulo` (ex. `parser`, `block-id`, `validation`, `publish`), `lei_id` (referência à lei/entidade relacionada, quando aplicável), `mensagem` e `contexto` (objeto livre com dados adicionais relevantes ao evento). Os logs ficam disponíveis para consulta pesquisável na UI (filtro por lei, por módulo, por período e por nível), conforme RF-23.

## 23. Modelo de Dados

Esta seção descreve a visão local do estado da aplicação Electron — como o Lex Editor mantém e transita dados durante o uso, não o schema formal da norma jurídica em si.

O estado principal do renderer é gerenciado via TanStack Query, com as seguintes entidades centrais em memória/cache local durante uma sessão de trabalho:

- **Importação em andamento**: estado da URL/arquivo selecionado, progresso de extração (Defuddle) e parsing, erros intermediários.
- **NormaAST corrente**: árvore normativa da lei atualmente aberta para edição, incluindo anotações de revisão manual feitas pelo editor (ex. correção de hierarquia ambígua).
- **Resultado de validação**: lista de erros/avisos da última execução do `ValidationService`, associada ao NormaAST corrente.
- **Fila de atualizações pendentes**: leis com diff de atualização legislativa aguardando revisão do editor, sincronizada periodicamente via TanStack Query com o worker.
- **Configuração de fontes**: lista de fontes de importação cadastradas e suas regras de detecção, editável pelo Administrador Técnico.
- **Sessão de publicação**: estado da última publicação (candidate criado/enviado, validação e promoção server-side, sync transacional, entrada de `UPDATE.md`), usado para feedback imediato ao editor.

Esse estado local do app é volátil por natureza (não é a fonte de verdade — a fonte de verdade é o Git, e a distribuição é o Supabase); ele existe apenas para dar suporte à sessão de trabalho do editor dentro do Electron. O schema completo e formal do NormaAST, do Block ID e das entidades persistidas (frontmatter, changelog, tabelas do Supabase consumidas pelo SaaS) está detalhado em `../architecture/DATA_MODEL.md`.

## 24. APIs Internas

Contratos entre as camadas internas do Lex Editor:

**Parser → ParsedNormaAST**

```typescript
interface ParseResult {
  ast: ParsedNormaAST;
  warnings: ParseWarning[];     // derivadas de parseEvidence, sem pseudo-status
  metadata: {
    sourceArtifacts: {
      sourceRole: SourceRole;
      sourceVariant: SourceVariant;
      sourceArtifactSha256: string;
    }[];
    tempoExecucaoMs: number;
    totalNosReconhecidos: number;
  };
}

interface SourceArtifactInput {
  sourceType: SourceType;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
  rawArtifact: string;
  cleanedMarkdown?: string;
  sourceArtifactSha256: string;
  sourceUrl?: string;
}

interface SourceBundleInput {
  artifacts: SourceArtifactInput[]; // exatamente um primary_current
}

function parse(input: SourceBundleInput): ParseResult;
```

**ParsedNormaAST → reconciliador → IdentifiedNormaAST**

```typescript
interface BlockIdResult {
  astComIds: IdentifiedNormaAST;
  colisoes: BlockIdCollision[]; // vazio se não houver colisão
  novosIds: string[];           // valores canônicos sem "^" a persistir
  redirects: BlockIdRedirect[]; // aliases permanentes aprovados
}

function reconcileBlockIds(
  astCandidata: ParsedNormaAST,
  astPublicada: IdentifiedNormaAST | null,
  registro: BlockIdRegistry
): BlockIdResult;
```

**IdentifiedNormaAST → Formatter**

```typescript
interface FormatResult {
  markdown: string;             // conteúdo final do arquivo .md
  frontmatter: Frontmatter;     // objeto validado por schema Zod
}

function format(
  ast: IdentifiedNormaAST,
  frontmatterParcial: Partial<Frontmatter>
): FormatResult;
```

**Publicação idempotente**

```typescript
type PublicationKind =
  | 'initial'
  | 'legislative_update'
  | 'editorial_correction'
  | 'rollback';

interface PublicationManifest {
  publicationId: string;       // UUID; chave de idempotência
  leiId: string;
  version: string;             // SemVer sem "v"
  publicationNumber: number;
  kind: PublicationKind;
  expectedBaseCommitSha: string | null;
  expectedPublishedVersionId: string | null;
  restoreVersionId?: string;
  artifactHashes: {
    markdownSha256: string;
    updateSha256: string;
    astSha256: string;
  };
  sourceArtifacts: {
    sourceRole: SourceRole;
    sourceVariant: SourceVariant;
    sourceUrl?: string;
    finalUrl?: string;
    sourceArtifactSha256: string;
  }[]; // ordem canônica por função, URL e hash
}

interface PublicationPreview {
  publicationId: string;
  version: string;
  publicationNumber: number;
  summary: string;
  changedFiles: string[];
}

function preparePublication(ast: IdentifiedNormaAST): PublicationPreview;
function executePublication(publicationId: string): Promise<PublicationResult>;
function retryPublication(publicationId: string): Promise<PublicationResult>;
```

`PublicationManifest` é interno ao processo principal/Serviço de Publicação e
nunca atravessa IPC. `executePublication` recebe somente `publicationId`,
recarrega o manifesto congelado do diário e solicita aprovação/publicação
server-side. O serviço rejeita bytes, hashes, identidade, papel ou bases
divergentes. `retryPublication` nunca recalcula versão nem regenera artefatos.

**IPC entre processo principal e renderer**

O renderer nunca acessa sistema de arquivos, Git ou Supabase diretamente; toda operação sensível passa por handlers expostos via `contextBridge` no processo principal, invocados pelo renderer via `ipcRenderer.invoke`. Exemplos de canais:

| Canal IPC | Direção | Descrição |
|---|---|---|
| `import:startFromUrl` | renderer → main | Inicia importação por URL e retorna somente uma projeção segura de preview e o resumo da importação; artefato bruto, árvore completa e seletores permanecem no `main`. |
| `import:startFromFile` | renderer → main | Inicia importação por arquivo local. |
| `validation:run` | renderer → main | Executa `ValidationService` sobre o NormaAST corrente. |
| `publish:prepare` | renderer → main | Prepara versão, resumo e manifesto para confirmação humana. |
| `publish:execute` | renderer → main | Envia somente o `publicationId`; o main recarrega artefatos congelados e chama o serviço autenticado. |
| `publish:retry` | renderer → main | Retoma pelo `publicationId` a partir do último estágio seguro. |
| `update:listPending` | renderer → main | Lista atualizações legislativas pendentes de revisão. |
| `update:approve` / `update:reject` | renderer → main | Aprova ou rejeita uma atualização pendente. |
| `sources:list` / `sources:save` | renderer → main | Lista/salva configuração de fontes de importação. |
| `logs:query` | renderer → main | Consulta logs estruturados com filtros. |
| `audit:log-event` | main → renderer | Evento de progresso/log emitido durante operações longas (ex. importação em andamento). |

Todas as chamadas IPC validam schema, tamanho, `senderFrame`, frame principal e
origem local exata no processo principal. O preload expõe funções nomeadas, não
o `ipcRenderer`; não existem canais genéricos de shell, filesystem, Git, HTTP
ou Supabase. Regras completas em
`../architecture/ADR-007-fronteira-segura-publicacao.md`.

## 25. Roadmap

Esta seção apresenta a visão geral por fases; o detalhamento de entregas, critérios de saída de cada fase e sequenciamento de sprints está em `./ROADMAP.md`.

1. **Fase 1 — Fundação**: setup do projeto Electron/Vite/React/TypeScript, definição do NormaAST e do Block ID Spec, parser mínimo para uma fonte (Planalto), Formatter básico sem preview.
2. **Fase 2 — Pipeline completo de importação**: integração com Defuddle, parser cobrindo todos os níveis hierárquicos, geração completa de Block IDs com verificação de colisão, frontmatter automático.
3. **Fase 3 — Preview e validação**: preview estilo Obsidian dentro do app, `ValidationService` completo, exportação de arquivo único e em lote.
4. **Fase 4 — Publicação**: criação do release candidate, geração automática de `UPDATE.md`, integração com o Serviço de Publicação, histórico e rollback.
5. **Fase 5 — Worker de atualização legislativa**: cron de monitoramento de fontes, geração de diff, fluxo de aprovação/rejeição no Lex Editor.
6. **Fase 6 — Operação e escala**: configuração de novas fontes via UI, logs de auditoria pesquisáveis, cobertura de testes ampliada (Vitest + Playwright), acessibilidade e portabilidade multiplataforma.

## 26. Critérios de Aceite

- Importar uma lei de porte médio-alto (ex. CP ou Lei 14.133) por URL, do início ao fim, sem intervenção manual em nenhum artigo corretamente reconhecido.
- Gerar NormaAST com 100% dos artigos da fonte oficial presentes e na ordem correta.
- Atribuir Block ID a 100% dos dispositivos, sem colisão, seguindo o padrão de `../architecture/BLOCK_ID_SPEC.md`.
- Gerar Markdown final que abre corretamente no Obsidian, preservando lista indentada, frontmatter e callouts apenas no cabeçalho.
- Bloquear publicação de uma lei com erro estrutural bloqueante e liberar publicação assim que o erro for corrigido.
- Publicar uma lei de teste e confirmar: candidate criado, `UPDATE.md` e
  manifesto no mesmo SHA, promoção server-side e ponteiro público atualizado
  pela transação no Supabase.
- Detectar uma alteração legislativa simulada, exibir diff corretamente, e permitir aprovação (gerando nova versão) ou rejeição (mantendo versão atual) pelo editor.
- Restaurar uma publicação de teste como nova versão para frente, com novo
  release commit e o Supabase refletindo o snapshot escolhido.
- Rodar o parser e o preview sem conexão à internet para uma lei já importada.
- Atingir cobertura de testes mínima definida em RNF-04 no CI.

## 27. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Mudança de estrutura do HTML do Planalto (ou de outra fonte oficial) quebra o parser sem aviso prévio | Alta | Alto | Parser modular por fonte (RNF-03); testes automatizados com fixtures reais de HTML; monitoramento do worker que sinaliza falhas de extração como incidente, não como "sem atualização". |
| Ambiguidade estrutural em leis antigas mal digitalizadas (OCR de diário oficial, HTML sem marcação semântica) | Média-Alta | Médio | Evidência de baixa confiança exige revisão editorial registrada e bloqueia publicação; fallback de importação por arquivo local com colagem manual assistida. |
| Colisão de Block ID entre dispositivos de leis diferentes ou dentro da mesma lei | Baixa (com verificação automática) | Alto | Validação contra o namespace histórico, qualificação estrutural conforme RF-09 e testes de regressão que garantem que um novo conflito nunca renomeia IDs publicados. |
| Falha do Defuddle em páginas dinâmicas (conteúdo renderizado via JavaScript) | Média | Médio | Detecção de falha explícita na UI, com fallback para importação por arquivo local (HTML já renderizado salvo pelo editor). |
| Publicação de conteúdo desatualizado por falha silenciosa do worker de monitoramento (cron não executa, fonte fica indisponível sem gerar alerta) | Média | Alto | Logs de execução do worker auditáveis; alerta automático ao Administrador Técnico quando o worker não executa dentro da janela esperada; hash de verificação registrado a cada execução, mesmo sem divergência. |
| Divergência entre o release commit no Git e o Supabase (falha de sincronização) | Média | Alto | Ponteiro público só muda no final da transação; tentativa fica como sincronização pendente e retry reutiliza chave, versão, manifesto e SHA sem duplicar dados. |
| Erro de julgamento humano na aprovação de uma atualização legislativa (editor aprova um diff incorretamente interpretado) | Baixa-Média | Alto | Diff exibido lado a lado com destaque textual claro (RF-21); Block IDs afetados listados explicitamente; possibilidade de rollback (capítulo 18) como rede de segurança. |
| Leis com tabelas complexas (tabelas de infrações do CTB, tabelas de valores da Lei 14.133) extraídas de forma imprecisa pelo Defuddle | Média | Médio | Sinalização explícita no preview de trechos com tabela para revisão manual obrigatória antes de liberar publicação. |

## 28. Métricas

**Métricas técnicas:**

- Tempo médio de importação e parsing por porte de lei (pequena, média, grande), medido em produção.
- Taxa de nós com confiança baixa e distribuição de
  `ParseConfidenceReason` por fonte.
- Taxa de erro de validação estrutural bloqueante por publicação (indicador de maturidade do pipeline).
- Cobertura de testes de `parser/` e `block-id/` (Vitest) e dos fluxos críticos (Playwright), acompanhada no CI.
- Taxa de sucesso do sync transacional pelo Serviço de Publicação na primeira tentativa.
- Tempo médio entre detecção de atualização legislativa pelo worker e decisão (aprovação/rejeição) do editor.

**Métricas de produto:**

- Número de leis publicadas por mês.
- Tempo médio entre início de importação e publicação aprovada, por editor.
- Número de rollbacks realizados por trimestre (indicador de qualidade de revisão pré-publicação — tendência de queda é desejável).
- Número de colisões de Block ID detectadas e bloqueadas antes da publicação (indicador de eficácia da validação, não de falha).
- Percentual de leis do roadmap de cobertura (CF/88, CP, CPP, CPPM, ECA, CTB, Lei 14.133 e correlatas) já publicadas no acervo.

## 29. ADRs Relacionados

- **`../architecture/ADR-001-block-ids-imutaveis.md`** — registra a decisão de que Block IDs representam posição jurídica, não conteúdo textual, e nunca são alterados após criados, mesmo diante de mudança de redação por lei posterior. É a base normativa para os capítulos 13, 19 (RF-08/RF-09) e 21 (Validação) deste PRD.
- **`../architecture/ADR-002-norma-ast.md`** — registra a decisão de adotar uma árvore normativa intermediária (NormaAST) independente de origem, em vez de gerar Markdown diretamente a partir de cada fonte. Sustenta a arquitetura modular descrita nos capítulos 9 a 11.
- **`../architecture/ADR-003-versionamento-git.md`** — registra a decisão de usar o Git como fonte canônica do conteúdo, em vez do Supabase Storage, priorizando histórico, diff e revisão por PR sobre conveniência operacional imediata. Sustenta os capítulos 16, 17 e 18.
- **`../architecture/ADR-004-pipeline-publicacao.md`** — registra a decisão de que nenhuma publicação (primeira publicação ou atualização legislativa) ocorre sem aprovação humana explícita, mesmo quando o worker detecta divergência com alta confiança. Sustenta os capítulos 8 (Fluxo 2), 18 e o requisito RF-22.
- **`../architecture/ADR-005-status-fields.md`** — registra a proibição de um campo genérico `status` em favor de campos semanticamente nomeados. No Lex Editor, são `legal_status`, `publication_status`, `device_status`, `update_review_status` para a fila do worker e `publication_attempt_status` para a execução idempotente da publicação, cada um com enum e fonte da verdade próprios. Sustenta o capítulo 15 (Frontmatter) deste PRD e o schema de `../architecture/DATA_MODEL.md`.
- **`../architecture/ADR-007-fronteira-segura-publicacao.md`** — separa a decisão editorial da autoridade técnica de produção: a estação envia apenas um release candidate, enquanto o Serviço de Publicação revalida e promove o SHA exato antes do sync privado e transacional. Sustenta os capítulos 18 e 23, RF-17/RF-18 e RNF-09 a RNF-12.
- **`../architecture/ADR-009-fontes-compiladas-e-historicas.md`** — define a
  página compilada como fonte preferencial do texto vigente, a página anotada
  como evidência histórica e a preservação independente dos artefatos. Sustenta
  os capítulos 8, 11 e 12 e o pipeline de atualização legislativa.
