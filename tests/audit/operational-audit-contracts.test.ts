import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  containsSensitiveAuditText,
  createOperationalAuditEvent,
  operationalAuditEventSchema,
  projectSafeOperationalAuditEvent,
  redactOperationalAuditError,
  redactOperationalAuditText,
  serializeCanonicalAuditJson,
  type CreateOperationalAuditEventInput,
  type OperationalAuditDetail,
} from '@lex-editor/operational-audit';

const ids = {
  event: '11111111-1111-4111-8111-111111111111',
  correlation: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333',
  law: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
  run: '66666666-6666-4666-8666-666666666666',
  incident: '77777777-7777-4777-8777-777777777777',
  entity: '88888888-8888-4888-8888-888888888888',
  locator: '99999999-9999-4999-8999-999999999999',
} as const;

const hash = 'a'.repeat(64);

const createEvent = (detail: OperationalAuditDetail) =>
  createOperationalAuditEvent({
    eventId: ids.event,
    occurredAt: '2026-08-15T12:00:00.000Z',
    correlationId: ids.correlation,
    actor: { actorId: ids.actor, actorRole: 'administrador_tecnico' },
    lawId: ids.law,
    projectId:
      detail.kind === 'pipeline' ||
      detail.kind === 'audit_integrity' ||
      detail.kind === 'reprocessing' ||
      detail.kind === 'evidence'
        ? ids.project
        : null,
    runId: ids.run,
    incidentId: ids.incident,
    detail,
  } satisfies CreateOperationalAuditEventInput);

const pipelineDetail = {
  kind: 'pipeline',
  eventCode: 'import_started',
  stage: 'import',
  outcome: 'started',
  durationMs: null,
  processedUnits: 0,
  nodeCount: 0,
  warningCount: 0,
  errorCount: 0,
  sourceArtifactSha256: null,
  fragmentSha256: null,
  evidence: null,
} as const satisfies OperationalAuditDetail;

const evidenceDetail = {
  kind: 'evidence',
  eventCode: 'evidence_excerpt_opened',
  evidenceLocatorId: ids.locator,
  sourceArtifactSha256: hash,
  startLine: 10,
  endLine: 20,
  result: 'opened',
} as const satisfies OperationalAuditDetail;

const details: readonly OperationalAuditDetail[] = [
  pipelineDetail,
  {
    kind: 'publication',
    eventCode: 'publication_published',
    publicationId: ids.entity,
    manifestDigest: hash,
    gitCommitSha: 'b'.repeat(40),
    failureCode: null,
  },
  {
    kind: 'legislative_update',
    eventCode: 'legislative_update_created',
    updateId: ids.entity,
    baseNormativeSha256: hash,
    candidateNormativeSha256: null,
    detailCode: null,
  },
  {
    kind: 'source_catalog',
    eventCode: 'source_catalog_provider_revision_created',
    entityType: 'provider',
    entityId: ids.entity,
    providerRevisionId: ids.entity,
    bindingRevisionId: null,
    detailCode: null,
  },
  {
    kind: 'audit_integrity',
    eventCode: 'audit_journal_opened',
    compromisedSequence: null,
    reason: 'invalid_schema',
  },
  {
    kind: 'reprocessing',
    eventCode: 'reprocess_requested',
    requestId: ids.entity,
    plan: 'from_source_snapshot',
    expectedRevisionHash: hash,
    resultingRevisionHash: null,
    conflictCode: null,
  },
  evidenceDetail,
];

describe('operational audit contracts', () => {
  it('creates a closed, derived event for every audit category', () => {
    for (const detail of details) {
      const event = createEvent(detail);
      expect(event.schemaVersion).toBe(1);
      expect(event.detail).toEqual(detail);
      expect(event.message).toMatch(/\.$/u);
    }
  });

  it('rejects extra context and inconsistent derived fields', () => {
    const event = createEvent(pipelineDetail);
    expect(operationalAuditEventSchema.safeParse({ ...event, secret: 'value' }).success).toBe(
      false,
    );
    expect(
      operationalAuditEventSchema.safeParse({
        ...event,
        detail: { ...event.detail, userContent: 'texto jurídico privado' },
      }).success,
    ).toBe(false);
    for (const mutation of [
      { level: 'warn' },
      { module: 'export' },
      { origin: 'publisher' },
      { message: 'Mensagem controlada pelo chamador.' },
    ]) {
      expect(operationalAuditEventSchema.safeParse({ ...event, ...mutation }).success).toBe(false);
    }
  });

  it('rejects code, pipeline stage/outcome and evidence result combinations that disagree', () => {
    expect(() =>
      createEvent({
        ...pipelineDetail,
        stage: 'export',
      }),
    ).toThrow();
    expect(() =>
      createEvent({
        ...pipelineDetail,
        outcome: 'failed',
      }),
    ).toThrow();
    expect(() =>
      createEvent({
        ...evidenceDetail,
        result: 'denied',
      }),
    ).toThrow();
  });

  it('projects only the safe list fields', () => {
    const event = createEvent(pipelineDetail);
    const projection = projectSafeOperationalAuditEvent(event);
    expect(projection.eventCode).toBe('import_started');
    expect(projection).not.toHaveProperty('detail');
    expect(projection).not.toHaveProperty('actorId');
    expect(projection).not.toHaveProperty('actor');
    expect(projection).not.toHaveProperty('sourceArtifactSha256');
  });

  it.each([
    'Authorization: Bearer abc.def',
    'Cookie=session-secret',
    'token=private-token',
    'https://example.test/file?X-Amz-Signature=secret&expires=10',
    '-----BEGIN PRIVATE KEY-----',
    '/home/tiago/private/source.html',
    'C:\\Users\\tiago\\private.txt',
    'Error\n  at parse (/app/parser.ts:10:2)',
    '<strong>texto</strong>',
  ])('detects and redacts prohibited text: %s', (candidate) => {
    expect(containsSensitiveAuditText(candidate)).toBe(true);
    const redacted = redactOperationalAuditText(candidate);
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('/home/tiago');
    expect(redacted).not.toContain('<strong>');
  });

  it('never reflects exception, stack, path or user content in a public error', () => {
    const privateMessage =
      'Usuário escreveu segredo em /home/tiago/private.txt\n  at parse (/app/parser.ts:10:2)';
    expect(redactOperationalAuditError(new Error(privateMessage))).toEqual({
      code: 'internal_error',
      message: 'Falha interna não detalhada.',
    });
  });

  it('serializes canonical JSON deterministically and omits undefined values', () => {
    expect(serializeCanonicalAuditJson({ z: 1, a: { y: 2, x: 3 }, missing: undefined })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    expect(serializeCanonicalAuditJson({ b: 2, a: 1 })).toBe(
      serializeCanonicalAuditJson({ a: 1, b: 2 }),
    );
  });

  it('keeps the package independent from infrastructure layers', async () => {
    const sourceRoot = join(process.cwd(), 'packages', 'operational-audit', 'src');
    const sources = await Promise.all(
      ['canonical.ts', 'contracts.ts', 'index.ts', 'redaction.ts'].map((name) =>
        readFile(join(sourceRoot, name), 'utf8'),
      ),
    );
    expect(sources.join('\n')).not.toMatch(
      /from ['"](?:node:|electron|react|@supabase|.*\/src\/(?:main|preload|renderer))/u,
    );
  });
});
