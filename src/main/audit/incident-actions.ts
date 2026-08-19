import { randomUUID } from 'node:crypto';

import { createOperationalAuditEvent } from '@lex-editor/operational-audit';

import type {
  EvidenceExcerptDto,
  IncidentDetailDto,
  OpenEvidenceCommand,
  RecordIncidentNoteCommand,
} from '../../shared/ipc/audit.js';
import type { AuditActor, FederatedAuditService } from './federated-audit-service.js';
import { FederatedAuditError } from './federated-audit-service.js';
import type { EvidenceProvider } from './evidence-provider.js';
import type { LocalAuditJournalStore } from './local-audit-journal.js';

export type IncidentActions = Readonly<{
  recordIncidentNote(
    actor: AuditActor,
    command: RecordIncidentNoteCommand,
  ): Promise<IncidentDetailDto>;
  openEvidence(actor: AuditActor, command: OpenEvidenceCommand): Promise<EvidenceExcerptDto>;
}>;

const findIncidentProjectId = async (
  journal: LocalAuditJournalStore,
  incidentId: string,
): Promise<string | null> => {
  const projectIds = await journal.listProjectIds();
  const journals = await Promise.all(projectIds.map((projectId) => journal.read(projectId)));
  for (const [index, { entries }] of journals.entries()) {
    if (entries.some((entry) => entry.event.incidentId === incidentId)) {
      return projectIds[index] ?? null;
    }
  }
  return null;
};

export const createIncidentActions = (
  options: Readonly<{
    journal: LocalAuditJournalStore;
    evidenceProvider: EvidenceProvider;
    service: FederatedAuditService;
    now?: () => Date;
  }>,
): IncidentActions => {
  const now = options.now ?? (() => new Date());

  return {
    async recordIncidentNote(actor, command) {
      const projectId = await findIncidentProjectId(options.journal, command.incidentId);
      if (projectId === null) {
        throw new FederatedAuditError('incident_not_found');
      }
      await options.journal.append(
        projectId,
        createOperationalAuditEvent({
          eventId: randomUUID(),
          occurredAt: now().toISOString(),
          correlationId: randomUUID(),
          actor: { actorId: null, actorRole: actor.actorRole },
          lawId: null,
          projectId,
          runId: null,
          incidentId: command.incidentId,
          detail: {
            kind: 'incident',
            eventCode: 'incident_note_recorded',
            note: command.note,
          },
        }),
      );
      return options.service.getIncidentDetail(actor, command.incidentId);
    },
    async openEvidence(actor, command) {
      const location = await options.evidenceProvider.locate(
        command.projectId,
        command.evidenceLocatorId,
      );
      if (!location.found) {
        throw new FederatedAuditError('evidence_not_available');
      }
      const { reference } = location;
      const read = await options.evidenceProvider.read(
        reference.sourceArtifactSha256,
        reference.startLine,
        reference.endLine,
      );
      await options.journal.append(
        command.projectId,
        createOperationalAuditEvent({
          eventId: randomUUID(),
          occurredAt: now().toISOString(),
          correlationId: randomUUID(),
          actor: { actorId: null, actorRole: actor.actorRole },
          lawId: null,
          projectId: command.projectId,
          runId: null,
          incidentId: null,
          detail: {
            kind: 'evidence',
            eventCode: read.ok ? 'evidence_excerpt_opened' : 'evidence_excerpt_denied',
            evidenceLocatorId: command.evidenceLocatorId,
            sourceArtifactSha256: reference.sourceArtifactSha256,
            startLine: reference.startLine,
            endLine: read.ok ? read.endLine : reference.endLine,
            result: read.ok ? 'opened' : 'denied',
          },
        }),
      );
      if (!read.ok) {
        throw new FederatedAuditError('evidence_not_available');
      }
      return {
        evidenceLocatorId: command.evidenceLocatorId,
        sourceArtifactSha256: reference.sourceArtifactSha256,
        startLine: reference.startLine,
        endLine: read.endLine,
        excerpt: read.excerpt,
        excerptSha256: read.excerptSha256,
      };
    },
  };
};
