import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryLegislativeUpdateQueue,
  createLegislativeUpdateReprocessRunner,
  type LegislativeUpdateWorkerQueue,
} from '../../services/update-worker/src/index.js';
import type {
  LegislativeUpdateJob,
  UpdateWorkerResult,
} from '../../services/update-worker/src/worker.js';

const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const LAW_ID = '22222222-2222-4222-8222-222222222222';
const completedResult: UpdateWorkerResult = {
  kind: 'unchanged',
  normativeSha256: 'a'.repeat(64),
  schedule: {
    lawId: LAW_ID,
    intervalMs: 60_000,
    nextCheckAt: '2026-08-20T12:00:00.000Z',
    consecutiveFailures: 0,
    nextRetryAt: null,
    suspendedUntil: null,
  },
};

const queue = (
  completeReprocess = vi.fn(() => Promise.resolve(true)),
): LegislativeUpdateWorkerQueue => ({
  saveCandidateArtifact: () => Promise.resolve(),
  upsertProposal: () => Promise.reject(new Error('not used')),
  recordError: () => Promise.reject(new Error('not used')),
  claimReprocessRequests: () =>
    Promise.resolve([{ updateId: UPDATE_ID, lawId: LAW_ID, requestId: REQUEST_ID }]),
  completeReprocess,
});

describe('legislative update reprocess runner', () => {
  it('encerra a mesma correlação após executar a candidata, sem publicar', async () => {
    const completeReprocess = vi.fn(() => Promise.resolve(true));
    const runJob = vi.fn(() => Promise.resolve(completedResult));
    const runner = createLegislativeUpdateReprocessRunner({
      queue: queue(completeReprocess),
      loadJob: () => Promise.resolve({} as LegislativeUpdateJob),
      runJob,
    });

    await expect(runner.runBatch()).resolves.toEqual([
      {
        updateId: UPDATE_ID,
        lawId: LAW_ID,
        requestId: REQUEST_ID,
        outcome: 'completed',
        detailCode: null,
        recorded: true,
      },
    ]);
    expect(runJob).toHaveBeenCalledWith(
      {},
      { updateId: UPDATE_ID, lawId: LAW_ID, requestId: REQUEST_ID },
    );
    expect(completeReprocess).toHaveBeenCalledWith(UPDATE_ID, REQUEST_ID, 'completed', null);
  });

  it('registra uma falha redigida na mesma correlação', async () => {
    const completeReprocess = vi.fn(() => Promise.resolve(true));
    const runner = createLegislativeUpdateReprocessRunner({
      queue: queue(completeReprocess),
      loadJob: () => Promise.reject(new Error('SOURCE_TIMEOUT')),
      runJob: () => Promise.reject(new Error('not used')),
    });

    await expect(runner.runBatch()).resolves.toMatchObject([
      { updateId: UPDATE_ID, outcome: 'failed', detailCode: 'SOURCE_TIMEOUT', recorded: true },
    ]);
    expect(completeReprocess).toHaveBeenCalledWith(
      UPDATE_ID,
      REQUEST_ID,
      'failed',
      'SOURCE_TIMEOUT',
    );
  });
});

describe('reprocess attempt identity', () => {
  it('records new attempts separately and refuses stale or unclaimed completions', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(() => UPDATE_ID);
    await queue.recordError({
      lawId: LAW_ID,
      lawSigla: 'lei',
      lawTitle: 'Lei',
      sourceUrl: 'https://example.invalid/lei',
      baseVersionId: LAW_ID,
      baseNormativeSha256: 'a'.repeat(64),
      failureKey: 'b'.repeat(64),
      errorCode: 'SOURCE_TIMEOUT',
      occurredAt: '2026-08-20T12:00:00.000Z',
    });
    const firstId = '33333333-3333-4333-8333-333333333333';
    const secondId = '44444444-4444-4444-8444-444444444444';
    await queue.requestReprocess(UPDATE_ID, firstId);
    await queue.requestReprocess(UPDATE_ID, firstId);
    expect((await queue.findById(UPDATE_ID))?.retryCount).toBe(1);
    await expect(
      queue.completeReprocess(UPDATE_ID, firstId, 'failed', 'SOURCE_TIMEOUT'),
    ).resolves.toBe(false);
    expect(await queue.claimReprocessRequests(20)).toEqual([
      { updateId: UPDATE_ID, lawId: LAW_ID, requestId: firstId },
    ]);
    await expect(
      queue.completeReprocess(UPDATE_ID, firstId, 'failed', 'SOURCE_TIMEOUT'),
    ).resolves.toBe(true);
    await queue.requestReprocess(UPDATE_ID, firstId);
    expect(await queue.claimReprocessRequests(20)).toEqual([]);
    await queue.requestReprocess(UPDATE_ID, secondId);
    expect(await queue.claimReprocessRequests(20)).toEqual([
      { updateId: UPDATE_ID, lawId: LAW_ID, requestId: secondId },
    ]);
    await expect(queue.completeReprocess(UPDATE_ID, firstId, 'completed', null)).resolves.toBe(
      false,
    );
    await expect(queue.completeReprocess(UPDATE_ID, secondId, 'completed', null)).resolves.toBe(
      true,
    );
    await expect(
      queue.completeReprocess(UPDATE_ID, secondId, 'failed', 'SOURCE_TIMEOUT'),
    ).resolves.toBe(false);
  });
});
