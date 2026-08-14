import {
  lawSourceArtifactSchema,
  lawSourceBindingRevisionSchema,
  installedSourceAdapterRegistry,
  officialRemoteSourceTypeSchema,
  providerRevisionSchema,
  sourceCatalogDigestSchema,
  sourceCatalogTimestampSchema,
  sourceCatalogUuidSchema,
  sourceDetectionParametersSchema,
  sourceOriginSchema,
  sourceTestEvidenceSchema,
  type SourceAdapterRegistry,
  type LawSourceBindingRevision,
  type ProviderRevision,
  type SourceTestEvidence,
} from '@lex-editor/source-ingestion';
import { z } from 'zod';

import type { SourceCatalogDryRunRunner, SourceCatalogRepository } from './repository.js';

const sourceCatalogIdentitySchema = z.strictObject({
  userId: sourceCatalogUuidSchema,
  accountStatus: z.enum(['active', 'suspended']),
  roles: z.array(z.string().min(1).max(80)).max(20),
});

export type SourceCatalogIdentity = z.infer<typeof sourceCatalogIdentitySchema>;

export interface SourceCatalogIdentityRepository {
  findByUserId(userId: string): Promise<SourceCatalogIdentity | null>;
}

export class SourceCatalogAuthorityError extends Error {
  constructor(
    readonly code: 'identity_not_authorized' | 'configuration_conflict' | 'configuration_invalid',
    message: string,
  ) {
    super(message);
  }
}

export const createProviderRevisionRequestSchema = z.strictObject({
  providerId: sourceCatalogUuidSchema.optional(),
  providerKey: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  expectedLockVersion: z.int().nonnegative(),
  providerName: z.string().trim().min(3).max(160),
  sourceType: officialRemoteSourceTypeSchema,
  adapterId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
  adapterContractVersion: z.int().positive().max(1_000_000),
  origin: sourceOriginSchema,
  detectionParameters: sourceDetectionParametersSchema,
  configDigest: sourceCatalogDigestSchema,
});

export const createBindingRevisionRequestSchema = z.strictObject({
  bindingId: sourceCatalogUuidSchema.optional(),
  lawId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  expectedLockVersion: z.int().nonnegative(),
  artifacts: z.array(lawSourceArtifactSchema).min(1).max(10),
  monitoringIntervalMs: z
    .int()
    .min(60 * 60 * 1_000)
    .max(31 * 24 * 60 * 60 * 1_000),
  configDigest: sourceCatalogDigestSchema,
});

export const dryRunBindingRevisionRequestSchema = z.strictObject({
  providerRevisionId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
});

export const activateBindingRevisionRequestSchema = z.strictObject({
  providerId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  expectedProviderLockVersion: z.int().nonnegative(),
  bindingId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
  expectedBindingLockVersion: z.int().nonnegative(),
  testEvidenceId: sourceCatalogUuidSchema,
});

export const listSourceCatalogRequestSchema = z.strictObject({
  cursor: sourceCatalogUuidSchema.nullable(),
  limit: z.int().min(1).max(50),
});

export const changeBindingActivationRequestSchema = z.strictObject({
  bindingId: sourceCatalogUuidSchema,
  expectedBindingLockVersion: z.int().nonnegative(),
});

export const requestSourceCheckRequestSchema = z.strictObject({
  bindingId: sourceCatalogUuidSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
});

export type CreateProviderRevisionRequest = z.infer<typeof createProviderRevisionRequestSchema>;
export type CreateBindingRevisionRequest = z.infer<typeof createBindingRevisionRequestSchema>;
export type DryRunBindingRevisionRequest = z.infer<typeof dryRunBindingRevisionRequestSchema>;
export type ActivateBindingRevisionRequest = z.infer<typeof activateBindingRevisionRequestSchema>;
export type ListSourceCatalogRequest = z.infer<typeof listSourceCatalogRequestSchema>;
export type ChangeBindingActivationRequest = z.infer<typeof changeBindingActivationRequestSchema>;
export type RequestSourceCheckRequest = z.infer<typeof requestSourceCheckRequestSchema>;

const assertAdministrator = async (
  identities: SourceCatalogIdentityRepository,
  actorUserId: string,
): Promise<SourceCatalogIdentity> => {
  const userId = sourceCatalogUuidSchema.parse(actorUserId);
  const rawIdentity = await identities.findByUserId(userId);
  if (rawIdentity === null) {
    throw new SourceCatalogAuthorityError(
      'identity_not_authorized',
      'A identidade autenticada não pode administrar fontes.',
    );
  }
  const identity = sourceCatalogIdentitySchema.parse(rawIdentity);
  if (
    identity.userId !== userId ||
    identity.accountStatus !== 'active' ||
    !identity.roles.includes('source_catalog_admin')
  ) {
    throw new SourceCatalogAuthorityError(
      'identity_not_authorized',
      'A identidade autenticada não pode administrar fontes.',
    );
  }
  return identity;
};

export const createSourceCatalogAuthority = (options: {
  identities: SourceCatalogIdentityRepository;
  repository: SourceCatalogRepository;
  dryRun: SourceCatalogDryRunRunner;
  adapters?: SourceAdapterRegistry;
  generateUuid(): string;
  now(): Date;
}) => {
  const adapters = options.adapters ?? installedSourceAdapterRegistry;
  return {
    async listCatalog(actorUserId: string, rawRequest: ListSourceCatalogRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = listSourceCatalogRequestSchema.parse(rawRequest);
      return options.repository.listCatalog(identity.userId, request.cursor, request.limit);
    },
    async createProviderRevision(actorUserId: string, rawRequest: CreateProviderRevisionRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = createProviderRevisionRequestSchema.parse(rawRequest);
      const revision: ProviderRevision = providerRevisionSchema.parse({
        schemaVersion: 1,
        providerRevisionId: options.generateUuid(),
        providerId: request.providerId ?? options.generateUuid(),
        revisionNumber: request.expectedLockVersion + 1,
        providerKey: request.providerKey,
        providerName: request.providerName,
        sourceType: request.sourceType,
        adapterId: request.adapterId,
        adapterContractVersion: request.adapterContractVersion,
        origin: request.origin,
        detectionParameters: request.detectionParameters,
        configDigest: request.configDigest,
        createdByUserId: identity.userId,
        createdAt: sourceCatalogTimestampSchema.parse(options.now().toISOString()),
      });
      adapters.validateProviderRevision(revision);
      return options.repository.appendProviderRevision(revision, request.expectedLockVersion);
    },

    async createBindingRevision(actorUserId: string, rawRequest: CreateBindingRevisionRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = createBindingRevisionRequestSchema.parse(rawRequest);
      const revision: LawSourceBindingRevision = lawSourceBindingRevisionSchema.parse({
        schemaVersion: 1,
        bindingRevisionId: options.generateUuid(),
        bindingId: request.bindingId ?? options.generateUuid(),
        lawId: request.lawId,
        providerRevisionId: request.providerRevisionId,
        revisionNumber: request.expectedLockVersion + 1,
        artifacts: request.artifacts,
        monitoringIntervalMs: request.monitoringIntervalMs,
        configDigest: request.configDigest,
        createdByUserId: identity.userId,
        createdAt: sourceCatalogTimestampSchema.parse(options.now().toISOString()),
      });
      const provider = await options.repository.getProviderRevision(
        identity.userId,
        revision.providerRevisionId,
      );
      adapters.validateBindingRevision(provider, revision);
      return options.repository.appendBindingRevision(revision, request.expectedLockVersion);
    },

    async dryRunBindingRevision(actorUserId: string, rawRequest: DryRunBindingRevisionRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = dryRunBindingRevisionRequestSchema.parse(rawRequest);
      const configuration = await options.repository.getTestConfiguration(
        identity.userId,
        request.providerRevisionId,
        request.bindingRevisionId,
      );
      const execution = await options.dryRun.run(
        configuration.providerRevision,
        configuration.bindingRevision,
      );
      const evidence: SourceTestEvidence = sourceTestEvidenceSchema.parse({
        schemaVersion: 1,
        testEvidenceId: options.generateUuid(),
        providerRevisionId: configuration.providerRevision.providerRevisionId,
        bindingRevisionId: configuration.bindingRevision.bindingRevisionId,
        providerConfigDigest: configuration.providerRevision.configDigest,
        bindingConfigDigest: configuration.bindingRevision.configDigest,
        adapterId: configuration.providerRevision.adapterId,
        adapterContractVersion: configuration.providerRevision.adapterContractVersion,
        ...execution,
        testedByUserId: identity.userId,
        testedAt: sourceCatalogTimestampSchema.parse(options.now().toISOString()),
      });
      return options.repository.appendTestEvidence(evidence);
    },

    async activateBindingRevision(actorUserId: string, rawRequest: ActivateBindingRevisionRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = activateBindingRevisionRequestSchema.parse(rawRequest);
      const configuration = await options.repository.getTestConfiguration(
        identity.userId,
        request.providerRevisionId,
        request.bindingRevisionId,
      );
      adapters.validateBindingRevision(
        configuration.providerRevision,
        configuration.bindingRevision,
      );
      return options.repository.activateBindingRevision({
        ...request,
        actorUserId: identity.userId,
      });
    },
    async pauseBinding(actorUserId: string, rawRequest: ChangeBindingActivationRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = changeBindingActivationRequestSchema.parse(rawRequest);
      return options.repository.changeBindingActivation({
        ...request,
        actorUserId: identity.userId,
        targetSourceActivationState: 'paused',
      });
    },
    async archiveBinding(actorUserId: string, rawRequest: ChangeBindingActivationRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = changeBindingActivationRequestSchema.parse(rawRequest);
      return options.repository.changeBindingActivation({
        ...request,
        actorUserId: identity.userId,
        targetSourceActivationState: 'archived',
      });
    },
    async restoreBindingRevision(actorUserId: string, rawRequest: ActivateBindingRevisionRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = activateBindingRevisionRequestSchema.parse(rawRequest);
      const configuration = await options.repository.getTestConfiguration(
        identity.userId,
        request.providerRevisionId,
        request.bindingRevisionId,
      );
      adapters.validateBindingRevision(
        configuration.providerRevision,
        configuration.bindingRevision,
      );
      return options.repository.restoreBindingRevision({
        ...request,
        actorUserId: identity.userId,
      });
    },
    async requestSourceCheck(actorUserId: string, rawRequest: RequestSourceCheckRequest) {
      const identity = await assertAdministrator(options.identities, actorUserId);
      const request = requestSourceCheckRequestSchema.parse(rawRequest);
      return options.repository.requestSourceCheck({
        actorUserId: identity.userId,
        bindingId: request.bindingId,
        idempotencyKey: request.idempotencyKey,
        requestedAt: sourceCatalogTimestampSchema.parse(options.now().toISOString()),
      });
    },
  };
};

export type SourceCatalogAuthority = ReturnType<typeof createSourceCatalogAuthority>;
