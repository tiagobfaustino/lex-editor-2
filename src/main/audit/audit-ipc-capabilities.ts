import { z } from 'zod';

import type {
  EvidenceExcerptDto,
  IncidentDetailDto,
  OpenEvidenceCommand,
  RecordIncidentNoteCommand,
} from '../../shared/ipc/audit.js';
import type { DesktopAuditIpcCapabilities } from '../ipc/register.js';
import { DesktopIpcError } from '../ipc/validated-handler.js';
import {
  FederatedAuditError,
  type AuditActor,
  type FederatedAuditService,
} from './federated-audit-service.js';

const mapAuditError = (error: unknown): never => {
  if (error instanceof FederatedAuditError) {
    throw new DesktopIpcError(
      error.code === 'cursor_invalid'
        ? 'INVALID_INPUT'
        : error.code === 'rate_limited'
          ? 'NOT_ALLOWED'
          : 'FAILED',
    );
  }
  if (error instanceof z.ZodError) {
    throw new DesktopIpcError('INVALID_INPUT');
  }
  throw error;
};

export const createDesktopAuditIpcCapabilities = (
  options: Readonly<{
    service: FederatedAuditService;
    getActor(): AuditActor | null;
    recordIncidentNote(
      actor: AuditActor,
      command: RecordIncidentNoteCommand,
    ): Promise<IncidentDetailDto>;
    openEvidence(actor: AuditActor, command: OpenEvidenceCommand): Promise<EvidenceExcerptDto>;
  }>,
): DesktopAuditIpcCapabilities => {
  const actorOrThrow = (): AuditActor => {
    const actor = options.getActor();
    if (actor === null) {
      throw new DesktopIpcError('NOT_ALLOWED');
    }
    return actor;
  };
  const authorized = (): boolean => options.getActor()?.actorRole === 'administrador_tecnico';

  return {
    queryAudit: {
      authorize: authorized,
      handle: async (command) => {
        try {
          return await options.service.query(actorOrThrow(), command);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
    getAuditDetail: {
      authorize: authorized,
      handle: async ({ eventId }) => {
        try {
          return await options.service.getDetail(actorOrThrow(), eventId);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
    getAuditTimeline: {
      authorize: authorized,
      handle: async (command) => {
        try {
          return await options.service.timeline(actorOrThrow(), command);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
    getIncidentDetail: {
      authorize: authorized,
      handle: async ({ incidentId }) => {
        try {
          return await options.service.getIncidentDetail(actorOrThrow(), incidentId);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
    recordIncidentNote: {
      authorize: authorized,
      handle: async (command) => {
        try {
          return await options.recordIncidentNote(actorOrThrow(), command);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
    openEvidence: {
      authorize: authorized,
      handle: async (command) => {
        try {
          return await options.openEvidence(actorOrThrow(), command);
        } catch (error) {
          return mapAuditError(error);
        }
      },
    },
  };
};
