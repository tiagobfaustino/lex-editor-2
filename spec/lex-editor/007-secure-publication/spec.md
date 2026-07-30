# Feature 007 — Publicação segura

## Metadados

- `implementation_status`: draft
- `priority`: P2
- `owner`: não atribuído

## Objetivo

Publicar exatamente o conteúdo aprovado por meio de release candidate e
Serviço de Publicação server-side, com Git protegido, sync transacional,
idempotência, concorrência e rollback para frente.

## Problema

Commit local, push ou aprovação visual isolados não podem conceder autoridade
de produção. Uma estação comprometida não deve escrever no branch canônico ou
nas tabelas normativas.

## Escopo

- Autenticação editorial individual e aprovação ligada ao digest.
- Manifesto imutável, SemVer, `numero_publicacao` e chave idempotente.
- Commit/push apenas em `releases/{publicationId}`.
- Serviço server-side que busca e revalida o SHA.
- Promoção ao branch protegido e função privada transacional.
- Diário durável, retry, consulta de estado e UX de falha.
- Histórico, diff e rollback como nova publicação.
- Concorrência otimista pela base Git e ponteiro público.

## Fora do escopo

- Escrita direta do Electron no Supabase.
- Credencial administrativa ou do branch protegido na estação.
- Publicação automática de atualização legislativa.
- Reescrita de histórico Git ou de versões no banco.

## Dependências

- Feature 006.
- `../../../docs/architecture/ADR-003-versionamento-git.md`
- `../../../docs/architecture/ADR-004-pipeline-publicacao.md`
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-007-01: aprovação identifica ator, papel, digest e instante.
- RF-007-02: qualquer byte alterado depois da aprovação invalida publicação.
- RF-007-03: retry reutiliza versão, manifesto, chave e SHA.
- RF-007-04: ponteiro público muda somente no fim da transação.
- RF-007-05: rollback cria novo commit/versão e preserva histórico.

## Invariantes

- Push candidato não significa publicado.
- Somente o Serviço de Publicação promove e sincroniza.
- Renderer, main, editor, worker e SaaS não possuem escrita normativa direta.
- Uma corrida tem no máximo um vencedor; a perdedora exige recálculo e nova
  confirmação.

## Cenários essenciais

### Publicação nominal

Dado um digest aprovado, quando candidate e serviço concluem, então o SHA
promovido é o mesmo, o snapshot é atômico e o ponteiro passa à nova versão.

### Adulteração ou replay

Dado manifesto alterado, base obsoleta ou chave repetida com bytes diferentes,
quando solicitado, então o serviço nega sem promover ou trocar o ponteiro.

## Critérios de aceite

- [ ] Fluxo completo real funciona em staging.
- [ ] Falha em cada estágio é retomável sem duplicação.
- [ ] Corrida publica somente uma tentativa.
- [ ] Rollback para frente preserva versões anteriores.
- [ ] Testes provam ausência de secrets e negação das identidades indevidas.
- [ ] Auditoria liga aprovação, publicationId, SHA, versão e resultado.

## Validação mínima

- Risco: crítico de segurança, integridade e disponibilidade.
- Integração real em staging, testes de falha/injeção/replay/concorrência e um
  E2E essencial.

## Riscos

- Serviço virar proxy privilegiado genérico: endpoint aceita apenas protocolo
  fechado de publicação.
- Git promovido e banco falhar: diário e estado retomável, sem sucesso falso.
