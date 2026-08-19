import type {
  AuditEventListItemDto,
  IncidentActionDto,
  IncidentResolutionStateDto,
} from '../../shared/ipc/audit.js';

const REPROCESSING_CODES = new Set(['reprocess_requested', 'reprocess_started']);
const RESOLVING_CODES = new Set([
  'extraction_completed',
  'parsing_completed',
  'identification_completed',
  'validation_completed',
  'export_completed',
  'reprocess_completed',
]);

const byOccurredAtAscending = (left: AuditEventListItemDto, right: AuditEventListItemDto): number =>
  left.occurredAt.localeCompare(right.occurredAt);

export const deriveIncidentResolutionState = (
  events: readonly AuditEventListItemDto[],
): IncidentResolutionStateDto => {
  const latest = [...events].sort(byOccurredAtAscending).at(-1);
  if (latest === undefined) return 'open';
  if (RESOLVING_CODES.has(latest.eventCode)) return 'resolved';
  if (REPROCESSING_CODES.has(latest.eventCode)) return 'reprocessing';
  return 'open';
};

export const deriveIncidentAvailableActions = (
  events: readonly AuditEventListItemDto[],
  resolutionState: IncidentResolutionStateDto,
): IncidentActionDto[] => {
  const actions: IncidentActionDto[] = ['record_note'];
  if (events.some((event) => event.hasEvidence)) actions.push('open_evidence');
  if (resolutionState === 'open') actions.push('request_reprocessing');
  return actions;
};
