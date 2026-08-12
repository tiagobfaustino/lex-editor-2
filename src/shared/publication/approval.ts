import { z } from 'zod';

const SHA256 = /^[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const publicationUuidSchema = z
  .uuid()
  .refine((value) => value === value.toLocaleLowerCase('en-US'), 'UUID must be lowercase.');

export const publicationDigestSchema = z
  .string()
  .regex(SHA256, 'Expected a lowercase SHA-256 digest.');

export const publicationApprovalRoleSchema = z.literal('editor_juridico');

export const publicationApprovalRequestSchema = z.strictObject({
  publicationId: publicationUuidSchema,
  manifestDigest: publicationDigestSchema,
});

export const publicationApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvalId: publicationUuidSchema,
  publicationId: publicationUuidSchema,
  manifestDigest: publicationDigestSchema,
  userId: publicationUuidSchema,
  role: publicationApprovalRoleSchema,
  approvedAt: z.iso.datetime().regex(UTC_TIMESTAMP, 'Expected a canonical UTC timestamp.'),
});

export type PublicationApprovalRequest = z.infer<typeof publicationApprovalRequestSchema>;
export type PublicationApproval = z.infer<typeof publicationApprovalSchema>;
