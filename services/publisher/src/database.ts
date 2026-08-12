import { validarIdentifiedNormaAst } from '@lex-editor/legal-domain';
import { z } from 'zod';

import {
  publicationApprovalSchema,
  type PublicationApproval,
} from '../../../src/shared/publication/approval.js';
import {
  publicationIdentifiedAstRelativePath,
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
      const rows = await options.sql.query<{
        user_id: string;
        account_status: string;
        papel: string;
      }>(
        `select user_id::text, account_status, papel
         from public.usuarios_perfil where user_id = $1::uuid`,
        [publicationUuidSchema.parse(userId)],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        userId: publicationUuidSchema.parse(row.user_id),
        accountStatus: z.enum(['active', 'suspended']).parse(row.account_status),
        roles: row.papel === 'curador' ? ['editor_juridico'] : [],
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
        `select pg_catalog.jsonb_build_object(
           'lawId', law.id,
           'publishedVersionId', law.versao_publicada_id,
           'gitCommitSha', version.git_commit_sha,
           'version', version.versao_vinculex,
           'publicationNumber', version.numero_publicacao
         ) as value
         from public.leis as law
         left join public.versoes_lei as version on version.id = law.versao_publicada_id
         where law.id = $1::uuid`,
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
        })
        .parse(rows[0]?.['value']);
      const [blockRows, redirectRows] = await Promise.all([
        options.sql.query<{ block_id: string }>(
          `select block_id from public.block_ids where lei_id = $1::uuid order by block_id`,
          [parsedLawId],
        ),
        options.sql.query<{ antigo: string; novo: string }>(
          `select origem_block_id as antigo, destino_block_id as novo
           from public.block_id_redirects where lei_id = $1::uuid order by origem_block_id`,
          [parsedLawId],
        ),
      ]);
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
        historicalBlockIds: blockRows.map((row) => row.block_id),
        redirects: redirectRows,
      };
    },
    async versionBelongsToLaw(lawId, versionId) {
      const rows = await options.sql.query<{ found: boolean }>(
        `select exists(
           select 1 from public.versoes_lei where lei_id = $1::uuid and id = $2::uuid
         ) as found`,
        [publicationUuidSchema.parse(lawId), publicationUuidSchema.parse(versionId)],
      );
      return rows[0]?.found === true;
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
