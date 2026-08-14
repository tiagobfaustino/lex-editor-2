import {
  activeSourceImportConfigurationSchema,
  lawSourceBindingRevisionSchema,
  lawSourceBindingSchema,
  lawSourceArtifactSchema,
  providerRevisionSchema,
  sourceCatalogUuidSchema,
  sourceActivationStateSchema,
  sourceHealthStateSchema,
  sourceTestOutcomeSchema,
  sourceCatalogTimestampSchema,
  sourceProviderSchema,
  sourceCheckRequestResultSchema,
  sourceTestEvidenceSchema,
} from '@lex-editor/source-ingestion';
import { z } from 'zod';

import type { SourceCatalogIdentityRepository } from './authority.js';
import type { SourceCatalogRepository } from './repository.js';

export interface SourceCatalogSqlClient {
  query<T extends Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
}

export class SourceCatalogDatabaseError extends Error {
  constructor(message = 'A persistência do catálogo de fontes falhou.') {
    super(message);
  }
}

const providerRevisionResultSchema = z.strictObject({
  provider: sourceProviderSchema,
  revision: providerRevisionSchema,
});
const bindingRevisionResultSchema = z.strictObject({
  binding: lawSourceBindingSchema,
  revision: lawSourceBindingRevisionSchema,
});
const activationResultSchema = z.strictObject({
  provider: sourceProviderSchema,
  binding: lawSourceBindingSchema,
});
const testConfigurationSchema = z.strictObject({
  providerRevision: providerRevisionSchema,
  bindingRevision: lawSourceBindingRevisionSchema,
});
const sourceCatalogListItemSchema = z.strictObject({
  providerId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  providerRevisionNumber: z.int().positive(),
  providerKey: z.string().min(3).max(80),
  providerName: z.string().min(3).max(160),
  adapterId: z.string().min(1).max(80),
  adapterContractVersion: z.int().positive(),
  providerLockVersion: z.int().nonnegative(),
  bindingId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
  bindingRevisionNumber: z.int().positive(),
  bindingLockVersion: z.int().nonnegative(),
  lawId: sourceCatalogUuidSchema,
  lawTitle: z.string().min(1).max(500),
  sourceActivationState: sourceActivationStateSchema,
  sourceHealthState: sourceHealthStateSchema,
  monitoringIntervalMs: z.int().positive(),
  lastSourceTestOutcome: sourceTestOutcomeSchema.nullable(),
  lastTestEvidenceId: sourceCatalogUuidSchema.nullable(),
  lastTestedAt: sourceCatalogTimestampSchema.nullable(),
  lastCheckedAt: sourceCatalogTimestampSchema.nullable(),
  lastErrorCode: z.string().min(3).max(80).nullable(),
  artifacts: z.array(lawSourceArtifactSchema).min(1).max(10),
});
const sourceCatalogPageSchema = z.strictObject({
  items: z.array(sourceCatalogListItemSchema).max(50),
  nextCursor: sourceCatalogUuidSchema.nullable(),
});

const singleValue = <T>(rows: readonly Record<string, unknown>[], schema: z.ZodType<T>): T => {
  if (rows.length !== 1 || rows[0]?.['value'] === undefined) {
    throw new SourceCatalogDatabaseError();
  }
  return schema.parse(rows[0]['value']);
};

export const createSourceCatalogDatabase = (
  sql: SourceCatalogSqlClient,
): Readonly<{
  identities: SourceCatalogIdentityRepository;
  repository: SourceCatalogRepository;
}> => ({
  identities: {
    async findByUserId(userId) {
      const rows = await sql.query<{
        user_id: string;
        account_status: string;
        papel: string;
      }>(
        `select user_id::text, account_status, papel
         from public.usuarios_perfil where user_id = $1::uuid`,
        [sourceCatalogUuidSchema.parse(userId)],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        userId: sourceCatalogUuidSchema.parse(row.user_id),
        accountStatus: z.enum(['active', 'suspended']).parse(row.account_status),
        roles: row.papel === 'administrador' ? ['source_catalog_admin'] : [],
      };
    },
  },
  repository: {
    async listCatalog(actorUserId, cursor, limit) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.list_source_catalog(
           $1::uuid, $2::uuid, $3::integer
         ) as value`,
        [
          sourceCatalogUuidSchema.parse(actorUserId),
          cursor === null ? null : sourceCatalogUuidSchema.parse(cursor),
          z.int().min(1).max(50).parse(limit),
        ],
      );
      return singleValue(rows, sourceCatalogPageSchema);
    },
    async getProviderRevision(actorUserId, providerRevisionId) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.get_source_catalog_provider_revision(
           $1::uuid, $2::uuid
         ) as value`,
        [
          sourceCatalogUuidSchema.parse(actorUserId),
          sourceCatalogUuidSchema.parse(providerRevisionId),
        ],
      );
      return singleValue(rows, providerRevisionSchema);
    },
    async getTestConfiguration(actorUserId, providerRevisionId, bindingRevisionId) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.get_source_catalog_test_configuration(
           $1::uuid, $2::uuid, $3::uuid
         ) as value`,
        [
          sourceCatalogUuidSchema.parse(actorUserId),
          sourceCatalogUuidSchema.parse(providerRevisionId),
          sourceCatalogUuidSchema.parse(bindingRevisionId),
        ],
      );
      return singleValue(rows, testConfigurationSchema);
    },
    async appendProviderRevision(revision, expectedLockVersion) {
      const parsed = providerRevisionSchema.parse(revision);
      const rows = await sql.query<Record<string, unknown>>(
        `select private.append_source_provider_revision(
           $1::uuid, $2::integer, $3::jsonb
         ) as value`,
        [parsed.createdByUserId, expectedLockVersion, parsed],
      );
      return singleValue(rows, providerRevisionResultSchema);
    },
    async appendBindingRevision(revision, expectedLockVersion) {
      const parsed = lawSourceBindingRevisionSchema.parse(revision);
      const rows = await sql.query<Record<string, unknown>>(
        `select private.append_law_source_binding_revision(
           $1::uuid, $2::integer, $3::jsonb
         ) as value`,
        [parsed.createdByUserId, expectedLockVersion, parsed],
      );
      return singleValue(rows, bindingRevisionResultSchema);
    },
    async appendTestEvidence(evidence) {
      const parsed = sourceTestEvidenceSchema.parse(evidence);
      const rows = await sql.query<Record<string, unknown>>(
        `select private.append_source_test_evidence($1::uuid, $2::jsonb) as value`,
        [parsed.testedByUserId, parsed],
      );
      return singleValue(rows, sourceTestEvidenceSchema);
    },
    async activateBindingRevision(input) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.activate_law_source_binding_revision(
           $1::uuid, $2::uuid, $3::uuid, $4::integer,
           $5::uuid, $6::uuid, $7::integer, $8::uuid
         ) as value`,
        [
          input.actorUserId,
          input.providerId,
          input.providerRevisionId,
          input.expectedProviderLockVersion,
          input.bindingId,
          input.bindingRevisionId,
          input.expectedBindingLockVersion,
          input.testEvidenceId,
        ],
      );
      return singleValue(rows, activationResultSchema);
    },
    async restoreBindingRevision(input) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.restore_law_source_binding_revision(
           $1::uuid, $2::uuid, $3::uuid, $4::integer,
           $5::uuid, $6::uuid, $7::integer, $8::uuid
         ) as value`,
        [
          input.actorUserId,
          input.providerId,
          input.providerRevisionId,
          input.expectedProviderLockVersion,
          input.bindingId,
          input.bindingRevisionId,
          input.expectedBindingLockVersion,
          input.testEvidenceId,
        ],
      );
      return singleValue(rows, activationResultSchema);
    },
    async changeBindingActivation(input) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.change_law_source_binding_activation(
           $1::uuid, $2::uuid, $3::integer, $4::text
         ) as value`,
        [
          input.actorUserId,
          input.bindingId,
          input.expectedBindingLockVersion,
          input.targetSourceActivationState,
        ],
      );
      return singleValue(rows, lawSourceBindingSchema);
    },
    async requestSourceCheck(input) {
      const rows = await sql.query<Record<string, unknown>>(
        `select private.request_source_check(
           $1::uuid, $2::uuid, $3::text, $4::timestamptz
         ) as value`,
        [input.actorUserId, input.bindingId, input.idempotencyKey, input.requestedAt],
      );
      return singleValue(rows, sourceCheckRequestResultSchema);
    },
  },
});

export const createSourceCatalogImportResolver = (
  sql: SourceCatalogSqlClient,
): import('./repository.js').ActiveSourceImportResolver => ({
  async resolve(sourceUrl) {
    const parsedUrl = z.url().max(2_048).parse(sourceUrl);
    const rows = await sql.query<Record<string, unknown>>(
      'select private.resolve_active_source_import($1::text) as value',
      [parsedUrl],
    );
    if (rows.length !== 1 || rows[0]?.['value'] === undefined) {
      throw new SourceCatalogDatabaseError();
    }
    if (rows[0]['value'] === null) return null;
    return activeSourceImportConfigurationSchema.parse(rows[0]['value']);
  },
});
