import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createOperationalAuditEvent } from '@lex-editor/operational-audit';

import { createEvidenceProvider } from '../../src/main/audit/evidence-provider.js';
import {
  createFederatedAuditService,
  FederatedAuditError,
  type AuditActor,
} from '../../src/main/audit/federated-audit-service.js';
import { createIncidentActions } from '../../src/main/audit/incident-actions.js';
import { createLocalAuditJournalStore } from '../../src/main/audit/local-audit-journal.js';
import { createLocalAuditProvider } from '../../src/main/audit/local-audit-provider.js';

const ACTOR: AuditActor = { actorKey: 'actor-1', actorRole: 'administrador_tecnico' };
const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '99999999-9999-4999-8999-999999999999';
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const roots: string[] = [];
const makeStorageRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'lex-incident-actions-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const setup = async () => {
  const storageRoot = await makeStorageRoot();
  const journal = createLocalAuditJournalStore(storageRoot);
  const service = createFederatedAuditService({
    providers: [createLocalAuditProvider(journal)],
  });
  const evidenceProvider = createEvidenceProvider(journal, storageRoot);
  const actions = createIncidentActions({ journal, evidenceProvider, service });
  return { storageRoot, journal, service, evidenceProvider, actions };
};

const pipelineEventWithIncident = (incidentId: string, eventProjectId = projectId) =>
  createOperationalAuditEvent({
    eventId: '22222222-2222-4222-8222-222222222222',
    occurredAt: '2026-08-15T12:00:00.000Z',
    correlationId: '33333333-3333-4333-8333-333333333333',
    actor: { actorId: null, actorRole: 'system' },
    lawId: null,
    projectId: eventProjectId,
    runId: '44444444-4444-4444-8444-444444444444',
    incidentId,
    detail: {
      kind: 'pipeline',
      eventCode: 'import_failed',
      stage: 'import',
      outcome: 'failed',
      durationMs: 100,
      processedUnits: 0,
      nodeCount: 0,
      warningCount: 0,
      errorCount: 1,
      sourceArtifactSha256: null,
      fragmentSha256: null,
      evidence: null,
    },
  });

const pipelineEventWithEvidence = (
  evidenceLocatorId: string,
  sourceArtifactSha256: string,
  eventProjectId = projectId,
) =>
  createOperationalAuditEvent({
    eventId: '55555555-5555-4555-8555-555555555555',
    occurredAt: '2026-08-15T12:00:00.000Z',
    correlationId: '33333333-3333-4333-8333-333333333333',
    actor: { actorId: null, actorRole: 'system' },
    lawId: null,
    projectId: eventProjectId,
    runId: '44444444-4444-4444-8444-444444444444',
    incidentId: null,
    detail: {
      kind: 'pipeline',
      eventCode: 'parsing_failed',
      stage: 'parsing',
      outcome: 'failed',
      durationMs: 100,
      processedUnits: 0,
      nodeCount: 0,
      warningCount: 0,
      errorCount: 1,
      sourceArtifactSha256,
      fragmentSha256: null,
      evidence: {
        evidenceLocatorId,
        sourceArtifactSha256,
        fragmentSha256: null,
        startLine: 1,
        endLine: 3,
      },
    },
  });

describe('createIncidentActions: recordIncidentNote', () => {
  it('anexa a nota ao projeto correto e devolve o incidente atualizado', async () => {
    const { journal, actions } = await setup();
    const incidentId = '66666666-6666-4666-8666-666666666666';
    await journal.append(projectId, pipelineEventWithIncident(incidentId));

    const detail = await actions.recordIncidentNote(ACTOR, {
      incidentId,
      note: 'Falha investigada, aguardando reprocessamento.',
    });

    expect(detail.incidentId).toBe(incidentId);
    expect(detail.events).toHaveLength(2);
    expect(detail.events.some((event) => event.eventCode === 'incident_note_recorded')).toBe(true);

    const { entries } = await journal.read(projectId);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.event.detail).toMatchObject({
      kind: 'incident',
      eventCode: 'incident_note_recorded',
      note: 'Falha investigada, aguardando reprocessamento.',
    });
  });

  it('rejeita com incident_not_found quando nenhum evento referencia o incidente', async () => {
    const { actions } = await setup();

    await expect(
      actions.recordIncidentNote(ACTOR, {
        incidentId: '77777777-7777-4777-8777-777777777777',
        note: 'Nota órfã.',
      }),
    ).rejects.toMatchObject({ code: 'incident_not_found' } satisfies Partial<FederatedAuditError>);
  });

  it('rejeita nota com texto sensível sem gravar no diário', async () => {
    const { journal, actions } = await setup();
    const incidentId = '88888888-8888-4888-8888-888888888888';
    await journal.append(projectId, pipelineEventWithIncident(incidentId));

    await expect(
      actions.recordIncidentNote(ACTOR, {
        incidentId,
        note: 'password: hunter2',
      }),
    ).rejects.toBeInstanceOf(z.ZodError);

    const { entries } = await journal.read(projectId);
    expect(entries).toHaveLength(1);
  });
});

describe('createIncidentActions: openEvidence', () => {
  it('abre o trecho autorizado quando o hash confere e audita o acesso', async () => {
    const { journal, actions, storageRoot } = await setup();
    const evidenceLocatorId = '99999999-9999-4999-8999-999999999998';
    const content = 'linha 1\nlinha 2\nlinha 3\n';
    const artifactSha256 = sha256(Buffer.from(content, 'utf8'));
    await journal.append(projectId, pipelineEventWithEvidence(evidenceLocatorId, artifactSha256));
    const sourceDirectory = join(storageRoot, 'sources', 'law-1');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(sourceDirectory, `artifact-${artifactSha256}`), content, 'utf8');

    const excerpt = await actions.openEvidence(ACTOR, { projectId, evidenceLocatorId });

    expect(excerpt.evidenceLocatorId).toBe(evidenceLocatorId);
    expect(excerpt.sourceArtifactSha256).toBe(artifactSha256);
    expect(excerpt.excerpt).toBe('linha 1\nlinha 2\nlinha 3');

    const { entries } = await journal.read(projectId);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.event.detail).toMatchObject({
      kind: 'evidence',
      eventCode: 'evidence_excerpt_opened',
      result: 'opened',
      evidenceLocatorId,
    });
  });

  it('nega e audita o acesso quando o artefato de origem está ausente', async () => {
    const { journal, actions } = await setup();
    const evidenceLocatorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const artifactSha256 = 'c'.repeat(64);
    await journal.append(projectId, pipelineEventWithEvidence(evidenceLocatorId, artifactSha256));

    await expect(
      actions.openEvidence(ACTOR, { projectId, evidenceLocatorId }),
    ).rejects.toMatchObject({
      code: 'evidence_not_available',
    } satisfies Partial<FederatedAuditError>);

    const { entries } = await journal.read(projectId);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.event.detail).toMatchObject({
      kind: 'evidence',
      eventCode: 'evidence_excerpt_denied',
      result: 'denied',
      evidenceLocatorId,
    });
  });

  it('rejeita sem auditar quando o localizador não corresponde a nenhuma evidência', async () => {
    const { journal, actions } = await setup();

    await expect(
      actions.openEvidence(ACTOR, {
        projectId: otherProjectId,
        evidenceLocatorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).rejects.toMatchObject({
      code: 'evidence_not_available',
    } satisfies Partial<FederatedAuditError>);

    const { entries } = await journal.read(otherProjectId);
    expect(entries).toHaveLength(0);
  });
});
