import { describe, expect, it, vi } from 'vitest';

import type { SourceCatalogService } from '../../services/source-catalog/src/index.js';
import { createDesktopSourceCatalogIpcCapabilities } from '../../src/main/source-catalog-ipc-capabilities.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_REVISION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const BINDING_REVISION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_EVIDENCE_ID = '66666666-6666-4666-8666-666666666666';
const CHECK_JOB_ID = '77777777-7777-4777-8777-777777777777';

describe('desktop source catalog capabilities', () => {
  it('mantém a sessão no main, deriva o digest e projeta resposta mínima', async () => {
    const createProviderRevision = vi.fn((_token: string, request: Record<string, unknown>) =>
      Promise.resolve({
        provider: {
          schemaVersion: 1 as const,
          providerId: PROVIDER_ID,
          providerKey: 'planalto-oficial',
          activeProviderRevisionId: null,
          sourceActivationState: 'draft' as const,
          lockVersion: 1,
        },
        revision: {
          schemaVersion: 1 as const,
          providerRevisionId: PROVIDER_REVISION_ID,
          providerId: PROVIDER_ID,
          revisionNumber: 1,
          providerKey: 'planalto-oficial',
          providerName: 'Portal da Legislação do Planalto',
          sourceType: 'planalto_html' as const,
          adapterId: 'planalto.html',
          adapterContractVersion: 1,
          origin: {
            scheme: 'https' as const,
            host: 'www.planalto.gov.br',
            port: null,
            pathPrefix: '/',
          },
          detectionParameters: { requireLegalHeader: true },
          configDigest: String(request['configDigest']),
          createdByUserId: USER_ID,
          createdAt: '2026-08-13T15:00:00.000Z',
        },
      }),
    );
    const service = { createProviderRevision } as unknown as SourceCatalogService;
    const capabilities = createDesktopSourceCatalogIpcCapabilities({
      service,
      getAccessToken: () => 'main-session-token',
    });
    const command = {
      providerKey: 'planalto-oficial',
      expectedLockVersion: 0,
      providerName: 'Portal da Legislação do Planalto',
      sourceType: 'planalto_html' as const,
      adapterId: 'planalto.html',
      adapterContractVersion: 1,
      origin: {
        scheme: 'https' as const,
        host: 'www.planalto.gov.br',
        port: null,
        pathPrefix: '/',
      },
      detectionParameters: { requireLegalHeader: true },
    };

    await expect(capabilities.createProviderRevision.authorize(command)).resolves.toBe(true);
    await expect(capabilities.createProviderRevision.handle(command)).resolves.toEqual({
      providerId: PROVIDER_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      revisionNumber: 1,
      providerLockVersion: 1,
    });
    expect(createProviderRevision.mock.calls[0]?.[0]).toBe('main-session-token');
    expect(createProviderRevision.mock.calls[0]?.[1]['configDigest']).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(command)).not.toMatch(/token|actor|role/iu);
  });

  it('nega por padrão quando não há sessão autenticada no main', async () => {
    const listCatalog = vi.fn();
    const capabilities = createDesktopSourceCatalogIpcCapabilities({
      service: { listCatalog } as unknown as SourceCatalogService,
      getAccessToken: () => null,
    });

    await expect(capabilities.listCatalog.authorize({ cursor: null, limit: 25 })).resolves.toBe(
      false,
    );
    await expect(capabilities.listCatalog.handle({ cursor: null, limit: 25 })).rejects.toThrow(
      /session/iu,
    );
    expect(listCatalog).not.toHaveBeenCalled();
  });

  it('lista capacidades instaladas e solicita verificação com intenção mínima', async () => {
    const item = {
      providerId: PROVIDER_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      providerRevisionNumber: 2,
      providerKey: 'planalto-oficial',
      providerName: 'Portal da Legislação do Planalto',
      adapterId: 'planalto.html',
      adapterContractVersion: 1,
      providerLockVersion: 3,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      bindingRevisionNumber: 4,
      bindingLockVersion: 5,
      lawId: USER_ID,
      lawTitle: 'Lei de teste',
      sourceActivationState: 'active' as const,
      sourceHealthState: 'healthy' as const,
      monitoringIntervalMs: 86_400_000,
      lastSourceTestOutcome: 'success' as const,
      lastTestEvidenceId: TEST_EVIDENCE_ID,
      lastTestedAt: '2026-08-13T14:00:00.000Z',
      lastCheckedAt: '2026-08-13T15:00:00.000Z',
      lastErrorCode: null,
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'compiled' as const,
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lei-teste.htm',
        },
      ],
    };
    const listCatalog = vi.fn(() => Promise.resolve({ items: [item], nextCursor: null }));
    const requestSourceCheck = vi.fn(() =>
      Promise.resolve({
        sourceCheckJobId: CHECK_JOB_ID,
        bindingId: BINDING_ID,
        bindingRevisionId: BINDING_REVISION_ID,
        sourceCheckJobState: 'queued' as const,
        requestedAt: '2026-08-13T15:00:00.000Z',
        deduplicated: false,
      }),
    );
    const capabilities = createDesktopSourceCatalogIpcCapabilities({
      service: { listCatalog, requestSourceCheck } as unknown as SourceCatalogService,
      getAccessToken: () => 'main-session-token',
    });

    await expect(capabilities.listCatalog.handle({ cursor: null, limit: 25 })).resolves.toEqual({
      items: [item],
      nextCursor: null,
      adapterCapabilities: [
        expect.objectContaining({
          adapterId: 'planalto.html',
          contractVersion: 1,
          allowedHosts: ['planalto.gov.br', 'www.planalto.gov.br'],
        }),
      ],
    });
    await expect(
      capabilities.requestSourceCheck.handle({
        bindingId: BINDING_ID,
        idempotencyKey: 'manual-check-1',
      }),
    ).resolves.toMatchObject({
      sourceCheckJobId: CHECK_JOB_ID,
      sourceCheckJobState: 'queued',
      deduplicated: false,
    });
    expect(listCatalog).toHaveBeenCalledWith('main-session-token', { cursor: null, limit: 25 });
    expect(requestSourceCheck).toHaveBeenCalledWith('main-session-token', {
      bindingId: BINDING_ID,
      idempotencyKey: 'manual-check-1',
    });
    expect(JSON.stringify(requestSourceCheck.mock.calls)).not.toMatch(/actor|role|requestedAt/iu);
  });
});
