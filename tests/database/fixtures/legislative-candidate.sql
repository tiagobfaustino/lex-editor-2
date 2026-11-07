create table public.test_candidate_artifact (value jsonb not null);
insert into public.test_candidate_artifact select jsonb_set(
  $candidate${
  "schemaVersion": 1,
  "candidateArtifactId": "eeeeeeee-1111-4111-8111-111111111111",
  "lawId": "33333333-3333-4333-8333-333333333333",
  "baseVersionId": "BASE_VERSION_ID",
  "baseNormativeSha256": "cae662172fd450bb0cd710a769079c05bfc5d8e35efa6576edc7d0377afdd4a2",
  "candidateNormativeSha256": "72575fe939cb91590c468c526199aaadc5a642b4f8126244f41b9ae4404de872",
  "ast": {
    "tipo": "lei",
    "titulo": "Lei de Demonstração",
    "sigla": "ldem",
    "tipoNorma": "lei ordinária",
    "numero": "1.234",
    "ano": 2026,
    "ramo": "demonstração",
    "fonte": "https://www.planalto.gov.br/ccivil_03/leis/l1234.htm",
    "dataPublicacao": "2026-01-15",
    "dataAtualizacaoLegal": "2026-03-10",
    "dataFormatacaoVinculex": "2026-08-05",
    "versaoVinculex": "1.0.0",
    "legalStatus": "vigente",
    "publicationStatus": "draft",
    "dataVerificacaoIntegridade": "2026-08-05",
    "astPhase": "identified",
    "id": "no-raiz",
    "ordem": 0,
    "sourceRef": {
      "sourceType": "planalto_html",
      "sourceRole": "primary_current",
      "sourceVariant": "compiled",
      "sourceArtifactSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40",
      "fragmentSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40"
    },
    "parseEvidence": {
      "confidence": "high",
      "reasons": [
        "exact_legal_designator"
      ],
      "requiresHumanReview": false
    },
    "totalArtigos": 1,
    "children": [
      {
        "tipo": "artigo",
        "id": "no-art-1",
        "ordem": 0,
        "blockId": "ldem-art-1",
        "sourceRef": {
          "sourceType": "planalto_html",
          "sourceRole": "primary_current",
          "sourceVariant": "compiled",
          "sourceArtifactSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40",
          "fragmentSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40"
        },
        "parseEvidence": {
          "confidence": "high",
          "reasons": [
            "exact_legal_designator"
          ],
          "requiresHumanReview": false
        },
        "deviceStatus": "active",
        "numero": "1",
        "caput": "Esta lei demonstra o contrato da NormaAST.",
        "children": []
      }
    ]
  },
  "snapshots": [
    {
      "sha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40",
      "conteudo": "<html>Fonte com ação legislativa.</html>",
      "referencia": {
        "sourceType": "planalto_html",
        "sourceRole": "primary_current",
        "sourceVariant": "compiled",
        "sourceArtifactSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40",
        "fragmentSha256": "a5c3f9c4190d32fd080b05780a026ef80b10b1f1bb1684e01f39e688d2d16d40"
      }
    }
  ]
}
$candidate$::jsonb, '{baseVersionId}',
  to_jsonb(versao_publicada_id::text)) from public.leis
  where id = '33333333-3333-4333-8333-333333333333';
grant select on public.test_candidate_artifact to update_worker_test, update_editor_test, publisher_test;
