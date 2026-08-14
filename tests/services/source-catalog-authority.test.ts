import type { LawSourceBindingRevision, ProviderRevision } from '@lex-editor/source-ingestion';
import { describe, expect, it, vi } from 'vitest';

import {
  createSourceCatalogAuthority,
  createSourceCatalogImportResolver,
  createSourceCatalogService,
  SourceCatalogAuthenticationError,
  SourceCatalogAuthorityError,
  type SourceCatalogIdentity,
  type SourceCatalogRepository,
  type SourceCatalogSqlClient,
} from '../../services/source-catalog/src/index.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CURATOR_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_REVISION_ID = '44444444-4444-4444-8444-444444444444';
const BINDING_ID = '55555555-5555-4555-8555-555555555555';
const BINDING_REVISION_ID = '66666666-6666-4666-8666-666666666666';
const LAW_ID = '77777777-7777-4777-8777-777777777777';
const TEST_ID = '88888888-8888-4888-8888-888888888888';
const DIGEST = 'a'.repeat(64);

const identity = (userId: string, roles: string[]): SourceCatalogIdentity => ({
  userId,
  accountStatus: 'active',
  roles,
});

const createIdentities = (values: SourceCatalogIdentity[]) => ({
  findByUserId(userId: string) {
    return Promise.resolve(values.find((value) => value.userId === userId) ?? null);
  },
});

const createRepository = () => {
  const providerRevisions: unknown[] = [];
  const bindingRevisions: unknown[] = [];
  const evidence: unknown[] = [];
  const activations: unknown[] = [];
  const restorations: unknown[] = [];
  const activationChanges: unknown[] = [];
  const sourceCheckRequests: unknown[] = [];
  const providers = new Map<string, ProviderRevision>();
  const bindings = new Map<string, LawSourceBindingRevision>();
  const repository: SourceCatalogRepository = {
    listCatalog() {
      return Promise.resolve({ items: [], nextCursor: null });
    },
    getProviderRevision(_actorUserId, providerRevisionId) {
      const revision = providers.get(providerRevisionId);
      if (revision === undefined) return Promise.reject(new Error('provider not found'));
      return Promise.resolve(revision);
    },
    getTestConfiguration(_actorUserId, providerRevisionId, bindingRevisionId) {
      const providerRevision = providers.get(providerRevisionId);
      const bindingRevision = bindings.get(bindingRevisionId);
      if (providerRevision === undefined || bindingRevision === undefined) {
        return Promise.reject(new Error('configuration not found'));
      }
      return Promise.resolve({ providerRevision, bindingRevision });
    },
    appendProviderRevision(revision) {
      providerRevisions.push(revision);
      providers.set(revision.providerRevisionId, revision);
      return Promise.resolve({
        provider: {
          schemaVersion: 1,
          providerId: revision.providerId,
          providerKey: revision.providerKey,
          activeProviderRevisionId: null,
          sourceActivationState: 'draft',
          lockVersion: revision.revisionNumber,
        },
        revision,
      });
    },
    appendBindingRevision(revision) {
      bindingRevisions.push(revision);
      bindings.set(revision.bindingRevisionId, revision);
      return Promise.resolve({
        binding: {
          schemaVersion: 1,
          bindingId: revision.bindingId,
          lawId: revision.lawId,
          activeBindingRevisionId: null,
          sourceActivationState: 'draft',
          lockVersion: revision.revisionNumber,
        },
        revision,
      });
    },
    appendTestEvidence(value) {
      evidence.push(value);
      return Promise.resolve(value);
    },
    activateBindingRevision(value) {
      activations.push(value);
      return Promise.resolve({
        provider: {
          schemaVersion: 1,
          providerId: value.providerId,
          providerKey: 'planalto-oficial',
          activeProviderRevisionId: value.providerRevisionId,
          sourceActivationState: 'active',
          lockVersion: value.expectedProviderLockVersion + 1,
        },
        binding: {
          schemaVersion: 1,
          bindingId: value.bindingId,
          lawId: LAW_ID,
          activeBindingRevisionId: value.bindingRevisionId,
          sourceActivationState: 'active',
          lockVersion: value.expectedBindingLockVersion + 1,
        },
      });
    },
    restoreBindingRevision(value) {
      restorations.push(value);
      return Promise.resolve({
        provider: {
          schemaVersion: 1,
          providerId: value.providerId,
          providerKey: 'planalto-oficial',
          activeProviderRevisionId: value.providerRevisionId,
          sourceActivationState: 'active',
          lockVersion: value.expectedProviderLockVersion + 1,
        },
        binding: {
          schemaVersion: 1,
          bindingId: value.bindingId,
          lawId: LAW_ID,
          activeBindingRevisionId: value.bindingRevisionId,
          sourceActivationState: 'active',
          lockVersion: value.expectedBindingLockVersion + 1,
        },
      });
    },
    changeBindingActivation(value) {
      activationChanges.push(value);
      return Promise.resolve({
        schemaVersion: 1,
        bindingId: value.bindingId,
        lawId: LAW_ID,
        activeBindingRevisionId: BINDING_REVISION_ID,
        sourceActivationState: value.targetSourceActivationState,
        lockVersion: value.expectedBindingLockVersion + 1,
      });
    },
    requestSourceCheck(value) {
      sourceCheckRequests.push(value);
      return Promise.resolve({
        schemaVersion: 1,
        sourceCheckJobId: TEST_ID,
        bindingId: value.bindingId,
        bindingRevisionId: BINDING_REVISION_ID,
        providerRevisionId: PROVIDER_REVISION_ID,
        lawId: LAW_ID,
        baseVersionId: PROVIDER_ID,
        sourceCheckTrigger: 'manual',
        sourceCheckJobState: 'queued',
        idempotencyKey: value.idempotencyKey,
        requestedAt: value.requestedAt,
        deduplicated: false,
      });
    },
  };
  return {
    repository,
    providerRevisions,
    bindingRevisions,
    evidence,
    activations,
    restorations,
    activationChanges,
    sourceCheckRequests,
  };
};

const providerRequest = () => ({
  providerId: PROVIDER_ID,
  providerKey: 'planalto-oficial',
  expectedLockVersion: 0,
  providerName: 'Portal da Legislação do Planalto',
  sourceType: 'planalto_html' as const,
  adapterId: 'planalto.html',
  adapterContractVersion: 1,
  origin: { scheme: 'https' as const, host: 'www.planalto.gov.br', port: null, pathPrefix: '/' },
  detectionParameters: { requireLegalHeader: true },
  configDigest: DIGEST,
});

const dryRun = {
  run: () =>
    Promise.resolve({
      sourceTestOutcome: 'success' as const,
      completedStage: 'adapter' as const,
      evidenceDigest: DIGEST,
      errorCode: null,
    }),
};

describe('source catalog authority', () => {
  it('derives actor and immutable revision metadata from the authenticated administrator', async () => {
    const stored = createRepository();
    const ids = [PROVIDER_REVISION_ID, BINDING_REVISION_ID, TEST_ID];
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => ids.shift() ?? TEST_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    await authority.createProviderRevision(ADMIN_ID, providerRequest());
    await authority.createBindingRevision(ADMIN_ID, {
      bindingId: BINDING_ID,
      lawId: LAW_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      expectedLockVersion: 0,
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current',
          sourceVariant: 'compiled',
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
        },
      ],
      monitoringIntervalMs: 86_400_000,
      configDigest: DIGEST,
    });
    await authority.dryRunBindingRevision(ADMIN_ID, {
      providerRevisionId: PROVIDER_REVISION_ID,
      bindingRevisionId: BINDING_REVISION_ID,
    });
    await authority.activateBindingRevision(ADMIN_ID, {
      providerId: PROVIDER_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      expectedProviderLockVersion: 1,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      expectedBindingLockVersion: 1,
      testEvidenceId: TEST_ID,
    });

    expect(stored.providerRevisions).toMatchObject([
      { createdByUserId: ADMIN_ID, revisionNumber: 1, providerRevisionId: PROVIDER_REVISION_ID },
    ]);
    expect(stored.bindingRevisions).toMatchObject([
      { createdByUserId: ADMIN_ID, revisionNumber: 1, bindingRevisionId: BINDING_REVISION_ID },
    ]);
    expect(stored.evidence).toMatchObject([{ testedByUserId: ADMIN_ID, testEvidenceId: TEST_ID }]);
    expect(stored.activations).toMatchObject([{ actorUserId: ADMIN_ID, testEvidenceId: TEST_ID }]);
  });

  it('persists the server dry-run result and rejects client-authored evidence fields', async () => {
    const stored = createRepository();
    const run = vi.fn(() =>
      Promise.resolve({
        sourceTestOutcome: 'failure' as const,
        completedStage: 'network' as const,
        evidenceDigest: 'b'.repeat(64),
        errorCode: 'NETWORK_TIMEOUT',
      }),
    );
    const ids = [PROVIDER_REVISION_ID, BINDING_REVISION_ID, TEST_ID];
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun: { run },
      generateUuid: () => ids.shift() ?? TEST_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    await authority.createProviderRevision(ADMIN_ID, providerRequest());
    await authority.createBindingRevision(ADMIN_ID, {
      bindingId: BINDING_ID,
      lawId: LAW_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      expectedLockVersion: 0,
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current',
          sourceVariant: 'annotated',
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm',
        },
      ],
      monitoringIntervalMs: 86_400_000,
      configDigest: DIGEST,
    });
    await authority.dryRunBindingRevision(ADMIN_ID, {
      providerRevisionId: PROVIDER_REVISION_ID,
      bindingRevisionId: BINDING_REVISION_ID,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(stored.evidence).toMatchObject([
      {
        sourceTestOutcome: 'failure',
        completedStage: 'network',
        errorCode: 'NETWORK_TIMEOUT',
        providerConfigDigest: DIGEST,
        bindingConfigDigest: DIGEST,
      },
    ]);
    const forged = {
      providerRevisionId: PROVIDER_REVISION_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      sourceTestOutcome: 'success',
      evidenceDigest: DIGEST,
    } as unknown as Parameters<typeof authority.dryRunBindingRevision>[1];
    await expect(authority.dryRunBindingRevision(ADMIN_ID, forged)).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });

  it('revalidates role and account state for every mutation', async () => {
    const stored = createRepository();
    const identities = [identity(ADMIN_ID, ['source_catalog_admin'])];
    const authority = createSourceCatalogAuthority({
      identities: createIdentities(identities),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    await authority.createProviderRevision(ADMIN_ID, providerRequest());
    identities[0] = identity(ADMIN_ID, []);
    await expect(
      authority.createProviderRevision(ADMIN_ID, providerRequest()),
    ).rejects.toBeInstanceOf(SourceCatalogAuthorityError);
    await expect(
      authority.createProviderRevision(CURATOR_ID, providerRequest()),
    ).rejects.toMatchObject({ code: 'identity_not_authorized' });
  });

  it('authorizes list, pause, archive and restore server-side without accepting lifecycle authority', async () => {
    const stored = createRepository();
    const ids = [PROVIDER_REVISION_ID, BINDING_REVISION_ID];
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => ids.shift() ?? TEST_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    await authority.createProviderRevision(ADMIN_ID, providerRequest());
    await authority.createBindingRevision(ADMIN_ID, {
      bindingId: BINDING_ID,
      lawId: LAW_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      expectedLockVersion: 0,
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current',
          sourceVariant: 'compiled',
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
        },
      ],
      monitoringIntervalMs: 86_400_000,
      configDigest: DIGEST,
    });

    await expect(authority.listCatalog(ADMIN_ID, { cursor: null, limit: 25 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await authority.pauseBinding(ADMIN_ID, {
      bindingId: BINDING_ID,
      expectedBindingLockVersion: 2,
    });
    await authority.archiveBinding(ADMIN_ID, {
      bindingId: BINDING_ID,
      expectedBindingLockVersion: 3,
    });
    await authority.restoreBindingRevision(ADMIN_ID, {
      providerId: PROVIDER_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      expectedProviderLockVersion: 2,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      expectedBindingLockVersion: 4,
      testEvidenceId: TEST_ID,
    });

    expect(stored.activationChanges).toEqual([
      {
        actorUserId: ADMIN_ID,
        bindingId: BINDING_ID,
        expectedBindingLockVersion: 2,
        targetSourceActivationState: 'paused',
      },
      {
        actorUserId: ADMIN_ID,
        bindingId: BINDING_ID,
        expectedBindingLockVersion: 3,
        targetSourceActivationState: 'archived',
      },
    ]);
    expect(stored.restorations).toEqual([
      expect.objectContaining({ actorUserId: ADMIN_ID, testEvidenceId: TEST_ID }),
    ]);

    await expect(
      authority.pauseBinding(ADMIN_ID, {
        bindingId: BINDING_ID,
        expectedBindingLockVersion: 4,
        targetSourceActivationState: 'active',
      } as unknown as Parameters<typeof authority.pauseBinding>[1]),
    ).rejects.toThrow();
  });

  it('propagates optimistic conflicts instead of reporting lifecycle success', async () => {
    const stored = createRepository();
    stored.repository.changeBindingActivation = vi.fn(() =>
      Promise.reject(new SourceCatalogAuthorityError('configuration_conflict', 'conflict')),
    );
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });

    await expect(
      authority.pauseBinding(ADMIN_ID, {
        bindingId: BINDING_ID,
        expectedBindingLockVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'configuration_conflict' });
  });

  it('authorizes Verificar agora server-side and derives actor and time', async () => {
    const stored = createRepository();
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T18:30:00.000Z'),
    });

    await expect(
      authority.requestSourceCheck(ADMIN_ID, {
        bindingId: BINDING_ID,
        idempotencyKey: 'verify-now:binding-1',
      }),
    ).resolves.toMatchObject({
      bindingId: BINDING_ID,
      sourceCheckTrigger: 'manual',
      sourceCheckJobState: 'queued',
      deduplicated: false,
    });
    expect(stored.sourceCheckRequests).toEqual([
      {
        actorUserId: ADMIN_ID,
        bindingId: BINDING_ID,
        idempotencyKey: 'verify-now:binding-1',
        requestedAt: '2026-08-13T18:30:00.000Z',
      },
    ]);

    await expect(
      authority.requestSourceCheck(CURATOR_ID, {
        bindingId: BINDING_ID,
        idempotencyKey: 'verify-now:forbidden',
      }),
    ).rejects.toMatchObject({ code: 'identity_not_authorized' });
    await expect(
      authority.requestSourceCheck(ADMIN_ID, {
        bindingId: BINDING_ID,
        idempotencyKey: 'verify-now:forged',
        actorUserId: CURATOR_ID,
        requestedAt: '2030-01-01T00:00:00.000Z',
        sourceCheckJobState: 'completed',
      } as unknown as Parameters<typeof authority.requestSourceCheck>[1]),
    ).rejects.toThrow();
    expect(stored.sourceCheckRequests).toHaveLength(1);
  });

  it('propagates Verificar agora conflicts instead of reporting a queued job', async () => {
    const stored = createRepository();
    stored.repository.requestSourceCheck = vi.fn(() =>
      Promise.reject(new SourceCatalogAuthorityError('configuration_conflict', 'conflict')),
    );
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T18:30:00.000Z'),
    });

    await expect(
      authority.requestSourceCheck(ADMIN_ID, {
        bindingId: BINDING_ID,
        idempotencyKey: 'verify-now:conflict',
      }),
    ).rejects.toMatchObject({ code: 'configuration_conflict' });
  });

  it('does not accept actor or lifecycle fields supplied by the business request', async () => {
    const stored = createRepository();
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    const hostileRequest = {
      ...providerRequest(),
      createdByUserId: CURATOR_ID,
      sourceActivationState: 'active',
    } as unknown as Parameters<typeof authority.createProviderRevision>[1];
    await expect(authority.createProviderRevision(ADMIN_ID, hostileRequest)).rejects.toThrow();
  });

  it('derives the actor from authentication rather than the client request', async () => {
    const stored = createRepository();
    const authority = createSourceCatalogAuthority({
      identities: createIdentities([identity(ADMIN_ID, ['source_catalog_admin'])]),
      repository: stored.repository,
      dryRun,
      generateUuid: () => PROVIDER_REVISION_ID,
      now: () => new Date('2026-08-13T15:00:00.000Z'),
    });
    const service = createSourceCatalogService({
      authenticator: {
        authenticate: (token) => Promise.resolve(token === 'valid' ? { userId: ADMIN_ID } : null),
      },
      authority,
    });
    await service.createProviderRevision('valid', providerRequest());
    await expect(
      service.createProviderRevision('invalid', providerRequest()),
    ).rejects.toBeInstanceOf(SourceCatalogAuthenticationError);
    expect(stored.providerRevisions).toMatchObject([{ createdByUserId: ADMIN_ID }]);
  });
});

describe('source catalog import resolver', () => {
  it('consulta somente a função dedicada com a URL exata e representa ausência explicitamente', async () => {
    const calls: [string, readonly unknown[] | undefined][] = [];
    const query: SourceCatalogSqlClient['query'] = <T extends Record<string, unknown>>(
      text: string,
      parameters?: readonly unknown[],
    ) => {
      calls.push([text, parameters]);
      return Promise.resolve([{ value: null }] as unknown as readonly T[]);
    };
    const resolver = createSourceCatalogImportResolver({ query });
    const sourceUrl = 'https://www.planalto.gov.br/ccivil_03/leis/l9605.htm';

    await expect(resolver.resolve(sourceUrl)).resolves.toBeNull();
    expect(calls).toEqual([
      ['select private.resolve_active_source_import($1::text) as value', [sourceUrl]],
    ]);
  });
});
