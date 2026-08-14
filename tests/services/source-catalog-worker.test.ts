import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { calculateNormativeHash, identifiedMinima } from '@lex-editor/legal-domain';
import {
  type CapturedSourceCheckJob,
  type SourceCheckCompletion,
} from '@lex-editor/source-ingestion';
import { PlanaltoNetworkError, type PlanaltoNetworkPorts } from '@lex-editor/source-ingestion/node';
import { describe, expect, it, vi } from 'vitest';

import {
  createSourceCatalogWorkerRepository,
  type SourceCatalogSqlClient,
  type SourceCatalogWorkerRepository,
} from '../../services/source-catalog/src/index.js';
import {
  InMemoryLegislativeUpdateQueue,
  createSourceCatalogLegislativeUpdateRunner,
} from '../../services/update-worker/src/index.js';

const NOW = new Date('2026-08-13T18:00:00.000Z');
const LAW_ID = '11111111-1111-4111-8111-111111111111';
const BASE_VERSION_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_REVISION_ID = '44444444-4444-4444-8444-444444444444';
const BINDING_ID = '55555555-5555-4555-8555-555555555555';
const BINDING_REVISION_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const ARTIFACT_ID = '99999999-9999-4999-8999-999999999999';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const clone = <Value>(value: Value): Value => structuredClone(value);

const capturedJob = (overrides: Partial<CapturedSourceCheckJob> = {}): CapturedSourceCheckJob => ({
  schemaVersion: 1,
  sourceCheckJobId: JOB_ID,
  bindingId: BINDING_ID,
  bindingRevisionId: BINDING_REVISION_ID,
  providerRevisionId: PROVIDER_REVISION_ID,
  lawId: LAW_ID,
  baseVersionId: BASE_VERSION_ID,
  sourceCheckTrigger: 'scheduled',
  sourceCheckJobState: 'running',
  idempotencyKey: `scheduled:${BINDING_REVISION_ID}:${NOW.toISOString()}`,
  requestedAt: NOW.toISOString(),
  claimedAt: NOW.toISOString(),
  providerRevision: {
    schemaVersion: 1,
    providerRevisionId: PROVIDER_REVISION_ID,
    providerId: PROVIDER_ID,
    revisionNumber: 3,
    providerKey: 'planalto-oficial',
    providerName: 'Portal da Legislação do Planalto',
    sourceType: 'planalto_html',
    adapterId: 'planalto.html',
    adapterContractVersion: 1,
    origin: {
      scheme: 'https',
      host: 'www.planalto.gov.br',
      port: null,
      pathPrefix: '/ccivil_03/',
    },
    detectionParameters: { requireLegalHeader: true },
    configDigest: 'a'.repeat(64),
    createdByUserId: ACTOR_ID,
    createdAt: '2026-08-13T15:00:00.000Z',
  },
  bindingRevision: {
    schemaVersion: 1,
    bindingRevisionId: BINDING_REVISION_ID,
    bindingId: BINDING_ID,
    lawId: LAW_ID,
    providerRevisionId: PROVIDER_REVISION_ID,
    revisionNumber: 4,
    artifacts: [
      {
        order: 0,
        sourceRole: 'primary_current',
        sourceVariant: 'compiled',
        sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
      },
      {
        order: 1,
        sourceRole: 'historical_auxiliary',
        sourceVariant: 'annotated',
        sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm',
      },
    ],
    monitoringIntervalMs: 86_400_000,
    configDigest: 'b'.repeat(64),
    createdByUserId: ACTOR_ID,
    createdAt: '2026-08-13T15:01:00.000Z',
  },
  health: {
    schemaVersion: 1,
    bindingId: BINDING_ID,
    bindingRevisionId: BINDING_REVISION_ID,
    sourceHealthState: 'unknown',
    nextCheckAt: NOW.toISOString(),
    consecutiveFailures: 0,
    nextRetryAt: null,
    suspendedUntil: null,
    lastErrorCode: null,
    lastCheckedAt: null,
    updatedAt: '2026-08-13T15:01:00.000Z',
  },
  ...overrides,
});

const catalog = (job: CapturedSourceCheckJob) => {
  const completions: SourceCheckCompletion[] = [];
  let firstClaim = true;
  const repository: SourceCatalogWorkerRepository = {
    claimDueChecks: vi.fn(() => {
      if (!firstClaim) return Promise.resolve([]);
      firstClaim = false;
      return Promise.resolve([job]);
    }),
    completeCheck: vi.fn((completion: SourceCheckCompletion) => {
      completions.push(completion);
      return Promise.resolve({
        sourceCheckJobId: completion.sourceCheckJobId,
        sourceCheckJobState: completion.sourceCheckJobState,
        healthApplied: true,
      });
    }),
  };
  return { repository, completions };
};

const updateSourceReferences = (value: unknown, artifactSha256: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const sourceRef = record['sourceRef'];
  if (typeof sourceRef === 'object' && sourceRef !== null && !Array.isArray(sourceRef)) {
    record['sourceRef'] = {
      ...sourceRef,
      sourceArtifactSha256: artifactSha256,
      fragmentSha256: artifactSha256,
    };
  }
  if (Array.isArray(record['children'])) {
    for (const child of record['children']) updateSourceReferences(child, artifactSha256);
  }
};

describe('source catalog legislative update runner', () => {
  it('coleta o conjunto completo da revisão capturada e recupera saúde sem trocar IDs', async () => {
    const job = capturedJob({
      sourceCheckTrigger: 'manual',
      idempotencyKey: 'manual-check-1',
      health: {
        ...capturedJob().health,
        sourceHealthState: 'degraded',
        nextCheckAt: '2026-08-20T18:00:00.000Z',
        consecutiveFailures: 2,
        nextRetryAt: '2026-08-14T18:00:00.000Z',
        lastErrorCode: 'NETWORK_TIMEOUT',
      },
    });
    const state = catalog(job);
    const html = await readFile('fixtures/legal/l9099/snapshot.html');
    const requested: string[] = [];
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
      request: ({ url }) => {
        requested.push(url.href);
        return Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=windows-1252' },
          body: html,
        });
      },
    };
    const parser = {
      parse: vi.fn(
        ({
          sourceSet,
        }: Parameters<
          Parameters<typeof createSourceCatalogLegislativeUpdateRunner>[0]['parser']['parse']
        >[0]) => {
          expect(sourceSet.providerRevisionId).toBe(PROVIDER_REVISION_ID);
          expect(sourceSet.bindingRevisionId).toBe(BINDING_REVISION_ID);
          expect(sourceSet.artifacts.map(({ fetched }) => fetched.sourceRole)).toEqual([
            'primary_current',
            'historical_auxiliary',
          ]);
          const ast = clone(identifiedMinima);
          updateSourceReferences(ast, sourceSet.artifacts[0]?.snapshot.sha256 ?? 'missing');
          return Promise.resolve({ candidateAst: ast, candidateArtifactId: ARTIFACT_ID });
        },
      ),
    };
    const runner = createSourceCatalogLegislativeUpdateRunner({
      catalog: state.repository,
      baselines: {
        load: () =>
          Promise.resolve({
            lawId: LAW_ID,
            lawSigla: identifiedMinima.sigla,
            lawTitle: identifiedMinima.titulo,
            baseVersionId: BASE_VERSION_ID,
            baseNormativeSha256: calculateNormativeHash(identifiedMinima, sha256),
            publishedAst: identifiedMinima,
          }),
      },
      parser,
      queue: new InMemoryLegislativeUpdateQueue(
        () => ARTIFACT_ID,
        () => NOW,
      ),
      sha256,
      now: () => NOW,
      random: () => 0.5,
      networkPorts: ports,
    });

    const result = await runner.runBatch();

    expect(result).toMatchObject([
      {
        sourceCheckJobId: JOB_ID,
        bindingRevisionId: BINDING_REVISION_ID,
        result: { kind: 'unchanged' },
        healthApplied: true,
      },
    ]);
    expect(requested.sort()).toEqual(
      job.bindingRevision.artifacts.map(({ sourceUrl }) => sourceUrl).sort(),
    );
    expect(state.completions).toMatchObject([
      {
        sourceCheckJobId: JOB_ID,
        sourceCheckJobState: 'completed',
        detailCode: null,
        health: {
          bindingRevisionId: BINDING_REVISION_ID,
          sourceHealthState: 'healthy',
          nextCheckAt: '2026-08-14T18:00:00.000Z',
          consecutiveFailures: 0,
          nextRetryAt: null,
          suspendedUntil: null,
          lastErrorCode: null,
        },
      },
    ]);
    expect(await runner.runBatch()).toEqual([]);
  });

  it('aplica backoff e suspensão a partir da saúde capturada sem produzir sucesso falso', async () => {
    const job = capturedJob({
      health: {
        ...capturedJob().health,
        sourceHealthState: 'degraded',
        consecutiveFailures: 4,
        nextRetryAt: NOW.toISOString(),
        lastErrorCode: 'NETWORK_TIMEOUT',
      },
    });
    const state = catalog(job);
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
      request: () => Promise.reject(new PlanaltoNetworkError('NETWORK_TIMEOUT')),
    };
    const runner = createSourceCatalogLegislativeUpdateRunner({
      catalog: state.repository,
      baselines: {
        load: () =>
          Promise.resolve({
            lawId: LAW_ID,
            lawSigla: identifiedMinima.sigla,
            lawTitle: identifiedMinima.titulo,
            baseVersionId: BASE_VERSION_ID,
            baseNormativeSha256: calculateNormativeHash(identifiedMinima, sha256),
            publishedAst: identifiedMinima,
          }),
      },
      parser: { parse: vi.fn() },
      queue: new InMemoryLegislativeUpdateQueue(
        () => ARTIFACT_ID,
        () => NOW,
      ),
      sha256,
      now: () => NOW,
      random: () => 0.5,
      networkPorts: ports,
    });

    const result = await runner.runBatch();

    expect(result[0]?.result).toMatchObject({ kind: 'error', errorCode: 'NETWORK_TIMEOUT' });
    expect(state.completions[0]).toMatchObject({
      sourceCheckJobState: 'failed',
      detailCode: 'NETWORK_TIMEOUT',
      health: {
        sourceHealthState: 'suspended',
        consecutiveFailures: 5,
        suspendedUntil: '2026-08-14T00:00:00.000Z',
        lastErrorCode: 'NETWORK_TIMEOUT',
      },
    });
  });
});

describe('source catalog worker repository', () => {
  it('usa somente claim e completion validados para atravessar a fronteira SQL', async () => {
    const job = capturedJob();
    const completion: SourceCheckCompletion = {
      sourceCheckJobId: JOB_ID,
      sourceCheckJobState: 'completed',
      detailCode: null,
      completedAt: NOW.toISOString(),
      health: {
        ...job.health,
        sourceHealthState: 'healthy',
        nextCheckAt: '2026-08-14T18:00:00.000Z',
        lastCheckedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    };
    const calls: Readonly<{ text: string; parameters: readonly unknown[] | undefined }>[] = [];
    const responses: unknown[] = [
      [{ value: [job] }],
      [
        {
          value: {
            sourceCheckJobId: JOB_ID,
            sourceCheckJobState: 'completed',
            healthApplied: true,
          },
        },
      ],
    ];
    const query: SourceCatalogSqlClient['query'] = <T extends Record<string, unknown>>(
      text: string,
      parameters?: readonly unknown[],
    ) => {
      calls.push({ text, parameters });
      return Promise.resolve(responses.shift() as readonly T[]);
    };
    const repository = createSourceCatalogWorkerRepository({ query });

    await expect(repository.claimDueChecks(NOW.toISOString(), 25)).resolves.toEqual([job]);
    await expect(repository.completeCheck(completion)).resolves.toEqual({
      sourceCheckJobId: JOB_ID,
      sourceCheckJobState: 'completed',
      healthApplied: true,
    });
    expect(calls).toEqual([
      {
        text: `select private.claim_due_source_checks($1::timestamptz, $2::integer) as value`,
        parameters: [NOW.toISOString(), 25],
      },
      {
        text: 'select private.complete_source_check($1::jsonb) as value',
        parameters: [completion],
      },
    ]);
    await expect(repository.claimDueChecks(NOW.toISOString(), 101)).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});
