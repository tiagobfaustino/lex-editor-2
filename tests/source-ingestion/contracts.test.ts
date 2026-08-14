import { describe, expect, it } from 'vitest';

import {
  activeLawSourceBindingSchema,
  activeSourceImportConfigurationSchema,
  capturedSourceCheckJobSchema,
  lawSourceBindingRevisionSchema,
  providerRevisionSchema,
  sourceBindingHealthSchema,
  sourceCheckCompletionSchema,
  sourceConfigurationEvidenceSchema,
  sourceTestEvidenceSchema,
} from '@lex-editor/source-ingestion';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_REVISION_ID = '22222222-2222-4222-8222-222222222222';
const BINDING_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_REVISION_ID = '44444444-4444-4444-8444-444444444444';
const LAW_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const TEST_ID = '77777777-7777-4777-8777-777777777777';
const DIGEST = 'a'.repeat(64);
const WHEN = '2026-08-13T15:00:00.000Z';

const providerRevision = () => ({
  schemaVersion: 1 as const,
  providerRevisionId: PROVIDER_REVISION_ID,
  providerId: PROVIDER_ID,
  revisionNumber: 1,
  providerKey: 'planalto-oficial',
  providerName: 'Portal da Legislação do Planalto',
  sourceType: 'planalto_html' as const,
  adapterId: 'planalto.html',
  adapterContractVersion: 1,
  origin: { scheme: 'https' as const, host: 'www.planalto.gov.br', port: null, pathPrefix: '/' },
  detectionParameters: { requireLegalHeader: true },
  configDigest: DIGEST,
  createdByUserId: USER_ID,
  createdAt: WHEN,
});

const bindingRevision = () => ({
  schemaVersion: 1 as const,
  bindingRevisionId: BINDING_REVISION_ID,
  bindingId: BINDING_ID,
  lawId: LAW_ID,
  providerRevisionId: PROVIDER_REVISION_ID,
  revisionNumber: 1,
  artifacts: [
    {
      order: 0,
      sourceRole: 'primary_current' as const,
      sourceVariant: 'compiled' as const,
      sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
    },
    {
      order: 1,
      sourceRole: 'historical_auxiliary' as const,
      sourceVariant: 'annotated' as const,
      sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm',
    },
  ],
  monitoringIntervalMs: 86_400_000,
  configDigest: DIGEST,
  createdByUserId: USER_ID,
  createdAt: WHEN,
});

describe('source catalog contracts', () => {
  it('validates immutable provider and law binding revisions', () => {
    expect(providerRevisionSchema.parse(providerRevision())).toEqual(providerRevision());
    expect(lawSourceBindingRevisionSchema.parse(bindingRevision())).toEqual(bindingRevision());
  });

  it('validates active import identity without accepting source content', () => {
    expect(
      activeSourceImportConfigurationSchema.parse({
        providerRevision: providerRevision(),
        bindingRevision: bindingRevision(),
      }),
    ).toBeDefined();
    expect(
      sourceConfigurationEvidenceSchema.parse({
        schemaVersion: 1,
        providerId: PROVIDER_ID,
        providerRevisionId: PROVIDER_REVISION_ID,
        providerConfigDigest: DIGEST,
        bindingId: BINDING_ID,
        bindingRevisionId: BINDING_REVISION_ID,
        bindingConfigDigest: DIGEST,
        adapterId: 'planalto.html',
        adapterContractVersion: 1,
      }),
    ).toBeDefined();
    expect(() =>
      sourceConfigurationEvidenceSchema.parse({
        schemaVersion: 1,
        providerId: PROVIDER_ID,
        providerRevisionId: PROVIDER_REVISION_ID,
        providerConfigDigest: DIGEST,
        bindingId: BINDING_ID,
        bindingRevisionId: BINDING_REVISION_ID,
        bindingConfigDigest: DIGEST,
        adapterId: 'planalto.html',
        adapterContractVersion: 1,
        normaAst: {},
      }),
    ).toThrow();
  });

  it('requires one primary source and unique URLs/orders', () => {
    expect(() =>
      lawSourceBindingRevisionSchema.parse({
        ...bindingRevision(),
        artifacts: bindingRevision().artifacts.map((artifact) => ({
          ...artifact,
          sourceRole: 'historical_auxiliary',
        })),
      }),
    ).toThrow(/primary_current/u);
    expect(() =>
      lawSourceBindingRevisionSchema.parse({
        ...bindingRevision(),
        artifacts: [bindingRevision().artifacts[0], bindingRevision().artifacts[0]],
      }),
    ).toThrow();
  });

  it('rejects wildcard origins and executable or generic lifecycle fields', () => {
    expect(() =>
      providerRevisionSchema.parse({
        ...providerRevision(),
        origin: { ...providerRevision().origin, host: '*.planalto.gov.br' },
      }),
    ).toThrow();
    expect(() =>
      providerRevisionSchema.parse({ ...providerRevision(), status: 'active' }),
    ).toThrow();
    expect(() =>
      providerRevisionSchema.parse({
        ...providerRevision(),
        detectionParameters: { script: { execute: 'fetch("https://evil.invalid")' } },
      }),
    ).toThrow();
  });

  it('requires an ASCII-normalized IDNA host and a valid explicit port', () => {
    expect(() =>
      providerRevisionSchema.parse({
        ...providerRevision(),
        origin: { ...providerRevision().origin, host: 'www.planaltó.gov.br' },
      }),
    ).toThrow();
    expect(() =>
      providerRevisionSchema.parse({
        ...providerRevision(),
        origin: { ...providerRevision().origin, host: 'WWW.PLANALTO.GOV.BR' },
      }),
    ).toThrow();
    expect(() =>
      providerRevisionSchema.parse({
        ...providerRevision(),
        origin: { ...providerRevision().origin, port: 65_536 },
      }),
    ).toThrow();
  });

  it('makes successful and failed test evidence mutually consistent', () => {
    const base = {
      schemaVersion: 1 as const,
      testEvidenceId: TEST_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      providerConfigDigest: DIGEST,
      bindingConfigDigest: DIGEST,
      adapterId: 'planalto.html',
      adapterContractVersion: 1,
      completedStage: 'adapter' as const,
      evidenceDigest: DIGEST,
      testedByUserId: USER_ID,
      testedAt: WHEN,
    };
    expect(
      sourceTestEvidenceSchema.parse({
        ...base,
        sourceTestOutcome: 'success',
        errorCode: null,
      }),
    ).toBeDefined();
    expect(() =>
      sourceTestEvidenceSchema.parse({
        ...base,
        sourceTestOutcome: 'success',
        errorCode: 'NETWORK_TIMEOUT',
      }),
    ).toThrow();
    expect(() =>
      sourceTestEvidenceSchema.parse({
        ...base,
        sourceTestOutcome: 'failure',
        errorCode: null,
      }),
    ).toThrow();
  });

  it('keeps activation and health separate in worker projections', () => {
    const active = activeLawSourceBindingSchema.parse({
      schemaVersion: 1,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      lawId: LAW_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      monitoringIntervalMs: 86_400_000,
      sourceActivationState: 'active',
      sourceHealthState: 'degraded',
      nextCheckAt: WHEN,
      artifacts: bindingRevision().artifacts,
    });
    const health = sourceBindingHealthSchema.parse({
      schemaVersion: 1,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      sourceHealthState: 'suspended',
      nextCheckAt: WHEN,
      consecutiveFailures: 5,
      nextRetryAt: WHEN,
      suspendedUntil: WHEN,
      lastErrorCode: 'NETWORK_TIMEOUT',
      lastCheckedAt: WHEN,
      updatedAt: WHEN,
    });
    expect(active.sourceActivationState).toBe('active');
    expect(health.sourceHealthState).toBe('suspended');
    expect('status' in active).toBe(false);
  });

  it('validates captured jobs and consistent check completions', () => {
    const health = {
      schemaVersion: 1 as const,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      sourceHealthState: 'unknown' as const,
      nextCheckAt: WHEN,
      consecutiveFailures: 0,
      nextRetryAt: null,
      suspendedUntil: null,
      lastErrorCode: null,
      lastCheckedAt: null,
      updatedAt: WHEN,
    };
    const job = {
      schemaVersion: 1 as const,
      sourceCheckJobId: TEST_ID,
      bindingId: BINDING_ID,
      bindingRevisionId: BINDING_REVISION_ID,
      providerRevisionId: PROVIDER_REVISION_ID,
      lawId: LAW_ID,
      baseVersionId: USER_ID,
      sourceCheckTrigger: 'manual' as const,
      sourceCheckJobState: 'running' as const,
      idempotencyKey: 'verify-now:contract',
      requestedAt: WHEN,
      claimedAt: WHEN,
      providerRevision: providerRevision(),
      bindingRevision: bindingRevision(),
      health,
    };
    expect(capturedSourceCheckJobSchema.parse(job)).toEqual(job);
    expect(() =>
      capturedSourceCheckJobSchema.parse({ ...job, providerRevisionId: USER_ID }),
    ).toThrow(/revisões inconsistentes/u);

    const healthy = {
      ...health,
      sourceHealthState: 'healthy' as const,
      nextCheckAt: '2026-08-14T15:00:00.000Z',
      lastCheckedAt: WHEN,
    };
    expect(
      sourceCheckCompletionSchema.parse({
        sourceCheckJobId: TEST_ID,
        sourceCheckJobState: 'completed',
        detailCode: null,
        completedAt: WHEN,
        health: healthy,
      }),
    ).toBeDefined();
    expect(() =>
      sourceCheckCompletionSchema.parse({
        sourceCheckJobId: TEST_ID,
        sourceCheckJobState: 'failed',
        detailCode: null,
        completedAt: WHEN,
        health: healthy,
      }),
    ).toThrow(/inconsistentes/u);
    expect(() =>
      sourceBindingHealthSchema.parse({
        ...healthy,
        sourceHealthState: 'suspended',
        consecutiveFailures: 5,
        nextRetryAt: WHEN,
        suspendedUntil: null,
        lastErrorCode: 'NETWORK_TIMEOUT',
      }),
    ).toThrow(/inconsistentes/u);
  });
});
