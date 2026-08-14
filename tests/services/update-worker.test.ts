import { createHash, randomUUID } from 'node:crypto';

import {
  calculateNormativeHash,
  identifiedMinima,
  origemMinima,
  type IdentifiedNormaAST,
  type SourceSnapshot,
} from '@lex-editor/legal-domain';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryLegislativeUpdateQueue,
  calculateBackoffDelayMs,
  createLegislativeUpdateReviewService,
  createLegislativeUpdateWorker,
  scheduleAfterFailure,
  type LegislativeSourceCollector,
  type LegislativeUpdateJob,
  type UpdateSchedule,
} from '../../services/update-worker/src/index.js';
import type { ActiveSourceImportConfiguration } from '@lex-editor/source-ingestion';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const NOW = new Date('2026-08-11T15:00:00.000Z');
const LAW_ID = '10000000-0000-4000-8000-000000000001';
const BASE_ID = '10000000-0000-4000-8000-000000000002';
const ACTOR_ID = '10000000-0000-4000-8000-000000000003';
const PUBLICATION_ID = '10000000-0000-4000-8000-000000000004';
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000005';
const PROVIDER_ID = '10000000-0000-4000-8000-000000000006';
const PROVIDER_REVISION_ID = '10000000-0000-4000-8000-000000000007';
const BINDING_ID = '10000000-0000-4000-8000-000000000008';
const BINDING_REVISION_ID = '10000000-0000-4000-8000-000000000009';

const sourceConfiguration = (): ActiveSourceImportConfiguration => ({
  providerRevision: {
    schemaVersion: 1,
    providerRevisionId: PROVIDER_REVISION_ID,
    providerId: PROVIDER_ID,
    revisionNumber: 1,
    providerKey: 'planalto-oficial',
    providerName: 'Portal da Legislação do Planalto',
    sourceType: 'planalto_html',
    adapterId: 'planalto.html',
    adapterContractVersion: 1,
    origin: { scheme: 'https', host: 'www.planalto.gov.br', port: null, pathPrefix: '/' },
    detectionParameters: { requireLegalHeader: true },
    configDigest: 'a'.repeat(64),
    createdByUserId: ACTOR_ID,
    createdAt: NOW.toISOString(),
  },
  bindingRevision: {
    schemaVersion: 1,
    bindingRevisionId: BINDING_REVISION_ID,
    bindingId: BINDING_ID,
    lawId: LAW_ID,
    providerRevisionId: PROVIDER_REVISION_ID,
    revisionNumber: 1,
    artifacts: [
      {
        order: 0,
        sourceRole: 'primary_current',
        sourceVariant: 'annotated',
        sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l123.htm',
      },
    ],
    monitoringIntervalMs: 86_400_000,
    configDigest: 'b'.repeat(64),
    createdByUserId: ACTOR_ID,
    createdAt: NOW.toISOString(),
  },
});

const snapshot = (content: string): SourceSnapshot => {
  const digest = sha256(content);
  return {
    conteudo: content,
    sha256: digest,
    referencia: { ...origemMinima, sourceArtifactSha256: digest, fragmentSha256: digest },
  };
};

const schedule = (overrides: Partial<UpdateSchedule> = {}): UpdateSchedule => ({
  lawId: LAW_ID,
  intervalMs: 24 * 60 * 60 * 1_000,
  nextCheckAt: NOW.toISOString(),
  consecutiveFailures: 0,
  nextRetryAt: null,
  suspendedUntil: null,
  ...overrides,
});

const job = (overrides: Partial<LegislativeUpdateJob> = {}): LegislativeUpdateJob => ({
  lawId: LAW_ID,
  lawSigla: identifiedMinima.sigla,
  lawTitle: identifiedMinima.titulo,
  sourceConfiguration: sourceConfiguration(),
  baseVersionId: BASE_ID,
  baseNormativeSha256: calculateNormativeHash(identifiedMinima, sha256),
  publishedAst: identifiedMinima,
  schedule: schedule(),
  ...overrides,
});

const changedAst = (text: string): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  article.caput = text;
  article.deviceStatus = 'amended';
  return ast;
};

const collector = (
  ast: IdentifiedNormaAST,
  raw = '<html>fonte alterada</html>',
): LegislativeSourceCollector => ({
  collect: vi.fn(() =>
    Promise.resolve({
      snapshots: [snapshot(raw)],
      candidateAst: ast,
      candidateArtifactId: ARTIFACT_ID,
    }),
  ),
});

const ids = (): (() => string) => {
  const values = [
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
  ];
  return () => values.shift() ?? randomUUID();
};

describe('worker de atualização legislativa', () => {
  it('filtra alteração bruta cosmética quando a projeção normativa é igual', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(ids(), () => NOW);
    const worker = createLegislativeUpdateWorker({
      collector: collector(clone(identifiedMinima), '<html class="layout-novo">igual</html>'),
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const result = await worker.run(job());
    expect(result.kind).toBe('unchanged');
    expect(await queue.list()).toHaveLength(0);
  });

  it('cria uma proposta, reutiliza detecção idêntica e supersede candidata anterior', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(ids(), () => NOW);
    const firstWorker = createLegislativeUpdateWorker({
      collector: collector(changedAst('Primeira redação candidata.')),
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const first = await firstWorker.run(job());
    const duplicate = await firstWorker.run(job());
    expect(first.kind).toBe('proposal_created');
    expect(duplicate.kind).toBe('proposal_reused');
    expect(
      (await queue.list()).find((item) => item.updateReviewStatus === 'pending')?.detectionCount,
    ).toBe(2);

    const secondWorker = createLegislativeUpdateWorker({
      collector: collector(changedAst('Segunda redação candidata.')),
      queue,
      sha256,
      now: () => new Date('2026-08-12T15:00:00.000Z'),
      random: () => 0.5,
    });
    const second = await secondWorker.run(
      job({ schedule: schedule({ nextCheckAt: '2026-08-12T15:00:00.000Z' }) }),
    );
    expect(second.kind).toBe('proposal_created');
    if (second.kind === 'proposal_created') expect(second.supersededUpdateIds).toHaveLength(1);
    expect((await queue.list()).map((item) => item.updateReviewStatus).sort()).toEqual([
      'pending',
      'superseded',
    ]);
  });

  it('registra erro idempotente, aplica backoff e suspende fonte degradada', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(ids(), () => NOW);
    const failingCollector: LegislativeSourceCollector = {
      collect: vi.fn(() => Promise.reject(new Error('SOURCE_TIMEOUT'))),
    };
    const worker = createLegislativeUpdateWorker({
      collector: failingCollector,
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const first = await worker.run(job());
    expect(first.kind).toBe('error');
    expect(first.schedule.consecutiveFailures).toBe(1);
    expect(first.schedule.nextRetryAt).toBe('2026-08-11T15:01:00.000Z');
    expect((await queue.list())[0]).toMatchObject({
      updateReviewStatus: 'error',
      errorCode: 'SOURCE_TIMEOUT',
      candidateNormativeSha256: null,
      diff: null,
    });

    let degraded = schedule();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      degraded = scheduleAfterFailure({ schedule: degraded, now: NOW, random: 0.5 });
    }
    expect(degraded.suspendedUntil).toBe('2026-08-11T21:00:00.000Z');
    expect(calculateBackoffDelayMs({ attempt: 3, random: 0.5 })).toBe(240_000);
  });

  it('encaminha aprovação para preparação segura da Feature 007 e preserva rejeição idêntica', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(ids(), () => NOW);
    const worker = createLegislativeUpdateWorker({
      collector: collector(changedAst('Redação para decisão editorial.')),
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const created = await worker.run(job());
    if (created.kind !== 'proposal_created') throw new Error('Proposta não criada.');
    const prepareLegislativeUpdate = vi.fn(() =>
      Promise.resolve({ publicationId: PUBLICATION_ID }),
    );
    const review = createLegislativeUpdateReviewService({
      queue,
      publication: { prepareLegislativeUpdate },
    });
    const approved = await review.approve(created.updateId, ACTOR_ID);
    expect(approved).toMatchObject({
      updateReviewStatus: 'approved',
      publicationId: PUBLICATION_ID,
      approvedBy: ACTOR_ID,
    });
    expect(prepareLegislativeUpdate).toHaveBeenCalledOnce();
    expect(prepareLegislativeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.updateId }),
      ACTOR_ID,
    );
  });

  it('preserva rejeição idêntica e permite reprocessamento explícito sem duplicar', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(ids(), () => NOW);
    const sourceCollector = collector(changedAst('Redação rejeitada sem nova divergência.'));
    const worker = createLegislativeUpdateWorker({
      collector: sourceCollector,
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const created = await worker.run(job());
    if (created.kind !== 'proposal_created') throw new Error('Proposta não criada.');
    const review = createLegislativeUpdateReviewService({
      queue,
      publication: {
        prepareLegislativeUpdate: vi.fn(() => Promise.resolve({ publicationId: PUBLICATION_ID })),
      },
    });
    await review.reject(
      created.updateId,
      ACTOR_ID,
      'O parser perdeu a ressalva presente na fonte oficial.',
    );
    const repeated = await worker.run(job());
    expect(repeated.kind).toBe('proposal_reused');
    expect(await queue.list()).toHaveLength(1);
    expect((await queue.list())[0]).toMatchObject({
      updateReviewStatus: 'rejected',
      detectionCount: 2,
    });
    const reprocessed = await review.requestReprocess(created.updateId);
    expect(reprocessed).toMatchObject({
      updateReviewStatus: 'rejected',
      retryCount: 1,
      reprocessRequestedAt: NOW.toISOString(),
    });
  });
});
