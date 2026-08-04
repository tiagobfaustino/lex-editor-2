# Feature 008 — Atualizações legislativas

## Metadados

- `implementation_status`: draft
- `priority`: P3
- `owner`: não atribuído

## Objetivo

Detectar mudança em fonte oficial, produzir proposta estrutural revisável e
reutilizar a publicação segura somente após decisão humana explícita.

## Problema

Leis publicadas mudam, mas automação integral pode confundir mudança cosmética,
erro de parser e alteração jurídica real. O worker deve propor, não decidir nem
publicar.

## Escopo

- Worker Node independente e scheduler.
- Snapshot bruto e hash da projeção normativa.
- Reprocessamento com os mesmos pacotes do Lex Editor.
- Diff por dispositivo e reconciliação de identidade.
- Fila com `update_review_status`.
- Tela de revisão anterior/depois, aprovação e rejeição motivada.
- Deduplicação, supersessão, erro e reprocessamento.
- Aprovação encaminhada à Feature 007.

## Fora do escopo

- Publicação automática por confiança alta.
- Escrita normativa pelo worker.
- Heurística baseada apenas em diff de linha.
- Suporte LexML e novas fontes no primeiro incremento.

## Dependências

- Feature 007.
- `../../../docs/architecture/ADR-004-pipeline-publicacao.md`
- `../../../docs/architecture/ADR-005-status-fields.md`
- `../../../docs/architecture/ADR-009-fontes-compiladas-e-historicas.md`
- `../../../docs/architecture/UPDATE_PIPELINE.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-008-01: mudança cosmética não produz mudança normativa falsa.
- RF-008-02: proposta referencia versão-base, snapshots e hashes.
- RF-008-03: worker só cria/atualiza pendências dentro de permissão limitada.
- RF-008-04: aprovação não ignora nova validação do Serviço de Publicação.
- RF-008-05: rejeição/supersessão preserva auditoria e evita reaparecimento
  idêntico.

## Invariantes

- Nenhum caminho do worker troca `leis.versao_publicada_id`.
- Baixa confiança exige revisão.
- Hash do snapshot e hash normativo têm propósitos distintos.
- Pendência aprovada mas não publicada permanece invisível ao SaaS.

## Cenários essenciais

### Alteração real

Dadas fixtures antes/depois, quando o worker executa, então cria uma única
pendência com dispositivos incluídos, alterados, revogados e renumerados
corretos.

### Mudança cosmética ou rejeição

Dada mudança apenas de HTML ou proposta rejeitada sem nova divergência, quando
o worker roda novamente, então não publica nem recria ruído equivalente.

## Critérios de aceite

- [ ] Worker detecta alteração simulada e gera diff estrutural correto.
- [ ] Mudança cosmética é filtrada ou classificada sem falsa urgência.
- [ ] Credencial do worker falha ao tentar escrita normativa.
- [ ] Aprovar percorre integralmente a Feature 007.
- [ ] Rejeitar preserva versão pública e motivo.
- [ ] Retry e detecções repetidas não duplicam pendência.

## Validação mínima

- Risco: crítico para fidelidade e autoridade.
- Fixtures antes/depois, integração de fila, permissões negativas e E2E de
  aprovação/rejeição.

## Riscos

- Mudança de layout gerar tempestade de pendências: monitorar confiança e
  suspender fonte degradada.
- Reconciliador casar dispositivos incorretos: bloquear ambiguidade.
