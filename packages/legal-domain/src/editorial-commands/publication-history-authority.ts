import { z } from 'zod';

import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';
import {
  legalNormIdentityKey,
  legalNormIdentitySchema,
  type LegalNormIdentity,
} from '../legal-reference/index.js';
import { publicationHistoryStateSchema } from './frontmatter-metadata.js';

const authorityRevisionSchema = z.string().trim().min(1).max(500);

export const publicationHistoryInspectionSchema = z.discriminatedUnion('availability', [
  z.strictObject({
    availability: z.literal('available'),
    authorityRevision: authorityRevisionSchema,
    publishedVersionIds: z.array(z.uuid()).max(100_000),
  }),
  z.strictObject({
    availability: z.literal('unavailable'),
    reason: z.enum(['offline', 'not_configured', 'authority_error']),
  }),
]);

export const publicationHistoryEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    canonicalIdentityKey: z.string().min(1).max(240),
    state: publicationHistoryStateSchema,
    authorityRevision: authorityRevisionSchema.nullable(),
  })
  .check((ctx) => {
    if (ctx.value.state === 'unknown' && ctx.value.authorityRevision !== null) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.authorityRevision,
        path: ['authorityRevision'],
        message: 'Histórico desconhecido não pode alegar revisão autoritativa.',
      });
    }
    if (ctx.value.state !== 'unknown' && ctx.value.authorityRevision === null) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.authorityRevision,
        path: ['authorityRevision'],
        message: 'Um estado comprovado exige a revisão consultada na autoridade.',
      });
    }
  });

export interface PublicationHistoryAuthority {
  inspect(identity: LegalNormIdentity): Promise<unknown>;
}

const identityFrom = (ast: IdentifiedNormaAST): LegalNormIdentity =>
  legalNormIdentitySchema.parse({
    tipoNorma: ast.tipoNorma,
    numero: ast.numero,
    ano: ast.ano,
  });

const unknownEvidence = (canonicalIdentityKey: string): PublicationHistoryEvidence => ({
  schemaVersion: 1,
  canonicalIdentityKey,
  state: 'unknown',
  authorityRevision: null,
});

/**
 * Consulta a porta autoritativa no processo confiável. Somente uma resposta
 * disponível e versionada com lista vazia prova que nunca houve publicação.
 */
export const provePublicationHistory = async (
  rawAst: unknown,
  authority: PublicationHistoryAuthority,
): Promise<PublicationHistoryEvidence> => {
  const ast = identifiedNormaAstSchema.parse(rawAst);
  const identity = identityFrom(ast);
  const canonicalIdentityKey = legalNormIdentityKey(identity);
  try {
    const inspection = publicationHistoryInspectionSchema.parse(await authority.inspect(identity));
    if (inspection.availability === 'unavailable') return unknownEvidence(canonicalIdentityKey);
    return publicationHistoryEvidenceSchema.parse({
      schemaVersion: 1,
      canonicalIdentityKey,
      state: inspection.publishedVersionIds.length === 0 ? 'never_published' : 'published',
      authorityRevision: inspection.authorityRevision,
    });
  } catch {
    return unknownEvidence(canonicalIdentityKey);
  }
};

/** Evidência ausente, adulterada ou pertencente a outra identidade falha fechada. */
export const publicationHistoryStateFor = (
  ast: IdentifiedNormaAST,
  rawEvidence: unknown,
): PublicationHistoryState => {
  const evidence = publicationHistoryEvidenceSchema.safeParse(rawEvidence);
  if (!evidence.success) return 'unknown';
  return evidence.data.canonicalIdentityKey === legalNormIdentityKey(identityFrom(ast))
    ? evidence.data.state
    : 'unknown';
};

export type PublicationHistoryInspection = z.infer<typeof publicationHistoryInspectionSchema>;
export type PublicationHistoryEvidence = z.infer<typeof publicationHistoryEvidenceSchema>;
export type PublicationHistoryState = z.infer<typeof publicationHistoryStateSchema>;
