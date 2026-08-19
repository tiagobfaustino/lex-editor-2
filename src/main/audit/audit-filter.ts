import type { AuditEventListItemDto, AuditQueryFilters } from '../../shared/ipc/audit.js';

export const matchesAuditFilters = (
  event: AuditEventListItemDto,
  filters: AuditQueryFilters,
  cutoff: string,
): boolean => {
  if (event.occurredAt > cutoff) return false;
  if (filters.projectId !== null && event.projectId !== filters.projectId) return false;
  if (filters.lawId !== null && event.lawId !== filters.lawId) return false;
  if (filters.module !== null && event.module !== filters.module) return false;
  if (filters.level !== null && event.level !== filters.level) return false;
  if (filters.category !== null && event.category !== filters.category) return false;
  if (filters.eventCode !== null && event.eventCode !== filters.eventCode) return false;
  if (filters.correlationId !== null && event.correlationId !== filters.correlationId) return false;
  if (filters.incidentId !== null && event.incidentId !== filters.incidentId) return false;
  if (filters.fromAt !== null && event.occurredAt < filters.fromAt) return false;
  if (filters.toAt !== null && event.occurredAt > filters.toAt) return false;
  if (filters.searchText.length > 0) {
    const query = filters.searchText.toLocaleLowerCase('pt-BR');
    if (
      !event.eventCode.toLocaleLowerCase('pt-BR').includes(query) &&
      !event.message.toLocaleLowerCase('pt-BR').includes(query)
    ) {
      return false;
    }
  }
  return true;
};
