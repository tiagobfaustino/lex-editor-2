import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDesktopAuditIpcCapabilities } from '../../src/main/audit/audit-ipc-capabilities.js';
import {
  FederatedAuditError,
  type AuditActor,
  type FederatedAuditService,
} from '../../src/main/audit/federated-audit-service.js';
import { DesktopIpcError } from '../../src/main/ipc/validated-handler.js';
import type {
  AuditEventDetailDto,
  AuditPageDto,
  EvidenceExcerptDto,
  IncidentDetailDto,
  OpenEvidenceCommand,
  RecordIncidentNoteCommand,
} from '../../src/shared/ipc/audit.js';

const ADMIN_ACTOR: AuditActor = { actorKey: 'actor-1', actorRole: 'administrador_tecnico' };

const EMPTY_PAGE: AuditPageDto = {
  items: [],
  nextCursor: null,
  queryCutoff: '2026-08-15T12:00:00.000Z',
  completeness: 'complete',
  unavailableOrigins: [],
};

const QUERY_COMMAND = {
  filters: {
    projectId: null,
    lawId: null,
    module: null,
    level: null,
    category: null,
    eventCode: null,
    correlationId: null,
    incidentId: null,
    fromAt: null,
    toAt: null,
    searchText: '',
  },
  cursor: null,
  limit: 20,
} as const;

const EVENT_ID_COMMAND = { eventId: '11111111-1111-4111-8111-111111111111' } as const;

const TIMELINE_COMMAND = {
  correlationId: '22222222-2222-4222-8222-222222222222',
  cursor: null,
  limit: 10,
} as const;

const INCIDENT_ID_COMMAND = { incidentId: '44444444-4444-4444-8444-444444444444' } as const;

const RECORD_NOTE_COMMAND: RecordIncidentNoteCommand = {
  incidentId: '44444444-4444-4444-8444-444444444444',
  note: 'Falha investigada, aguardando reprocessamento.',
};

const OPEN_EVIDENCE_COMMAND: OpenEvidenceCommand = {
  projectId: '55555555-5555-4555-8555-555555555555',
  evidenceLocatorId: '66666666-6666-4666-8666-666666666666',
};

const INCIDENT_DETAIL: IncidentDetailDto = {
  incidentId: '44444444-4444-4444-8444-444444444444',
  resolutionState: 'open',
  events: [],
  availableActions: ['record_note', 'open_evidence'],
  completeness: 'complete',
  unavailableOrigins: [],
};

const EVIDENCE_EXCERPT: EvidenceExcerptDto = {
  evidenceLocatorId: '66666666-6666-4666-8666-666666666666',
  sourceArtifactSha256: 'a'.repeat(64),
  startLine: 1,
  endLine: 5,
  excerpt: 'trecho autorizado',
  excerptSha256: 'b'.repeat(64),
};

const makeService = (overrides: Partial<FederatedAuditService> = {}): FederatedAuditService => ({
  query: overrides.query ?? (() => Promise.resolve(EMPTY_PAGE)),
  getDetail:
    overrides.getDetail ??
    (() => {
      throw new Error('unexpected getDetail call');
    }),
  timeline:
    overrides.timeline ??
    (() => {
      throw new Error('unexpected timeline call');
    }),
  getIncidentDetail:
    overrides.getIncidentDetail ??
    (() => {
      throw new Error('unexpected getIncidentDetail call');
    }),
});

const makeCapabilities = (
  overrides: Readonly<{
    service?: FederatedAuditService;
    getActor?(): AuditActor | null;
    recordIncidentNote?(
      actor: AuditActor,
      command: RecordIncidentNoteCommand,
    ): Promise<IncidentDetailDto>;
    openEvidence?(actor: AuditActor, command: OpenEvidenceCommand): Promise<EvidenceExcerptDto>;
  }> = {},
) =>
  createDesktopAuditIpcCapabilities({
    service: overrides.service ?? makeService(),
    getActor: overrides.getActor ?? (() => ADMIN_ACTOR),
    recordIncidentNote:
      overrides.recordIncidentNote ??
      (() => {
        throw new Error('unexpected recordIncidentNote call');
      }),
    openEvidence:
      overrides.openEvidence ??
      (() => {
        throw new Error('unexpected openEvidence call');
      }),
  });

describe('createDesktopAuditIpcCapabilities: autorização', () => {
  it('autoriza somente quando o ator é administrador_tecnico', () => {
    const capabilities = makeCapabilities({ getActor: () => ADMIN_ACTOR });

    expect(capabilities.queryAudit.authorize(QUERY_COMMAND)).toBe(true);
    expect(capabilities.getAuditDetail.authorize(EVENT_ID_COMMAND)).toBe(true);
    expect(capabilities.getAuditTimeline.authorize(TIMELINE_COMMAND)).toBe(true);
    expect(capabilities.getIncidentDetail.authorize(INCIDENT_ID_COMMAND)).toBe(true);
    expect(capabilities.recordIncidentNote.authorize(RECORD_NOTE_COMMAND)).toBe(true);
    expect(capabilities.openEvidence.authorize(OPEN_EVIDENCE_COMMAND)).toBe(true);
  });

  it('não autoriza quando não há ator autenticado', () => {
    const capabilities = makeCapabilities({ getActor: () => null });

    expect(capabilities.queryAudit.authorize(QUERY_COMMAND)).toBe(false);
    expect(capabilities.getAuditDetail.authorize(EVENT_ID_COMMAND)).toBe(false);
    expect(capabilities.getAuditTimeline.authorize(TIMELINE_COMMAND)).toBe(false);
    expect(capabilities.getIncidentDetail.authorize(INCIDENT_ID_COMMAND)).toBe(false);
    expect(capabilities.recordIncidentNote.authorize(RECORD_NOTE_COMMAND)).toBe(false);
    expect(capabilities.openEvidence.authorize(OPEN_EVIDENCE_COMMAND)).toBe(false);
  });
});

describe('createDesktopAuditIpcCapabilities: delegação', () => {
  it('encaminha query para o serviço com o ator resolvido', async () => {
    let receivedActor: AuditActor | undefined;
    const capabilities = makeCapabilities({
      service: makeService({
        query: (actor, command) => {
          receivedActor = actor;
          expect(command).toEqual(QUERY_COMMAND);
          return Promise.resolve(EMPTY_PAGE);
        },
      }),
    });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).resolves.toEqual(EMPTY_PAGE);
    expect(receivedActor).toEqual(ADMIN_ACTOR);
  });

  it('encaminha getDetail para o serviço', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const detailResult: AuditEventDetailDto = {
      event: {
        eventId,
        occurredAt: '2026-08-15T12:00:00.000Z',
        level: 'info',
        module: 'publication',
        origin: 'desktop',
        category: 'publication',
        eventCode: 'publication_published',
        message: 'Publicação confirmada.',
        correlationId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'administrador_tecnico',
        lawId: null,
        projectId: null,
        runId: null,
        incidentId: null,
        hasEvidence: false,
      },
      detail: {
        kind: 'publication',
        publicationId: '33333333-3333-4333-8333-333333333333',
        manifestDigest: null,
        gitCommitSha: null,
        failureCode: null,
      },
    };

    const capabilities = makeCapabilities({
      service: makeService({
        getDetail: (actor, receivedEventId) => {
          expect(actor).toEqual(ADMIN_ACTOR);
          expect(receivedEventId).toBe(eventId);
          return Promise.resolve(detailResult);
        },
      }),
    });

    await expect(capabilities.getAuditDetail.handle({ eventId })).resolves.toEqual(detailResult);
  });

  it('encaminha timeline para o serviço', async () => {
    const timelineCommand = {
      correlationId: '22222222-2222-4222-8222-222222222222',
      cursor: null,
      limit: 10,
    } as const;

    const capabilities = makeCapabilities({
      service: makeService({
        timeline: (actor, command) => {
          expect(actor).toEqual(ADMIN_ACTOR);
          expect(command).toEqual(timelineCommand);
          return Promise.resolve(EMPTY_PAGE);
        },
      }),
    });

    await expect(capabilities.getAuditTimeline.handle(timelineCommand)).resolves.toEqual(
      EMPTY_PAGE,
    );
  });

  it('encaminha getIncidentDetail para o serviço', async () => {
    const capabilities = makeCapabilities({
      service: makeService({
        getIncidentDetail: (actor, incidentId) => {
          expect(actor).toEqual(ADMIN_ACTOR);
          expect(incidentId).toBe(INCIDENT_ID_COMMAND.incidentId);
          return Promise.resolve(INCIDENT_DETAIL);
        },
      }),
    });

    await expect(capabilities.getIncidentDetail.handle(INCIDENT_ID_COMMAND)).resolves.toEqual(
      INCIDENT_DETAIL,
    );
  });

  it('encaminha recordIncidentNote para a ação injetada', async () => {
    let receivedActor: AuditActor | undefined;
    let receivedCommand: RecordIncidentNoteCommand | undefined;
    const capabilities = makeCapabilities({
      recordIncidentNote: (actor, command) => {
        receivedActor = actor;
        receivedCommand = command;
        return Promise.resolve(INCIDENT_DETAIL);
      },
    });

    await expect(capabilities.recordIncidentNote.handle(RECORD_NOTE_COMMAND)).resolves.toEqual(
      INCIDENT_DETAIL,
    );
    expect(receivedActor).toEqual(ADMIN_ACTOR);
    expect(receivedCommand).toEqual(RECORD_NOTE_COMMAND);
  });

  it('encaminha openEvidence para a ação injetada', async () => {
    let receivedActor: AuditActor | undefined;
    let receivedCommand: OpenEvidenceCommand | undefined;
    const capabilities = makeCapabilities({
      openEvidence: (actor, command) => {
        receivedActor = actor;
        receivedCommand = command;
        return Promise.resolve(EVIDENCE_EXCERPT);
      },
    });

    await expect(capabilities.openEvidence.handle(OPEN_EVIDENCE_COMMAND)).resolves.toEqual(
      EVIDENCE_EXCERPT,
    );
    expect(receivedActor).toEqual(ADMIN_ACTOR);
    expect(receivedCommand).toEqual(OPEN_EVIDENCE_COMMAND);
  });
});

describe('createDesktopAuditIpcCapabilities: tratamento de erros', () => {
  it('rejeita com NOT_ALLOWED quando não há ator, sem chamar o serviço', async () => {
    const capabilities = makeCapabilities({ getActor: () => null });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
  });

  it('mapeia cursor_invalid para INVALID_INPUT', async () => {
    const capabilities = makeCapabilities({
      service: makeService({
        query: () => Promise.reject(new FederatedAuditError('cursor_invalid')),
      }),
    });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('mapeia rate_limited para NOT_ALLOWED', async () => {
    const capabilities = makeCapabilities({
      service: makeService({
        query: () => Promise.reject(new FederatedAuditError('rate_limited')),
      }),
    });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
  });

  it('mapeia event_not_found para FAILED', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const capabilities = makeCapabilities({
      service: makeService({
        getDetail: () => Promise.reject(new FederatedAuditError('event_not_found')),
      }),
    });

    await expect(capabilities.getAuditDetail.handle({ eventId })).rejects.toMatchObject({
      code: 'FAILED',
    });
  });

  it('mapeia incident_not_found para FAILED', async () => {
    const capabilities = makeCapabilities({
      service: makeService({
        getIncidentDetail: () => Promise.reject(new FederatedAuditError('incident_not_found')),
      }),
    });

    await expect(capabilities.getIncidentDetail.handle(INCIDENT_ID_COMMAND)).rejects.toMatchObject({
      code: 'FAILED',
    });
  });

  it('mapeia evidence_not_available para FAILED', async () => {
    const capabilities = makeCapabilities({
      openEvidence: () => Promise.reject(new FederatedAuditError('evidence_not_available')),
    });

    await expect(capabilities.openEvidence.handle(OPEN_EVIDENCE_COMMAND)).rejects.toMatchObject({
      code: 'FAILED',
    });
  });

  it('mapeia ZodError (nota sensível) para INVALID_INPUT', async () => {
    const zodError = new z.ZodError([]);
    const capabilities = makeCapabilities({
      recordIncidentNote: () => Promise.reject(zodError),
    });

    await expect(capabilities.recordIncidentNote.handle(RECORD_NOTE_COMMAND)).rejects.toMatchObject(
      { code: 'INVALID_INPUT' },
    );
  });

  it('propaga erros que não são FederatedAuditError sem transformação', async () => {
    const originalError = new Error('falha inesperada');
    const capabilities = makeCapabilities({
      service: makeService({
        query: () => Promise.reject(originalError),
      }),
    });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).rejects.toBe(originalError);
  });

  it('rejeições continuam sendo instâncias de DesktopIpcError para erros mapeados', async () => {
    const capabilities = makeCapabilities({
      service: makeService({
        query: () => Promise.reject(new FederatedAuditError('cursor_invalid')),
      }),
    });

    await expect(capabilities.queryAudit.handle(QUERY_COMMAND)).rejects.toBeInstanceOf(
      DesktopIpcError,
    );
  });
});
