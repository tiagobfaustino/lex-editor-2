import type { z } from 'zod';
import { z as zod } from 'zod';

import { falha, problemasDoZod, type ResultadoValidacao, sucesso } from '../ast/errors.js';
import { revisionHashSchema } from '../editorial-commands/index.js';
import {
  legalNormIdentityKey,
  legalReferenceIndexSchema,
  legalReferenceLocatorSchema,
  legalReferenceEvidenceSchema,
  legalReferenceStateSchema,
  legalReferenceSeveritySchema,
  legalReferenceSourceFieldSchema,
  legalReferenceTargetSchema,
} from '../legal-reference/index.js';

const blockIdSchema = zod
  .string()
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const canonicalLawKeySchema = zod.string().min(1).max(240);

export const legalReferenceSqlTargetSchema = zod.strictObject({
  law_key: canonicalLawKeySchema,
  revision_sha256: revisionHashSchema,
  block_id: blockIdSchema,
});

export const legalReferenceSqlEdgeSchema = zod
  .strictObject({
    reference_id: revisionHashSchema,
    source_law_key: canonicalLawKeySchema,
    source_revision_sha256: revisionHashSchema,
    source_block_id: blockIdSchema,
    source_field: legalReferenceSourceFieldSchema,
    span_encoding: zod.literal('utf16'),
    span_start: zod.int().nonnegative(),
    span_end: zod.int().positive(),
    span_text: zod.string().min(1).max(10_000),
    state: legalReferenceStateSchema,
    severity: legalReferenceSeveritySchema,
    locator: legalReferenceLocatorSchema,
    evidence: zod.array(legalReferenceEvidenceSchema).min(1).max(20),
    target_law_key: canonicalLawKeySchema.nullable(),
    target_revision_sha256: revisionHashSchema.nullable(),
    target_block_id: blockIdSchema.nullable(),
    candidate_targets: zod.array(legalReferenceSqlTargetSchema).max(50),
    reason: zod.string().min(1).max(100).nullable(),
  })
  .superRefine((edge, ctx) => {
    const targetValues = [edge.target_law_key, edge.target_revision_sha256, edge.target_block_id];
    if (edge.state === 'resolved' && targetValues.some((value) => value === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['target_law_key'],
        message: 'Aresta resolved exige identidade, revisão e Block ID de destino.',
      });
    }
    if (edge.state !== 'resolved' && targetValues.some((value) => value !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['target_law_key'],
        message: 'Aresta não resolvida não pode persistir destino único.',
      });
    }
  });

export type LegalReferenceSqlTarget = z.infer<typeof legalReferenceSqlTargetSchema>;
export type LegalReferenceSqlEdge = z.infer<typeof legalReferenceSqlEdgeSchema>;

const sqlTarget = (
  target: z.infer<typeof legalReferenceTargetSchema>,
): LegalReferenceSqlTarget => ({
  law_key: legalNormIdentityKey(target.law),
  revision_sha256: target.revisionHash,
  block_id: target.blockId,
});

/** Projeção pura para JSON/SQL; nomes e paths do vault não atravessam a fronteira. */
export const projectLegalReferenceSqlEdges = (
  input: unknown,
): ResultadoValidacao<readonly LegalReferenceSqlEdge[]> => {
  const parsed = legalReferenceIndexSchema.safeParse(input);
  if (!parsed.success) return falha(problemasDoZod(parsed.error));

  const sourceLawKey = legalNormIdentityKey(parsed.data.law);
  const edges = parsed.data.references.map((reference): LegalReferenceSqlEdge => {
    const target = reference.state === 'resolved' ? sqlTarget(reference.target) : null;
    const candidateTargets =
      reference.state === 'ambiguous' ? reference.candidates.map(sqlTarget) : [];
    const reason =
      reference.state === 'unresolved' || reference.state === 'ambiguous' ? reference.reason : null;

    return legalReferenceSqlEdgeSchema.parse({
      reference_id: reference.referenceId,
      source_law_key: sourceLawKey,
      source_revision_sha256: parsed.data.revisionHash,
      source_block_id: reference.sourceBlockId,
      source_field: reference.sourceField,
      span_encoding: reference.span.encoding,
      span_start: reference.span.start,
      span_end: reference.span.end,
      span_text: reference.span.text,
      state: reference.state,
      severity: reference.severity,
      locator: reference.locator,
      evidence: reference.evidence,
      target_law_key: target?.law_key ?? null,
      target_revision_sha256: target?.revision_sha256 ?? null,
      target_block_id: target?.block_id ?? null,
      candidate_targets: candidateTargets,
      reason,
    });
  });

  return sucesso(Object.freeze(edges));
};
