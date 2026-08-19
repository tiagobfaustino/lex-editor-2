import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';

import {
  AuditCategoryDtoSchema,
  AuditLevelDtoSchema,
  AuditModuleDtoSchema,
  type AuditEventDetailDataDto,
  type AuditEventDetailDto,
  type AuditEventListItemDto,
  type AuditPageDto,
  type AuditQueryFilters,
  type EvidenceExcerptDto,
  type IncidentActionDto,
  type IncidentDetailDto,
  type IncidentResolutionStateDto,
} from '../../../../shared/ipc/audit.js';
import type {
  ReprocessingPlanDto,
  ReprocessingStateDto,
  ReprocessingStatusDto,
} from '../../../../shared/ipc/reprocessing.js';

const lawIdSchema = z.uuid();
const parseLawId = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = lawIdSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
};

type AuditPanelProps = Readonly<{ currentProjectId: string | null }>;

type ViewState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; page: AuditPageDto }>
  | Readonly<{ kind: 'error'; message: string }>;

const EMPTY_FILTERS: AuditQueryFilters = Object.freeze({
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
});

const INCIDENT_STATE_LABELS: Readonly<Record<IncidentResolutionStateDto, string>> = Object.freeze({
  open: 'Aberto',
  reprocessing: 'Reprocessando',
  resolved: 'Resolvido',
});

const INCIDENT_ACTION_LABELS: Readonly<Record<IncidentActionDto, string>> = Object.freeze({
  record_note: 'Registrar nota',
  open_evidence: 'Abrir evidência',
  request_reprocessing: 'Solicitar reprocessamento',
});

const REPROCESS_PLAN_LABELS: Readonly<Record<ReprocessingPlanDto, string>> = Object.freeze({
  from_source_snapshot: 'A partir do snapshot da fonte',
  from_identified_revision: 'A partir da revisão identificada (só derivados)',
});

const REPROCESS_STATUS_LABELS: Readonly<Record<ReprocessingStatusDto, string>> = Object.freeze({
  running: 'Em andamento',
  awaiting_promotion: 'Promovendo',
  completed: 'Concluído',
  conflicted: 'Conflito — decisão necessária',
  failed: 'Falhou',
  cancelled: 'Cancelado',
});

const REPROCESS_TERMINAL_STATUSES = new Set<ReprocessingStatusDto>([
  'completed',
  'conflicted',
  'failed',
  'cancelled',
]);

const evidenceLocatorIdOf = (detail: AuditEventDetailDataDto): string | null => {
  if (detail.kind === 'pipeline' || detail.kind === 'evidence') return detail.evidenceLocatorId;
  return null;
};

const toStartTimestamp = (value: string): string | null =>
  value.length === 0 ? null : `${value}T00:00:00.000Z`;
const toEndTimestamp = (value: string): string | null =>
  value.length === 0 ? null : `${value}T23:59:59.999Z`;

const DETAIL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  stage: 'Etapa',
  outcome: 'Resultado',
  durationMs: 'Duração (ms)',
  processedUnits: 'Unidades processadas',
  nodeCount: 'Nós',
  warningCount: 'Avisos',
  errorCount: 'Erros',
  sourceArtifactSha256: 'Hash do artefato',
  fragmentSha256: 'Hash do fragmento',
  publicationId: 'Publicação',
  manifestDigest: 'Digest do manifesto',
  gitCommitSha: 'Commit Git',
  failureCode: 'Código da falha',
  updateId: 'Atualização',
  baseNormativeSha256: 'Hash normativo base',
  candidateNormativeSha256: 'Hash normativo candidato',
  detailCode: 'Código de detalhe',
  entityType: 'Tipo da entidade',
  entityId: 'Entidade',
  providerRevisionId: 'Revisão do provedor',
  bindingRevisionId: 'Revisão do vínculo',
  compromisedSequence: 'Sequência comprometida',
  reason: 'Motivo',
  requestId: 'Solicitação',
  plan: 'Plano',
  expectedRevisionHash: 'Revisão esperada',
  resultingRevisionHash: 'Revisão resultante',
  conflictCode: 'Código do conflito',
  evidenceLocatorId: 'Localizador da evidência',
  startLine: 'Linha inicial',
  endLine: 'Linha final',
  result: 'Resultado',
});

const detailEntries = (
  detail: AuditEventDetailDataDto,
): readonly Readonly<{ key: string; label: string; value: string }>[] =>
  Object.entries(detail).flatMap(([key, value]) => {
    if (key === 'kind' || value === null) return [];
    return [{ key, label: DETAIL_LABELS[key] ?? key, value: String(value) }];
  });

const EventList = ({
  items,
  selectedEventId,
  onSelect,
}: Readonly<{
  items: readonly AuditEventListItemDto[];
  selectedEventId: string | null;
  onSelect(event: AuditEventListItemDto): void;
}>): React.JSX.Element => (
  <ol className="audit-event-list" aria-label="Eventos operacionais">
    {items.map((event) => (
      <li className="audit-event-card" key={event.eventId}>
        <button
          type="button"
          className={selectedEventId === event.eventId ? 'is-selected' : ''}
          aria-pressed={selectedEventId === event.eventId}
          onClick={() => {
            onSelect(event);
          }}
        >
          <span className={`audit-level audit-level-${event.level}`}>{event.level}</span>
          <span className="audit-event-heading">
            <strong>{event.message}</strong>
            <code>{event.eventCode}</code>
          </span>
          <span className="audit-event-meta">
            {event.module.replaceAll('_', ' ')} · {event.origin.replaceAll('_', ' ')} ·{' '}
            <time dateTime={event.occurredAt}>
              {new Date(event.occurredAt).toLocaleString('pt-BR')}
            </time>
          </span>
          {event.incidentId !== null || event.hasEvidence ? (
            <span className="audit-event-badges">
              {event.incidentId !== null ? (
                <span className="audit-badge audit-badge-incident">Incidente</span>
              ) : null}
              {event.hasEvidence ? (
                <span className="audit-badge audit-badge-evidence">Evidência</span>
              ) : null}
            </span>
          ) : null}
        </button>
      </li>
    ))}
  </ol>
);

const EventDetail = ({
  detail,
  timeline,
  busy,
  onOpenIncident,
  onOpenEvidence,
}: Readonly<{
  detail: AuditEventDetailDto | null;
  timeline: readonly AuditEventListItemDto[];
  busy: boolean;
  onOpenIncident(incidentId: string, trigger: HTMLElement): void;
  onOpenEvidence(projectId: string, evidenceLocatorId: string, trigger: HTMLElement): void;
}>): React.JSX.Element => (
  <aside className="audit-detail" aria-labelledby="audit-detail-title" aria-busy={busy}>
    <h3 id="audit-detail-title">Detalhe e correlação</h3>
    {busy ? (
      <p role="status">Carregando detalhe…</p>
    ) : detail === null ? (
      <p>Selecione um evento para consultar somente os campos autorizados.</p>
    ) : (
      <>
        <p className="audit-detail-message">{detail.event.message}</p>
        <dl>
          {detailEntries(detail.detail).map((entry) => (
            <div key={entry.key}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
        {detail.event.incidentId !== null || evidenceLocatorIdOf(detail.detail) !== null ? (
          <div className="audit-detail-actions">
            {detail.event.incidentId !== null ? (
              <button
                type="button"
                className="text-button"
                onClick={(event) => {
                  const { incidentId } = detail.event;
                  if (incidentId !== null) onOpenIncident(incidentId, event.currentTarget);
                }}
              >
                Ver incidente
              </button>
            ) : null}
            {(() => {
              const locatorId = evidenceLocatorIdOf(detail.detail);
              const { projectId } = detail.event;
              return locatorId !== null && projectId !== null ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={(event) => {
                    onOpenEvidence(projectId, locatorId, event.currentTarget);
                  }}
                >
                  Abrir evidência
                </button>
              ) : null;
            })()}
          </div>
        ) : null}
        <h4>Linha do tempo da correlação</h4>
        <ol className="audit-timeline">
          {timeline.map((event) => (
            <li key={event.eventId}>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString('pt-BR')}
              </time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      </>
    )}
  </aside>
);

type IncidentViewState =
  | Readonly<{ kind: 'closed' }>
  | Readonly<{ kind: 'loading'; incidentId: string }>
  | Readonly<{ kind: 'ready'; detail: IncidentDetailDto }>
  | Readonly<{ kind: 'error'; incidentId: string; message: string }>;

type ReprocessViewState =
  | Readonly<{ kind: 'closed' }>
  | Readonly<{ kind: 'form'; projectId: string }>
  | Readonly<{ kind: 'submitting'; projectId: string }>
  | Readonly<{ kind: 'tracking'; projectId: string; state: ReprocessingStateDto }>
  | Readonly<{ kind: 'error'; message: string }>;

const incidentProjectId = (detail: IncidentDetailDto): string | null =>
  detail.events.find((event) => event.projectId !== null)?.projectId ?? null;

const ReprocessSection = ({
  view,
  plan,
  reason,
  onPlanChange,
  onReasonChange,
  onSubmit,
  onCancel,
}: Readonly<{
  view: ReprocessViewState;
  plan: ReprocessingPlanDto;
  reason: string;
  onPlanChange(plan: ReprocessingPlanDto): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}>): React.JSX.Element | null => {
  if (view.kind === 'closed') return null;
  return (
    <section className="audit-reprocess-section" aria-labelledby="audit-reprocess-title">
      <h4 id="audit-reprocess-title">Reprocessamento local</h4>
      {view.kind === 'form' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label htmlFor="audit-reprocess-plan">Plano</label>
          <select
            id="audit-reprocess-plan"
            value={plan}
            onChange={(event) => {
              onPlanChange(event.currentTarget.value as ReprocessingPlanDto);
            }}
          >
            {(Object.keys(REPROCESS_PLAN_LABELS) as ReprocessingPlanDto[]).map((option) => (
              <option value={option} key={option}>
                {REPROCESS_PLAN_LABELS[option]}
              </option>
            ))}
          </select>
          <label htmlFor="audit-reprocess-reason">Motivo</label>
          <textarea
            id="audit-reprocess-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => {
              onReasonChange(event.currentTarget.value);
            }}
          />
          <div className="audit-reprocess-actions">
            <button type="submit" disabled={reason.trim().length === 0}>
              Solicitar
            </button>
            <button type="button" className="text-button" onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
      {view.kind === 'submitting' ? <p role="status">Solicitando reprocessamento…</p> : null}
      {view.kind === 'error' ? (
        <p className="operation-error" role="alert">
          {view.message}
        </p>
      ) : null}
      {view.kind === 'tracking' ? (
        <div aria-live="polite">
          <p>
            Status:{' '}
            <span className={`audit-badge audit-badge-reprocess-${view.state.status}`}>
              {REPROCESS_STATUS_LABELS[view.state.status]}
            </span>
          </p>
          {view.state.status === 'conflicted' ? (
            <p role="alert">
              A base mudou e há correções editoriais pendentes de decisão. A revisão corrente foi
              preservada.
            </p>
          ) : null}
          {REPROCESS_TERMINAL_STATUSES.has(view.state.status) ? (
            <a href="#preview">Voltar ao preview</a>
          ) : (
            <p role="status">Acompanhando…</p>
          )}
        </div>
      ) : null}
    </section>
  );
};

const IncidentPanel = ({
  view,
  noteText,
  noteBusy,
  onNoteChange,
  onSubmitNote,
  onClose,
  panelRef,
  onOpenReprocess,
}: Readonly<{
  view: IncidentViewState;
  noteText: string;
  noteBusy: boolean;
  onNoteChange(value: string): void;
  onSubmitNote(): void;
  onClose(): void;
  panelRef: React.RefObject<HTMLElement | null>;
  onOpenReprocess(projectId: string): void;
}>): React.JSX.Element | null => {
  if (view.kind === 'closed') return null;
  return (
    <aside
      className="audit-incident-panel"
      role="dialog"
      aria-labelledby="audit-incident-title"
      aria-busy={view.kind === 'loading'}
      tabIndex={-1}
      ref={panelRef}
    >
      <div className="audit-side-panel-header">
        <h3 id="audit-incident-title">Incidente</h3>
        <button type="button" className="text-button" onClick={onClose}>
          Fechar
        </button>
      </div>
      {view.kind === 'loading' ? <p role="status">Carregando incidente…</p> : null}
      {view.kind === 'error' ? (
        <p className="operation-error" role="alert">
          {view.message}
        </p>
      ) : null}
      {view.kind === 'ready' ? (
        <>
          <p className="audit-incident-state">
            Estado:{' '}
            <span className={`audit-badge audit-badge-state-${view.detail.resolutionState}`}>
              {INCIDENT_STATE_LABELS[view.detail.resolutionState]}
            </span>
          </p>
          {view.detail.completeness !== 'complete' ? (
            <p className="audit-completeness" role="status">
              Incidente {view.detail.completeness === 'local_only' ? 'somente local' : 'parcial'}.
            </p>
          ) : null}
          <ol className="audit-timeline">
            {view.detail.events.map((event) => (
              <li key={event.eventId}>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString('pt-BR')}
                </time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
          <ul className="audit-incident-actions">
            {view.detail.availableActions.map((action) => {
              const projectId = incidentProjectId(view.detail);
              if (action === 'request_reprocessing' && projectId !== null) {
                return (
                  <li key={action}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenReprocess(projectId);
                      }}
                    >
                      {INCIDENT_ACTION_LABELS[action]}
                    </button>
                  </li>
                );
              }
              return <li key={action}>{INCIDENT_ACTION_LABELS[action]}</li>;
            })}
          </ul>
          <form
            className="audit-incident-note-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitNote();
            }}
          >
            <label htmlFor="audit-incident-note">Registrar nota</label>
            <textarea
              id="audit-incident-note"
              maxLength={280}
              value={noteText}
              onChange={(event) => {
                onNoteChange(event.currentTarget.value);
              }}
            />
            <button type="submit" disabled={noteBusy || noteText.trim().length === 0}>
              {noteBusy ? 'Registrando…' : 'Registrar nota'}
            </button>
          </form>
        </>
      ) : null}
    </aside>
  );
};

type EvidenceViewState =
  | Readonly<{ kind: 'closed' }>
  | Readonly<{ kind: 'confirm'; projectId: string; evidenceLocatorId: string }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; excerpt: EvidenceExcerptDto }>
  | Readonly<{ kind: 'error'; message: string }>;

const EvidenceViewer = ({
  view,
  onAuthorize,
  onClose,
  panelRef,
}: Readonly<{
  view: EvidenceViewState;
  onAuthorize(): void;
  onClose(): void;
  panelRef: React.RefObject<HTMLElement | null>;
}>): React.JSX.Element | null => {
  if (view.kind === 'closed') return null;
  return (
    <aside
      className="audit-evidence-viewer"
      role="dialog"
      aria-labelledby="audit-evidence-title"
      aria-busy={view.kind === 'loading'}
      tabIndex={-1}
      ref={panelRef}
    >
      <div className="audit-side-panel-header">
        <h3 id="audit-evidence-title">Evidência</h3>
        <button type="button" className="text-button" onClick={onClose}>
          Fechar
        </button>
      </div>
      {view.kind === 'confirm' ? (
        <>
          <p>
            Abrir este trecho registra o acesso na auditoria. Somente as linhas autorizadas serão
            exibidas.
          </p>
          <button type="button" onClick={onAuthorize}>
            Autorizar abertura
          </button>
        </>
      ) : null}
      {view.kind === 'loading' ? <p role="status">Abrindo evidência…</p> : null}
      {view.kind === 'error' ? (
        <p className="operation-error" role="alert">
          {view.message}
        </p>
      ) : null}
      {view.kind === 'ready' ? (
        <>
          <dl>
            <div>
              <dt>Linhas</dt>
              <dd>
                {view.excerpt.startLine}–{view.excerpt.endLine}
              </dd>
            </div>
            <div>
              <dt>Hash do artefato</dt>
              <dd>{view.excerpt.sourceArtifactSha256}</dd>
            </div>
            <div>
              <dt>Hash do trecho</dt>
              <dd>{view.excerpt.excerptSha256}</dd>
            </div>
          </dl>
          <pre className="audit-evidence-excerpt">{view.excerpt.excerpt}</pre>
        </>
      ) : null}
    </aside>
  );
};

export const AuditPanel = ({ currentProjectId }: AuditPanelProps): React.JSX.Element => {
  const [view, setView] = useState<ViewState>({ kind: 'idle' });
  const [items, setItems] = useState<readonly AuditEventListItemDto[]>([]);
  const [filters, setFilters] = useState<AuditQueryFilters>(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [lawIdText, setLawIdText] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentProjectOnly, setCurrentProjectOnly] = useState(true);
  const [selected, setSelected] = useState<AuditEventDetailDto | null>(null);
  const [timeline, setTimeline] = useState<readonly AuditEventListItemDto[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [incidentView, setIncidentView] = useState<IncidentViewState>({ kind: 'closed' });
  const [incidentNoteText, setIncidentNoteText] = useState('');
  const [incidentNoteBusy, setIncidentNoteBusy] = useState(false);
  const [reprocessView, setReprocessView] = useState<ReprocessViewState>({ kind: 'closed' });
  const [reprocessPlan, setReprocessPlan] = useState<ReprocessingPlanDto>('from_source_snapshot');
  const [reprocessReason, setReprocessReason] = useState('');
  const [evidenceView, setEvidenceView] = useState<EvidenceViewState>({ kind: 'closed' });
  const incidentTriggerRef = useRef<HTMLElement | null>(null);
  const incidentPanelRef = useRef<HTMLElement | null>(null);
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);
  const evidencePanelRef = useRef<HTMLElement | null>(null);
  const deferredItems = useDeferredValue(items);

  const counters = useMemo(() => {
    const result = { info: 0, warn: 0, error: 0 };
    for (const item of deferredItems) result[item.level] += 1;
    return result;
  }, [deferredItems]);

  const runQuery = useCallback(
    async (cursor: string | null, append: boolean) => {
      const api = window.lexDesktop;
      if (api === undefined) return;
      setView({ kind: 'loading' });
      const effectiveFilters: AuditQueryFilters = {
        ...filters,
        projectId: currentProjectOnly ? currentProjectId : null,
        lawId: parseLawId(lawIdText),
        searchText: searchText.trim(),
        fromAt: toStartTimestamp(fromDate),
        toAt: toEndTimestamp(toDate),
      };
      const result = await api.audit.query({ filters: effectiveFilters, cursor, limit: 50 });
      if (!result.ok) {
        setView({ kind: 'error', message: result.error.message });
        return;
      }
      startTransition(() => {
        setItems((current) => (append ? [...current, ...result.value.items] : result.value.items));
        setView({ kind: 'ready', page: result.value });
        if (!append) {
          setSelected(null);
          setTimeline([]);
        }
      });
    },
    [currentProjectId, currentProjectOnly, filters, fromDate, lawIdText, searchText, toDate],
  );

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      void runQuery(null, false);
    }, 0);
    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [runQuery]);

  const selectEvent = useCallback(async (event: AuditEventListItemDto) => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setDetailBusy(true);
    const [detailResult, timelineResult] = await Promise.all([
      api.audit.getDetail({ eventId: event.eventId }),
      api.audit.getTimeline({ correlationId: event.correlationId, cursor: null, limit: 100 }),
    ]);
    if (detailResult.ok) setSelected(detailResult.value);
    if (timelineResult.ok) setTimeline(timelineResult.value.items);
    setDetailBusy(false);
  }, []);

  useEffect(() => {
    if (incidentView.kind !== 'closed') {
      incidentPanelRef.current?.focus();
    }
  }, [incidentView.kind]);

  useEffect(() => {
    if (evidenceView.kind !== 'closed') {
      evidencePanelRef.current?.focus();
    }
  }, [evidenceView.kind]);

  const openIncident = useCallback(async (incidentId: string, trigger: HTMLElement) => {
    incidentTriggerRef.current = trigger;
    setIncidentNoteText('');
    setIncidentView({ kind: 'loading', incidentId });
    const api = window.lexDesktop;
    if (api === undefined) {
      setIncidentView({ kind: 'error', incidentId, message: 'Recurso indisponível.' });
      return;
    }
    const result = await api.audit.getIncidentDetail({ incidentId });
    setIncidentView(
      result.ok
        ? { kind: 'ready', detail: result.value }
        : { kind: 'error', incidentId, message: result.error.message },
    );
  }, []);

  const closeIncident = useCallback(() => {
    setIncidentView({ kind: 'closed' });
    setIncidentNoteText('');
    setReprocessView({ kind: 'closed' });
    incidentTriggerRef.current?.focus();
    incidentTriggerRef.current = null;
  }, []);

  const submitIncidentNote = useCallback(async () => {
    if (incidentView.kind !== 'ready') return;
    const trimmed = incidentNoteText.trim();
    if (trimmed.length === 0) return;
    const api = window.lexDesktop;
    if (api === undefined) return;
    const { incidentId } = incidentView.detail;
    setIncidentNoteBusy(true);
    const result = await api.audit.recordIncidentNote({ incidentId, note: trimmed });
    setIncidentNoteBusy(false);
    setIncidentView(
      result.ok
        ? { kind: 'ready', detail: result.value }
        : { kind: 'error', incidentId, message: result.error.message },
    );
    if (result.ok) setIncidentNoteText('');
  }, [incidentNoteText, incidentView]);

  const openReprocessForm = useCallback((projectId: string) => {
    setReprocessReason('');
    setReprocessPlan('from_source_snapshot');
    setReprocessView({ kind: 'form', projectId });
  }, []);

  const cancelReprocess = useCallback(() => {
    setReprocessView({ kind: 'closed' });
  }, []);

  const submitReprocess = useCallback(async () => {
    if (reprocessView.kind !== 'form') return;
    const { projectId } = reprocessView;
    const reason = reprocessReason.trim();
    if (reason.length === 0) return;
    const api = window.lexDesktop;
    if (api === undefined) return;
    setReprocessView({ kind: 'submitting', projectId });
    const editorial = await api.editorial.getState({ projectId });
    if (!editorial.ok) {
      setReprocessView({ kind: 'error', message: editorial.error.message });
      return;
    }
    const incidentId =
      incidentView.kind === 'ready' && incidentProjectId(incidentView.detail) === projectId
        ? incidentView.detail.incidentId
        : null;
    const result = await api.reprocessing.request({
      projectId,
      requestId: globalThis.crypto.randomUUID(),
      plan: reprocessPlan,
      expectedRevisionHash: editorial.value.revisionHash,
      reason,
      incidentId,
    });
    setReprocessView(
      result.ok
        ? { kind: 'tracking', projectId, state: result.value }
        : { kind: 'error', message: result.error.message },
    );
  }, [incidentView, reprocessPlan, reprocessReason, reprocessView]);

  useEffect(() => {
    if (reprocessView.kind !== 'tracking') return;
    if (REPROCESS_TERMINAL_STATUSES.has(reprocessView.state.status)) return;
    const { projectId } = reprocessView;
    const timeout = globalThis.setTimeout(() => {
      void (async () => {
        const api = window.lexDesktop;
        if (api === undefined) return;
        const result = await api.reprocessing.getState({ projectId });
        if (result.ok && result.value !== null) {
          setReprocessView({ kind: 'tracking', projectId, state: result.value });
          if (
            REPROCESS_TERMINAL_STATUSES.has(result.value.status) &&
            incidentView.kind === 'ready' &&
            incidentProjectId(incidentView.detail) === projectId
          ) {
            const refreshed = await api.audit.getIncidentDetail({
              incidentId: incidentView.detail.incidentId,
            });
            if (refreshed.ok) setIncidentView({ kind: 'ready', detail: refreshed.value });
          }
        }
      })();
    }, 1000);
    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [incidentView, reprocessView]);

  const requestEvidence = useCallback(
    (projectId: string, evidenceLocatorId: string, trigger: HTMLElement) => {
      evidenceTriggerRef.current = trigger;
      setEvidenceView({ kind: 'confirm', projectId, evidenceLocatorId });
    },
    [],
  );

  const closeEvidence = useCallback(() => {
    setEvidenceView({ kind: 'closed' });
    evidenceTriggerRef.current?.focus();
    evidenceTriggerRef.current = null;
  }, []);

  const authorizeEvidence = useCallback(async () => {
    if (evidenceView.kind !== 'confirm') return;
    const { projectId, evidenceLocatorId } = evidenceView;
    setEvidenceView({ kind: 'loading' });
    const api = window.lexDesktop;
    if (api === undefined) {
      setEvidenceView({ kind: 'error', message: 'Recurso indisponível.' });
      return;
    }
    const result = await api.audit.openEvidence({ projectId, evidenceLocatorId });
    setEvidenceView(
      result.ok
        ? { kind: 'ready', excerpt: result.value }
        : { kind: 'error', message: result.error.message },
    );
  }, [evidenceView]);

  const page = view.kind === 'ready' ? view.page : null;
  const unavailableLabel = page?.unavailableOrigins
    .map(({ origin }) => origin.replaceAll('_', ' '))
    .join(', ');

  return (
    <section className="panel audit-panel" id="auditoria" aria-labelledby="audit-title">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h2 id="audit-title">Logs e diagnóstico</h2>
        </div>
        <span className="panel-step">AUDIT</span>
      </header>
      <div className="panel-content">
        <form
          className="audit-filters"
          aria-label="Filtros da auditoria operacional"
          onSubmit={(event) => {
            event.preventDefault();
            void runQuery(null, false);
          }}
        >
          <label>
            Código ou mensagem
            <input
              type="search"
              value={searchText}
              maxLength={80}
              onChange={(event) => {
                setSearchText(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            Lei (ID)
            <input
              type="text"
              value={lawIdText}
              placeholder="00000000-0000-0000-0000-000000000000"
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              title="Informe o identificador (UUID) da lei."
              onChange={(event) => {
                setLawIdText(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            Módulo
            <select
              value={filters.module ?? ''}
              onChange={(event) => {
                const parsed = AuditModuleDtoSchema.safeParse(event.currentTarget.value);
                setFilters((current) => ({
                  ...current,
                  module: parsed.success ? parsed.data : null,
                }));
              }}
            >
              <option value="">Todos</option>
              {AuditModuleDtoSchema.options.map((module) => (
                <option value={module} key={module}>
                  {module.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nível
            <select
              value={filters.level ?? ''}
              onChange={(event) => {
                const parsed = AuditLevelDtoSchema.safeParse(event.currentTarget.value);
                setFilters((current) => ({
                  ...current,
                  level: parsed.success ? parsed.data : null,
                }));
              }}
            >
              <option value="">Todos</option>
              {AuditLevelDtoSchema.options.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <select
              value={filters.category ?? ''}
              onChange={(event) => {
                const parsed = AuditCategoryDtoSchema.safeParse(event.currentTarget.value);
                setFilters((current) => ({
                  ...current,
                  category: parsed.success ? parsed.data : null,
                }));
              }}
            >
              <option value="">Todas</option>
              {AuditCategoryDtoSchema.options.map((category) => (
                <option value={category} key={category}>
                  {category.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Início
            <input
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            Fim
            <input
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.currentTarget.value);
              }}
            />
          </label>
          <label className="audit-project-scope">
            <input
              type="checkbox"
              checked={currentProjectOnly}
              disabled={currentProjectId === null}
              onChange={(event) => {
                setCurrentProjectOnly(event.currentTarget.checked);
              }}
            />
            Somente o projeto aberto
          </label>
          <button type="submit">Pesquisar eventos</button>
        </form>

        <div className="audit-counters" aria-label="Contadores da página">
          <span>{String(counters.info)} informativos</span>
          <span>{String(counters.warn)} avisos</span>
          <span>{String(counters.error)} erros</span>
        </div>

        {currentProjectId !== null ? (
          <div className="audit-reprocess-trigger">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                openReprocessForm(currentProjectId);
              }}
            >
              Reprocessar projeto aberto
            </button>
          </div>
        ) : null}
        <ReprocessSection
          view={reprocessView}
          plan={reprocessPlan}
          reason={reprocessReason}
          onPlanChange={setReprocessPlan}
          onReasonChange={setReprocessReason}
          onSubmit={() => {
            void submitReprocess();
          }}
          onCancel={cancelReprocess}
        />

        {page !== null && page.completeness !== 'complete' ? (
          <p className="audit-completeness" role="status">
            Consulta {page.completeness === 'local_only' ? 'somente local' : 'parcial'}. Origens
            indisponíveis: {unavailableLabel}.
          </p>
        ) : null}
        {view.kind === 'loading' ? <p role="status">Consultando auditoria…</p> : null}
        {view.kind === 'error' ? (
          <p className="operation-error" role="alert">
            {view.message}
          </p>
        ) : null}
        {view.kind !== 'loading' && deferredItems.length === 0 ? (
          <p className="audit-empty">Nenhum evento corresponde aos filtros.</p>
        ) : null}

        <div className="audit-results-layout">
          <div>
            <EventList
              items={deferredItems}
              selectedEventId={selected?.event.eventId ?? null}
              onSelect={(event) => {
                void selectEvent(event);
              }}
            />
            {page?.nextCursor !== null && page?.nextCursor !== undefined ? (
              <button
                className="load-more"
                type="button"
                onClick={() => {
                  void runQuery(page.nextCursor, true);
                }}
              >
                Carregar página seguinte
              </button>
            ) : null}
          </div>
          <EventDetail
            detail={selected}
            timeline={timeline}
            busy={detailBusy}
            onOpenIncident={(incidentId, trigger) => {
              void openIncident(incidentId, trigger);
            }}
            onOpenEvidence={(projectId, evidenceLocatorId, trigger) => {
              requestEvidence(projectId, evidenceLocatorId, trigger);
            }}
          />
        </div>

        <IncidentPanel
          view={incidentView}
          noteText={incidentNoteText}
          noteBusy={incidentNoteBusy}
          onNoteChange={setIncidentNoteText}
          onSubmitNote={() => {
            void submitIncidentNote();
          }}
          onClose={closeIncident}
          panelRef={incidentPanelRef}
          onOpenReprocess={openReprocessForm}
        />
        <EvidenceViewer
          view={evidenceView}
          onAuthorize={() => {
            void authorizeEvidence();
          }}
          onClose={closeEvidence}
          panelRef={evidencePanelRef}
        />
      </div>
    </section>
  );
};
