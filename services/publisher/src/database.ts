import { createHash } from 'node:crypto';
import { validarIdentifiedNormaAst } from '@lex-editor/legal-domain';
import { z } from 'zod';

import {
  publicationApprovalSchema,
  type PublicationApproval,
} from '../../../src/shared/publication/approval.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  parseCanonicalPublicationManifest,
  serializeCanonicalJson,
  publicationUuidSchema,
} from '../../../src/shared/publication/manifest.js';
import type { PublicationApprovalRepository, PublisherIdentityRepository } from './approval.js';
import type { PublisherGitRepository } from './git-repository.js';
import type { PublicationBaselineRepository } from './validation.js';
import type {
  PublisherAttemptRecord,
  PublisherAttemptRepository,
  PublisherTransactionGateway,
} from './workflow.js';

export interface PublisherSqlClient {
  query<T extends Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
}

export class PublisherDatabaseError extends Error {
  constructor(message = 'A persistência segura da publicação falhou.') {
    super(message);
  }
}

const attemptSchema = z.strictObject({
  publicationId: publicationUuidSchema,
  candidateSha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
  manifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  publicationAttemptStatus: z.enum(['pushed', 'syncing', 'published', 'failed']),
  resumeFromStatus: z.enum(['pushed', 'syncing']).nullable(),
  publishedVersionId: publicationUuidSchema.nullable(),
});

const valueFrom = <T>(rows: readonly Record<string, unknown>[], schema: z.ZodType<T>): T => {
  const value = rows[0]?.['value'];
  if (value === undefined || rows.length !== 1) throw new PublisherDatabaseError();
  return schema.parse(value);
};

const nullableAttemptFrom = (
  rows: readonly Record<string, unknown>[],
): PublisherAttemptRecord | null => {
  if (rows.length !== 1) throw new PublisherDatabaseError();
  const value = rows[0]?.['value'];
  return value === null ? null : attemptSchema.parse(value);
};

const rawApprovalRowSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvalId: publicationUuidSchema,
  publicationId: publicationUuidSchema,
  manifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  userId: publicationUuidSchema,
  role: z.literal('editor_juridico'),
  approvedAt: z.iso.datetime({ offset: true }),
});

const approvalFrom = (value: unknown): PublicationApproval => {
  const raw = rawApprovalRowSchema.parse(value);
  return publicationApprovalSchema.parse({
    ...raw,
    approvedAt: new Date(raw.approvedAt).toISOString(),
  });
};

export const createPublisherDatabase = (options: {
  sql: PublisherSqlClient;
  git: PublisherGitRepository;
}): Readonly<{
  identities: PublisherIdentityRepository;
  approvals: PublicationApprovalRepository;
  baselines: PublicationBaselineRepository;
  attempts: PublisherAttemptRepository;
  transaction: PublisherTransactionGateway;
}> => {
  const identities: PublisherIdentityRepository = {
    async findByUserId(userId) {
      const rows = await options.sql.query<Record<string, unknown>>(
        'select private.get_publisher_editor_identity($1::uuid) as value',
        [publicationUuidSchema.parse(userId)],
      );
      if (rows.length !== 1) throw new PublisherDatabaseError();
      const value = rows[0]?.['value'];
      if (value === null) return null;
      const identity = z
        .strictObject({
          userId: publicationUuidSchema,
          accountStatus: z.enum(['active', 'suspended']),
          papel: z.string(),
        })
        .parse(value);
      return {
        userId: identity.userId,
        accountStatus: identity.accountStatus,
        roles: identity.papel === 'curador' ? ['editor_juridico'] : [],
      };
    },
  };

  const approvals: PublicationApprovalRepository = {
    async findByPublicationId(publicationId) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.get_publication_approval($1::uuid) as value`,
        [publicationUuidSchema.parse(publicationId)],
      );
      if (rows.length !== 1) throw new PublisherDatabaseError();
      const value = rows[0]?.['value'];
      return value === null ? null : approvalFrom(value);
    },
    async appendIfAbsent(rawApproval) {
      const approval = publicationApprovalSchema.parse(rawApproval);
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.record_publication_approval(
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz
         ) as value`,
        [
          approval.approvalId,
          approval.publicationId,
          approval.userId,
          approval.manifestDigest,
          approval.approvedAt,
        ],
      );
      const persisted = approvalFrom({
        schemaVersion: 1,
        ...((rows[0]?.['value'] ?? {}) as Record<string, unknown>),
      });
      return { inserted: true, approval: persisted };
    },
  };

  const baselines: PublicationBaselineRepository = {
    async getByLawId(lawId, lawDirectoryName) {
      const parsedLawId = publicationUuidSchema.parse(lawId);
      const rows = await options.sql.query<Record<string, unknown>>(
        'select private.get_publisher_publication_baseline($1::uuid) as value',
        [parsedLawId],
      );
      if (rows.length !== 1) throw new PublisherDatabaseError('A lei publicada não existe.');
      const base = z
        .strictObject({
          lawId: publicationUuidSchema,
          publishedVersionId: publicationUuidSchema.nullable(),
          gitCommitSha: z
            .string()
            .regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u)
            .nullable(),
          version: z.string().nullable(),
          publicationNumber: z.number().int().positive().nullable(),
          historicalBlockIds: z.array(z.string()),
          redirects: z.array(z.strictObject({ antigo: z.string(), novo: z.string() })),
        })
        .parse(rows[0]?.['value']);
      let ast = null;
      if (base.gitCommitSha !== null && base.version !== null && base.publicationNumber !== null) {
        const bytes = await options.git.readBlob(
          base.gitCommitSha,
          publicationIdentifiedAstRelativePath(
            lawDirectoryName,
            base.publicationNumber,
            base.version,
          ),
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw new PublisherDatabaseError('A AST da versão pública não pôde ser lida.');
        }
        const validation = validarIdentifiedNormaAst(parsed);
        if (!validation.ok) {
          throw new PublisherDatabaseError('A AST da versão pública é inválida.');
        }
        ast = validation.valor;
      }
      return {
        ...base,
        ast,
        historicalBlockIds: base.historicalBlockIds,
        redirects: base.redirects,
      };
    },
    async versionBelongsToLaw(lawId, versionId) {
      const rows = await options.sql.query<Record<string, unknown>>(
        'select private.get_publisher_historical_version($1::uuid,$2::uuid) as value',
        [publicationUuidSchema.parse(lawId), publicationUuidSchema.parse(versionId)],
      );
      if (rows.length !== 1) throw new PublisherDatabaseError();
      return rows[0]?.['value'] !== null;
    },
    async getHistoricalVersion(lawId, versionId, lawDirectoryName) {
      const rows = await options.sql.query<Record<string, unknown>>(
        'select private.get_publisher_historical_version($1::uuid,$2::uuid) as value',
        [publicationUuidSchema.parse(lawId), publicationUuidSchema.parse(versionId)],
      );
      if (rows.length === 1 && rows[0]?.['value'] === null) return null;
      if (rows.length !== 1) throw new PublisherDatabaseError('A versão histórica é ambígua.');
      const stored = z
        .strictObject({
          lawId: publicationUuidSchema,
          versionId: publicationUuidSchema,
          gitCommitSha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
          version: z.string(),
          publicationNumber: z.number().int().positive(),
          publicationId: publicationUuidSchema,
          manifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
        })
        .parse(rows[0]?.['value']);
      const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
      const manifestBytes = await options.git.readBlob(
        stored.gitCommitSha,
        publicationManifestRelativePath(lawDirectoryName, stored.publicationNumber, stored.version),
      );
      const manifest = parseCanonicalPublicationManifest(manifestBytes);
      if (
        digest(manifestBytes) !== stored.manifestDigest ||
        manifest.publicationId !== stored.publicationId ||
        manifest.law.lawId !== stored.lawId ||
        manifest.law.directoryName !== lawDirectoryName ||
        manifest.target.version !== stored.version ||
        manifest.target.publicationNumber !== stored.publicationNumber
      ) {
        throw new PublisherDatabaseError(
          'O manifesto histórico não corresponde à versão publicada.',
        );
      }
      const astBytes = await options.git.readBlob(
        stored.gitCommitSha,
        publicationIdentifiedAstRelativePath(
          lawDirectoryName,
          stored.publicationNumber,
          stored.version,
        ),
      );
      const astText = new TextDecoder('utf-8', { fatal: true }).decode(astBytes);
      const validated = validarIdentifiedNormaAst(JSON.parse(astText) as unknown);
      if (
        !validated.ok ||
        serializeCanonicalJson(validated.valor) !== astText ||
        digest(astBytes) !== manifest.artifacts.identifiedAstSha256 ||
        validated.valor.versaoVinculex !== stored.version ||
        validated.valor.publicationStatus !== 'approved'
      ) {
        throw new PublisherDatabaseError('A AST histórica não corresponde ao manifesto publicado.');
      }
      for (const snapshot of manifest.sourceSnapshots) {
        const bytes = await options.git.readBlob(
          stored.gitCommitSha,
          publicationSourceSnapshotRelativePath(lawDirectoryName, snapshot.sourceArtifactSha256),
        );
        if (digest(bytes) !== snapshot.sourceArtifactSha256) {
          throw new PublisherDatabaseError(
            'Uma fonte histórica não corresponde ao manifesto publicado.',
          );
        }
      }
      return { lawId: stored.lawId, versionId: stored.versionId, ast: validated.valor, manifest };
    },
  };

  const attempts: PublisherAttemptRepository = {
    async findByPublicationId(publicationId, actorUserId) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.get_publication_attempt($1::uuid, $2::uuid) as value`,
        [publicationId, actorUserId],
      );
      return nullableAttemptFrom(rows);
    },
    async findPublished(publicationId, candidateSha, actorUserId) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.find_published_publication($1::uuid, $2::text, $3::uuid) as value`,
        [publicationId, candidateSha, actorUserId],
      );
      return nullableAttemptFrom(rows);
    },
    async prepare(candidate) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.prepare_publication_attempt($1::jsonb) as value`,
        [candidate.payload],
      );
      return valueFrom(rows, attemptSchema);
    },
    async markSyncing(publicationId, candidateSha) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.mark_publication_attempt(
           $1::uuid, $2::text, 'syncing', null, null
         ) as value`,
        [publicationId, candidateSha],
      );
      return valueFrom(rows, attemptSchema);
    },
    async markFailed(publicationId, candidateSha, resumeFromStatus, failureCode) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.mark_publication_attempt(
           $1::uuid, $2::text, 'failed', $3::text, $4::text
         ) as value`,
        [publicationId, candidateSha, resumeFromStatus, failureCode],
      );
      return valueFrom(rows, attemptSchema);
    },
  };

  const transaction: PublisherTransactionGateway = {
    async publishValidated(payload) {
      const rows = await options.sql.query<Record<string, unknown>>(
        `select private.publish_validated_release($1::jsonb) as value`,
        [payload],
      );
      return valueFrom(rows, attemptSchema);
    },
  };

  return Object.freeze({ identities, approvals, baselines, attempts, transaction });
};
