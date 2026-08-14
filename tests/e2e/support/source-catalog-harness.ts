import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  activeSourceImportConfigurationSchema,
  type LawSourceBinding,
  type LawSourceBindingRevision,
  type ProviderRevision,
  type SourceCheckRequestResult,
  type SourceProvider,
  type SourceTestEvidence,
} from '@lex-editor/source-ingestion';
import {
  createNodeSourceDryRunRunner,
  type PlanaltoNetworkPorts,
} from '@lex-editor/source-ingestion/node';

import {
  createSourceCatalogAuthority,
  createSourceCatalogService,
  SourceCatalogAuthorityError,
  type ActivateBindingRevisionInput,
  type ChangeBindingActivationInput,
  type RequestSourceCheckInput,
  type SourceCatalogListItem,
  type SourceCatalogRepository,
} from '../../../services/source-catalog/src/index.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const BASE_VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ACCESS_TOKEN = 'offline-e2e-session';

const conflict = (): never => {
  throw new SourceCatalogAuthorityError('configuration_conflict', 'Conflito de revisão.');
};

const createRepository = (): Readonly<{
  repository: SourceCatalogRepository;
  resolve(sourceUrl: string): ReturnType<typeof activeSourceImportConfigurationSchema.parse> | null;
}> => {
  const providers = new Map<string, SourceProvider>();
  const providerRevisions = new Map<string, ProviderRevision>();
  const bindings = new Map<string, LawSourceBinding>();
  const bindingRevisions = new Map<string, LawSourceBindingRevision>();
  const testEvidence = new Map<string, SourceTestEvidence>();
  const checkRequests = new Map<string, SourceCheckRequestResult>();

  const configuration = (
    providerRevisionId: string,
    bindingRevisionId: string,
  ): Readonly<{
    providerRevision: ProviderRevision;
    bindingRevision: LawSourceBindingRevision;
  }> => {
    const providerRevision = providerRevisions.get(providerRevisionId);
    const bindingRevision = bindingRevisions.get(bindingRevisionId);
    if (
      providerRevision === undefined ||
      bindingRevision?.providerRevisionId !== providerRevisionId
    ) {
      throw new SourceCatalogAuthorityError(
        'configuration_invalid',
        'Configuração não encontrada.',
      );
    }
    return { providerRevision, bindingRevision };
  };

  const activate = (input: ActivateBindingRevisionInput) => {
    const provider = providers.get(input.providerId);
    const binding = bindings.get(input.bindingId);
    const tested = testEvidence.get(input.testEvidenceId);
    const revisions = configuration(input.providerRevisionId, input.bindingRevisionId);
    if (
      provider === undefined ||
      binding === undefined ||
      provider.lockVersion !== input.expectedProviderLockVersion ||
      binding.lockVersion !== input.expectedBindingLockVersion ||
      tested?.sourceTestOutcome !== 'success' ||
      tested.providerRevisionId !== input.providerRevisionId ||
      tested.bindingRevisionId !== input.bindingRevisionId ||
      tested.providerConfigDigest !== revisions.providerRevision.configDigest ||
      tested.bindingConfigDigest !== revisions.bindingRevision.configDigest
    ) {
      return conflict();
    }
    const nextProvider: SourceProvider = {
      ...provider,
      activeProviderRevisionId: input.providerRevisionId,
      sourceActivationState: 'active',
      lockVersion: provider.lockVersion + 1,
    };
    const nextBinding: LawSourceBinding = {
      ...binding,
      activeBindingRevisionId: input.bindingRevisionId,
      sourceActivationState: 'active',
      lockVersion: binding.lockVersion + 1,
    };
    providers.set(nextProvider.providerId, nextProvider);
    bindings.set(nextBinding.bindingId, nextBinding);
    return Promise.resolve({ provider: nextProvider, binding: nextBinding });
  };

  const repository: SourceCatalogRepository = {
    listCatalog(_actorUserId, cursor, limit) {
      const ordered = [...bindings.values()].sort((left, right) =>
        left.bindingId.localeCompare(right.bindingId, 'en-US'),
      );
      const offset =
        cursor === null
          ? 0
          : Math.max(0, ordered.findIndex(({ bindingId }) => bindingId === cursor) + 1);
      const selected = ordered.slice(offset, offset + limit);
      const items = selected.flatMap((binding): SourceCatalogListItem[] => {
        const bindingRevisionId =
          binding.activeBindingRevisionId ??
          [...bindingRevisions.values()]
            .filter((revision) => revision.bindingId === binding.bindingId)
            .sort((left, right) => right.revisionNumber - left.revisionNumber)[0]
            ?.bindingRevisionId;
        if (bindingRevisionId === undefined) return [];
        const bindingRevision = bindingRevisions.get(bindingRevisionId);
        if (bindingRevision === undefined) return [];
        const providerRevision = providerRevisions.get(bindingRevision.providerRevisionId);
        if (providerRevision === undefined) return [];
        const provider = providers.get(providerRevision.providerId);
        if (provider === undefined) return [];
        const lastTest = [...testEvidence.values()]
          .filter((evidence) => evidence.bindingRevisionId === bindingRevisionId)
          .sort((left, right) => right.testedAt.localeCompare(left.testedAt, 'en-US'))[0];
        return [
          {
            providerId: provider.providerId,
            providerRevisionId: providerRevision.providerRevisionId,
            providerRevisionNumber: providerRevision.revisionNumber,
            providerKey: provider.providerKey,
            providerName: providerRevision.providerName,
            adapterId: providerRevision.adapterId,
            adapterContractVersion: providerRevision.adapterContractVersion,
            providerLockVersion: provider.lockVersion,
            bindingId: binding.bindingId,
            bindingRevisionId,
            bindingRevisionNumber: bindingRevision.revisionNumber,
            bindingLockVersion: binding.lockVersion,
            lawId: binding.lawId,
            lawTitle: 'Lei nº 9.099/1995 — origem E2E',
            sourceActivationState: binding.sourceActivationState,
            sourceHealthState: 'unknown',
            monitoringIntervalMs: bindingRevision.monitoringIntervalMs,
            lastSourceTestOutcome: lastTest?.sourceTestOutcome ?? null,
            lastTestEvidenceId: lastTest?.testEvidenceId ?? null,
            lastTestedAt: lastTest?.testedAt ?? null,
            lastCheckedAt: null,
            lastErrorCode: lastTest?.errorCode ?? null,
            artifacts: bindingRevision.artifacts,
          },
        ];
      });
      return Promise.resolve({
        items,
        nextCursor:
          offset + selected.length < ordered.length ? (selected.at(-1)?.bindingId ?? null) : null,
      });
    },
    getProviderRevision(_actorUserId, providerRevisionId) {
      const revision = providerRevisions.get(providerRevisionId);
      return revision === undefined
        ? Promise.reject(new Error('PROVIDER_REVISION_NOT_FOUND'))
        : Promise.resolve(revision);
    },
    getTestConfiguration(_actorUserId, providerRevisionId, bindingRevisionId) {
      return Promise.resolve(configuration(providerRevisionId, bindingRevisionId));
    },
    appendProviderRevision(revision, expectedLockVersion) {
      const current = providers.get(revision.providerId);
      if ((current?.lockVersion ?? 0) !== expectedLockVersion) return conflict();
      const provider: SourceProvider = {
        schemaVersion: 1,
        providerId: revision.providerId,
        providerKey: revision.providerKey,
        activeProviderRevisionId: current?.activeProviderRevisionId ?? null,
        sourceActivationState: current?.sourceActivationState ?? 'draft',
        lockVersion: expectedLockVersion + 1,
      };
      providerRevisions.set(revision.providerRevisionId, revision);
      providers.set(provider.providerId, provider);
      return Promise.resolve({ provider, revision });
    },
    appendBindingRevision(revision, expectedLockVersion) {
      const current = bindings.get(revision.bindingId);
      if ((current?.lockVersion ?? 0) !== expectedLockVersion) return conflict();
      const binding: LawSourceBinding = {
        schemaVersion: 1,
        bindingId: revision.bindingId,
        lawId: revision.lawId,
        activeBindingRevisionId: current?.activeBindingRevisionId ?? null,
        sourceActivationState: current?.sourceActivationState ?? 'draft',
        lockVersion: expectedLockVersion + 1,
      };
      bindingRevisions.set(revision.bindingRevisionId, revision);
      bindings.set(binding.bindingId, binding);
      return Promise.resolve({ binding, revision });
    },
    appendTestEvidence(evidence) {
      testEvidence.set(evidence.testEvidenceId, evidence);
      return Promise.resolve(evidence);
    },
    activateBindingRevision: activate,
    restoreBindingRevision: activate,
    changeBindingActivation(input: ChangeBindingActivationInput) {
      const binding = bindings.get(input.bindingId);
      if (binding?.lockVersion !== input.expectedBindingLockVersion) {
        return conflict();
      }
      const changed: LawSourceBinding = {
        ...binding,
        sourceActivationState: input.targetSourceActivationState,
        lockVersion: binding.lockVersion + 1,
      };
      bindings.set(changed.bindingId, changed);
      return Promise.resolve(changed);
    },
    requestSourceCheck(input: RequestSourceCheckInput) {
      const binding = bindings.get(input.bindingId);
      if (binding?.sourceActivationState !== 'active' || binding.activeBindingRevisionId === null) {
        return conflict();
      }
      const previous = checkRequests.get(input.idempotencyKey);
      if (previous !== undefined) return Promise.resolve({ ...previous, deduplicated: true });
      const bindingRevision = bindingRevisions.get(binding.activeBindingRevisionId);
      if (bindingRevision === undefined) return conflict();
      const result: SourceCheckRequestResult = {
        schemaVersion: 1,
        sourceCheckJobId: randomUUID(),
        bindingId: binding.bindingId,
        bindingRevisionId: bindingRevision.bindingRevisionId,
        providerRevisionId: bindingRevision.providerRevisionId,
        lawId: binding.lawId,
        baseVersionId: BASE_VERSION_ID,
        sourceCheckTrigger: 'manual',
        sourceCheckJobState: 'queued',
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt,
        deduplicated: false,
      };
      checkRequests.set(input.idempotencyKey, result);
      return Promise.resolve(result);
    },
  };

  return {
    repository,
    resolve(sourceUrl) {
      for (const binding of bindings.values()) {
        if (
          binding.sourceActivationState !== 'active' ||
          binding.activeBindingRevisionId === null
        ) {
          continue;
        }
        const bindingRevision = bindingRevisions.get(binding.activeBindingRevisionId);
        if (!bindingRevision?.artifacts.some((artifact) => artifact.sourceUrl === sourceUrl)) {
          continue;
        }
        const providerRevision = providerRevisions.get(bindingRevision.providerRevisionId);
        if (providerRevision === undefined) continue;
        return activeSourceImportConfigurationSchema.parse({ providerRevision, bindingRevision });
      }
      return null;
    },
  };
};

const createFixturePorts = async (): Promise<PlanaltoNetworkPorts> => {
  const fixtures = await Promise.all([
    readFile('fixtures/legal/l9099/snapshot.html'),
    readFile('fixtures/legal/l9605/snapshot.html'),
    readFile('fixtures/legal/l10826/compiled/snapshot.html'),
    readFile('fixtures/legal/l10826/annotated/snapshot.html'),
  ]);
  return {
    resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
    request: ({ url }) => {
      const body = url.pathname.includes('l9605')
        ? fixtures[1]
        : url.pathname.includes('l10.826compilado')
          ? fixtures[2]
          : url.pathname.includes('l10.826')
            ? fixtures[3]
            : fixtures[0];
      return Promise.resolve({
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=windows-1252' },
        body,
      });
    },
  };
};

export const createSourceCatalogE2eHarness = async (options: { storageRoot: string }) => {
  void options.storageRoot;
  const state = createRepository();
  const networkPorts = await createFixturePorts();
  const authority = createSourceCatalogAuthority({
    identities: {
      findByUserId: (userId) =>
        Promise.resolve(
          userId === ADMIN_ID
            ? { userId, accountStatus: 'active', roles: ['source_catalog_admin'] }
            : null,
        ),
    },
    repository: state.repository,
    dryRun: createNodeSourceDryRunRunner(networkPorts),
    generateUuid: randomUUID,
    now: () => new Date(),
  });
  const service = createSourceCatalogService({
    authenticator: {
      authenticate: (token) =>
        Promise.resolve(token === ACCESS_TOKEN ? { userId: ADMIN_ID } : null),
    },
    authority,
  });
  return {
    service,
    getAccessToken: () => ACCESS_TOKEN,
    activeSourceImportResolver: {
      resolve: (sourceUrl: string) => Promise.resolve(state.resolve(sourceUrl)),
    },
    networkPorts,
  };
};
