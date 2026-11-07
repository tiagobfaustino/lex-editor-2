import {
  legalNormIdentitySchema,
  publicationHistoryInspectionSchema,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

import {
  AuditEventDetailDtoSchema,
  AuditEventListItemDtoSchema,
  AuditQueryFiltersSchema,
  AuditUnavailableReasonDtoSchema,
} from '../../../src/shared/ipc/audit.js';
import { PublicationHistoryPageDtoSchema } from '../../../src/shared/ipc/publication.js';

export const GATEWAY_LIMITS = Object.freeze({
  requestBytes: 64 * 1024,
  responseBytes: 4 * 1024 * 1024,
  candidateBytes: 64 * 1024 * 1024,
});
export const gatewayRequestLimit = (path: string): number =>
  path === '/updates/approve' ? GATEWAY_LIMITS.candidateBytes : GATEWAY_LIMITS.requestBytes;
export const gatewayResponseLimit = (path: string): number =>
  path === '/updates/getCandidate' ? GATEWAY_LIMITS.candidateBytes : GATEWAY_LIMITS.responseBytes;
export const ApproveUpdateCandidateRequestSchema = z.strictObject({
  updateId: z.uuid(),
  publicationId: z.uuid(),
  manifestCanonical: z
    .string()
    .min(1)
    .max(256 * 1024),
  identifiedAstCanonical: z.string().min(1).max(GATEWAY_LIMITS.candidateBytes),
});
export const GatewayIdentitySchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum(['editor_juridico', 'administrador_tecnico']),
});
export const PublicationIdentityRequestSchema = legalNormIdentitySchema
  .extend({ sigla: z.string().trim().min(1).max(40) })
  .strict();
export const PublicationHistoryEvidenceRequestSchema = legalNormIdentitySchema
  .extend({ sigla: z.string().trim().min(1).max(40).optional() })
  .strict();
export const PublicationContextSchema = z.strictObject({
  lawId: z.uuid(),
  sigla: z.string().min(1).max(40),
  lawTitle: z.string().min(1).max(500),
  tipoNorma: z.string().min(1).max(80),
  numero: z.string().min(1).max(80),
  ano: z.int(),
  current: z
    .strictObject({
      versionId: z.uuid(),
      version: z.string().regex(/^\d+\.\d+\.\d+$/u),
      publicationNumber: z.int().positive(),
      gitCommitSha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
    })
    .nullable(),
  blockIds: z.array(z.string().min(1).max(240)).max(100_000),
  redirects: z
    .array(z.strictObject({ antigo: z.string().min(1).max(240), novo: z.string().min(1).max(240) }))
    .max(100_000),
});
export const PublicationHistoryRequestSchema = z.strictObject({
  lawId: z.uuid(),
  cursor: z.string().regex(/^\d+$/u).max(20).nullable(),
  limit: z.int().min(1).max(100),
});
export const PublicationHistoryResponseSchema = PublicationHistoryPageDtoSchema;
export const PublicationHistoryInspectionResponseSchema = publicationHistoryInspectionSchema;
export const RemoteAuditOriginSchema = z.enum(['publisher', 'update_worker', 'source_catalog']);
export const GatewayAuditListRequestSchema = z.strictObject({
  origin: RemoteAuditOriginSchema,
  filters: AuditQueryFiltersSchema,
  cutoff: z.iso.datetime(),
  afterPosition: z
    .string()
    .regex(/^(?:\d+|x)(?::(?:\d+|x))?$/u)
    .max(100)
    .nullable(),
  limit: z.int().min(1).max(200),
});
export const GatewayAuditGetRequestSchema = z.strictObject({
  origin: RemoteAuditOriginSchema,
  eventId: z.uuid(),
});
const unavailable = z.strictObject({
  available: z.literal(false),
  reason: AuditUnavailableReasonDtoSchema,
});
export const GatewayAuditListResponseSchema = z.discriminatedUnion('available', [
  z.strictObject({
    available: z.literal(true),
    items: z
      .array(z.strictObject({ event: AuditEventListItemDtoSchema, position: z.string().max(100) }))
      .max(200),
    hasMore: z.boolean(),
  }),
  unavailable,
]);
export const GatewayAuditGetResponseSchema = z.discriminatedUnion('available', [
  z.strictObject({ available: z.literal(true), detail: AuditEventDetailDtoSchema.nullable() }),
  unavailable,
]);
