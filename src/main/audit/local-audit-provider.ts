import {
  projectSafeOperationalAuditEvent,
  type OperationalAuditDetail,
  type OperationalAuditEvent,
} from '@lex-editor/operational-audit';

import {
  AuditEventDetailDtoSchema,
  AuditEventListItemDtoSchema,
  type AuditEventDetailDataDto,
  type AuditEventListItemDto,
} from '../../shared/ipc/audit.js';
import { matchesAuditFilters } from './audit-filter.js';
import type { LocalAuditJournalStore } from './local-audit-journal.js';
import type { AuditProvider, AuditProviderEvent } from './federated-audit-service.js';

const detailDto = (detail: OperationalAuditDetail): AuditEventDetailDataDto => {
  switch (detail.kind) {
    case 'pipeline':
      return {
        kind: detail.kind,
        stage: detail.stage,
        outcome: detail.outcome,
        durationMs: detail.durationMs,
        processedUnits: detail.processedUnits,
        nodeCount: detail.nodeCount,
        warningCount: detail.warningCount,
        errorCount: detail.errorCount,
        sourceArtifactSha256: detail.sourceArtifactSha256,
        fragmentSha256: detail.fragmentSha256,
        evidenceLocatorId: detail.evidence?.evidenceLocatorId ?? null,
        evidenceStartLine: detail.evidence?.startLine ?? null,
        evidenceEndLine: detail.evidence?.endLine ?? null,
      };
    case 'publication':
      return {
        kind: detail.kind,
        publicationId: detail.publicationId,
        manifestDigest: detail.manifestDigest,
        gitCommitSha: detail.gitCommitSha,
        failureCode: detail.failureCode,
      };
    case 'legislative_update':
      return {
        kind: detail.kind,
        updateId: detail.updateId,
        baseNormativeSha256: detail.baseNormativeSha256,
        candidateNormativeSha256: detail.candidateNormativeSha256,
        detailCode: detail.detailCode,
      };
    case 'source_catalog':
      return {
        kind: detail.kind,
        entityType: detail.entityType,
        entityId: detail.entityId,
        providerRevisionId: detail.providerRevisionId,
        bindingRevisionId: detail.bindingRevisionId,
        detailCode: detail.detailCode,
      };
    case 'audit_integrity':
      return {
        kind: detail.kind,
        compromisedSequence: detail.compromisedSequence,
        reason: detail.reason,
      };
    case 'reprocessing':
      return {
        kind: detail.kind,
        requestId: detail.requestId,
        plan: detail.plan,
        expectedRevisionHash: detail.expectedRevisionHash,
        resultingRevisionHash: detail.resultingRevisionHash,
        conflictCode: detail.conflictCode,
      };
    case 'evidence':
      return {
        kind: detail.kind,
        evidenceLocatorId: detail.evidenceLocatorId,
        sourceArtifactSha256: detail.sourceArtifactSha256,
        startLine: detail.startLine,
        endLine: detail.endLine,
        result: detail.result,
      };
    case 'incident':
      return {
        kind: detail.kind,
        note: detail.note,
      };
  }
};

const listItemDto = (event: OperationalAuditEvent): AuditEventListItemDto => {
  const projected = projectSafeOperationalAuditEvent(event);
  return AuditEventListItemDtoSchema.parse({
    eventId: projected.eventId,
    occurredAt: projected.occurredAt,
    level: projected.level,
    module: projected.module,
    origin: projected.origin,
    category: event.detail.kind,
    eventCode: projected.eventCode,
    message: projected.message,
    correlationId: projected.correlationId,
    actorRole: projected.actorRole,
    lawId: projected.lawId,
    projectId: projected.projectId,
    runId: projected.runId,
    incidentId: projected.incidentId,
    hasEvidence: projected.hasEvidence,
  });
};

const providerEvent = (event: OperationalAuditEvent, position: number): AuditProviderEvent => ({
  event: listItemDto(event),
  position: String(position),
});

export const createLocalAuditProvider = (journal: LocalAuditJournalStore): AuditProvider => ({
  origin: 'desktop',
  async list({ filters, cutoff, afterPosition, limit }) {
    try {
      const projectIds =
        filters.projectId === null
          ? await journal.listProjectIds()
          : (await journal.listProjectIds()).includes(filters.projectId)
            ? [filters.projectId]
            : [];
      const journals = await Promise.all(projectIds.map((projectId) => journal.read(projectId)));
      const orderedEvents = journals
        .flatMap(({ entries }) => entries.map(({ event }) => event))
        .sort((left, right) =>
          left.occurredAt === right.occurredAt
            ? left.eventId.localeCompare(right.eventId)
            : right.occurredAt.localeCompare(left.occurredAt),
        );
      const all = orderedEvents
        .map((event) => providerEvent(event, 0))
        .filter((item) => matchesAuditFilters(item.event, filters, cutoff))
        .map((item, index) => ({ ...item, position: String(index + 1) }));
      const offset = afterPosition === null ? 0 : Number(afterPosition);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return { available: false, reason: 'invalid_response' };
      }
      const items = all.slice(offset, offset + limit);
      return { available: true, items, hasMore: offset + items.length < all.length };
    } catch {
      return { available: false, reason: 'integrity_failed' };
    }
  },
  async getDetail(eventId) {
    try {
      const projectIds = await journal.listProjectIds();
      const journals = await Promise.all(projectIds.map((projectId) => journal.read(projectId)));
      for (const entry of journals.flatMap(({ entries }) => entries)) {
        if (entry.event.eventId === eventId) {
          const item = listItemDto(entry.event);
          return {
            available: true,
            detail: AuditEventDetailDtoSchema.parse({
              event: item,
              detail: detailDto(entry.event.detail),
            }),
          };
        }
      }
      return { available: true, detail: null };
    } catch {
      return { available: false, reason: 'integrity_failed' };
    }
  },
});
