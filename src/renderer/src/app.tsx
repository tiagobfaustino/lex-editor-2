import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import type {
  BatchExportFailureCode,
  BatchExportResultDto,
  ContentProjectionProfileDto,
  DiagnosticDto,
  PreviewDocumentDto,
  PreviewNodeDto,
  PreviewPageDto,
  ProgressDto,
  SourceSummaryDto,
} from '../../shared/ipc/import.js';
import type {
  EditorialDiagnosticDto,
  EditorialReviewTargetDto,
  EditorialStateDto,
} from '../../shared/ipc/editorial.js';
import type { IpcResult } from '../../shared/ipc/desktop-api.js';
import type {
  MetadataStateDto,
  UpdateMetadataCommand,
  UpdateMetadataResult,
} from '../../shared/ipc/metadata.js';
import { MetadataPanel } from './features/metadata/metadata-panel.js';
import { PublicationPanel } from './features/publication/publication-panel.js';
import { LegalReferenceText } from './features/preview/legal-reference-link.js';
import { SourcesPanel } from './features/sources/sources-panel.js';
import { UpdatesPanel } from './features/updates/updates-panel.js';
import { AuditPanel } from './features/audit/audit-panel.js';

type DesktopIntegrationState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; version: string }>
  | Readonly<{ kind: 'unavailable' }>;

type BatchProjectSummary = Readonly<{
  projectId: string;
  title: string;
  sigla: string;
  canExport: boolean;
}>;

type ReferenceNavigationOrigin = Readonly<{
  projectId: string;
  previewNodeId: string;
  originElementId: string;
}>;

const ROOT_PAGE = 'root';

const BATCH_EXPORT_FAILURE_LABELS: Readonly<Record<BatchExportFailureCode, string>> = Object.freeze(
  {
    NOT_READY: 'projeto ainda não processado',
    NOT_APPROVED: 'revisão ainda não aprovada',
    DUPLICATE_TARGET: 'duas leis apontam para a mesma pasta',
    TARGET_CONFLICT: 'a pasta de destino já existe',
    FILESYSTEM_FAILED: 'não foi possível gravar os arquivos',
  },
);

const navigationItems = [
  { label: 'Importação', detail: 'Nova fonte', href: '#importacao' },
  { label: 'Preview e edição', detail: 'Revisão jurídica', href: '#preview' },
  { label: 'Metadados', detail: 'Frontmatter validado', href: '#metadados' },
  { label: 'Publicação', detail: 'Release seguro', href: '#publicacao' },
  {
    label: 'Fila de atualizações',
    detail: 'Revisão legislativa',
    href: '#atualizacoes',
  },
  {
    label: 'Configuração de fontes',
    detail: 'Origens oficiais',
    href: '#fontes',
  },
  { label: 'Logs e diagnóstico', detail: 'Auditoria operacional', href: '#auditoria' },
] as const;

const Navigation = ({ hasDocument }: { hasDocument: boolean }): React.JSX.Element => (
  <nav className="primary-navigation" aria-label="Navegação principal">
    <p className="navigation-label">Espaço de trabalho</p>
    <ul className="navigation-list">
      {navigationItems.map((item, index) => (
        <li key={item.label}>
          <a
            className={`navigation-item${index === (hasDocument ? 1 : 0) ? ' is-current' : ''}`}
            href={item.href}
          >
            <span className="navigation-index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
);

type ImportPanelProps = Readonly<{
  source: SourceSummaryDto | null;
  progress: ProgressDto | null;
  error: string | null;
  onSelect(): void;
  onImportUrl(url: string): void;
  onCancel(): void;
}>;

const ImportPanel = ({
  source,
  progress,
  error,
  onSelect,
  onImportUrl,
  onCancel,
}: ImportPanelProps): React.JSX.Element => {
  const [url, setUrl] = useState('');
  const running = progress?.jobStatus === 'queued' || progress?.jobStatus === 'running';
  const percent =
    progress?.totalUnits === null || progress?.totalUnits === undefined
      ? null
      : Math.round((progress.completedUnits / progress.totalUnits) * 100);

  return (
    <section className="panel import-panel" id="importacao" aria-labelledby="importacao-title">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Entrada</p>
          <h2 id="importacao-title">Importação</h2>
        </div>
        <span className="panel-step" aria-label="Etapa 1 de 3">
          01
        </span>
      </header>
      <div className="panel-content">
        <p className="panel-description">
          Importe uma página oficial do Planalto ou selecione um snapshot HTML ou Markdown. Cada
          artefato original é preservado antes do processamento.
        </p>
        <fieldset className="source-form">
          <legend className="visually-hidden">Fonte da importação</legend>
          <label htmlFor="source-url">URL da fonte oficial</label>
          <form
            className="field-row"
            onSubmit={(event) => {
              event.preventDefault();
              onImportUrl(url);
            }}
          >
            <input
              id="source-url"
              type="url"
              value={url}
              placeholder="https://www.planalto.gov.br/..."
              required
              disabled={running}
              onChange={(event) => {
                setUrl(event.currentTarget.value);
              }}
            />
            <button type="submit" disabled={running || url.trim().length === 0}>
              Importar URL
            </button>
          </form>
          <div className="separator">
            <span>ou</span>
          </div>
          <button className="secondary-button" type="button" onClick={onSelect} disabled={running}>
            Selecionar arquivo local
          </button>
        </fieldset>
        {source !== null && (
          <p className="selected-source">
            <strong>{source.displayName}</strong>
            <span>
              {source.mediaType === 'text/html' ? 'HTML' : 'Markdown'} ·{' '}
              {source.byteLength.toLocaleString('pt-BR')} bytes
            </span>
          </p>
        )}
        {progress !== null && (
          <div className="pipeline-progress" aria-live="polite">
            <div>
              <strong>{progress.message}</strong>
              <span>{percent === null ? 'Em andamento' : `${String(percent)}%`}</span>
            </div>
            <progress max={progress.totalUnits ?? undefined} value={progress.completedUnits} />
            {running && (
              <button type="button" className="text-button" onClick={onCancel}>
                Cancelar processamento
              </button>
            )}
          </div>
        )}
        {error !== null && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
};

type TreeNodeProps = Readonly<{
  projectId: string;
  node: PreviewNodeDto;
  pages: ReadonlyMap<string, PreviewPageDto>;
  selectedId: string | null;
  onToggle(node: PreviewNodeDto): void;
  onLoadMore(parentId: string, cursor: string): void;
  onNavigateReference(
    referenceId: string,
    originPreviewNodeId: string,
    originElementId: string,
  ): void;
}>;

const TreeNode = ({
  projectId,
  node,
  pages,
  selectedId,
  onToggle,
  onLoadMore,
  onNavigateReference,
}: TreeNodeProps): React.JSX.Element => {
  const page = pages.get(node.previewNodeId);
  const expanded = page !== undefined;
  return (
    <li className="preview-tree-item">
      <article
        id={`preview-${node.previewNodeId}`}
        className={`preview-node status-${node.deviceStatus ?? 'unknown'}${selectedId === node.previewNodeId ? ' is-selected' : ''}`}
      >
        <div className="preview-node-heading">
          {node.hasChildren ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${node.label}`}
              onClick={() => {
                onToggle(node);
              }}
            >
              {expanded ? '−' : '+'}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <strong>{node.label}</strong>
          {node.deviceStatus !== null && node.deviceStatus !== 'active' && (
            <small>{node.deviceStatus}</small>
          )}
        </div>
        {node.plainText.length > 0 && (
          <p>
            <LegalReferenceText
              projectId={projectId}
              node={node}
              onNavigate={onNavigateReference}
            />
          </p>
        )}
        {node.histories.map((history, index) => (
          <p className="preview-history" key={`${history.plainText}-${String(index)}`}>
            <s>{history.plainText}</s>
            {history.note === null ? '' : ` — ${history.note}`}
          </p>
        ))}
        {node.blockId !== null && <code>^{node.blockId}</code>}
      </article>
      {page !== undefined && (
        <ul className="preview-tree">
          {page.items.map((child) => (
            <TreeNode
              key={child.previewNodeId}
              projectId={projectId}
              node={child}
              pages={pages}
              selectedId={selectedId}
              onToggle={onToggle}
              onLoadMore={onLoadMore}
              onNavigateReference={onNavigateReference}
            />
          ))}
          {page.nextCursor !== null && (
            <li>
              <button
                className="load-more"
                type="button"
                onClick={() => {
                  onLoadMore(node.previewNodeId, page.nextCursor ?? '');
                }}
              >
                Carregar mais ({String(page.totalItems - page.items.length)})
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
};

type PreviewPanelProps = Readonly<{
  document: PreviewDocumentDto | null;
  pages: ReadonlyMap<string, PreviewPageDto>;
  selectedId: string | null;
  exportMessage: string | null;
  batchExportReport: BatchExportResultDto | null;
  canExport: boolean;
  projectionBusy: boolean;
  batchProjectCount: number;
  canReturnToReference: boolean;
  onToggle(node: PreviewNodeDto): void;
  onLoadMore(parentId: string | null, cursor: string): void;
  onProjectionChange(profile: ContentProjectionProfileDto): void;
  onExport(): void;
  onExportBatch(): void;
  onNavigateReference(
    referenceId: string,
    originPreviewNodeId: string,
    originElementId: string,
  ): void;
  onReturnToReference(): void;
}>;

const PreviewPanel = ({
  document,
  pages,
  selectedId,
  exportMessage,
  batchExportReport,
  canExport,
  projectionBusy,
  batchProjectCount,
  canReturnToReference,
  onToggle,
  onLoadMore,
  onProjectionChange,
  onExport,
  onExportBatch,
  onNavigateReference,
  onReturnToReference,
}: PreviewPanelProps): React.JSX.Element => {
  const root = pages.get(ROOT_PAGE);
  return (
    <section className="panel preview-panel" id="preview" aria-labelledby="preview-title">
      <header className="panel-header preview-header">
        <div>
          <p className="eyebrow">Documento</p>
          <h2 id="preview-title" tabIndex={-1}>
            Preview
          </h2>
        </div>
        <div className="document-state">
          <span className="state-dot" aria-hidden="true" />
          {document === null
            ? 'Nenhuma lei carregada'
            : `${document.sigla} · ${String(document.totalArticles)} artigos`}
        </div>
      </header>
      {document === null ? (
        <div className="preview-empty">
          <div className="document-glyph" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="empty-kicker">Área de revisão</p>
          <h3>O documento aparecerá aqui</h3>
          <p>Importe um arquivo local para revisar hierarquia, metadados e diagnósticos.</p>
          <a href="#importacao">Ir para Importação</a>
        </div>
      ) : (
        <div className="preview-document">
          <div className="document-summary">
            <div>
              <p className="empty-kicker">{document.legalStatus}</p>
              <h3>{document.title}</h3>
              <p>{String(document.totalPreviewNodes)} nós no preview sanitizado</p>
            </div>
            <div className="export-actions">
              {canReturnToReference && (
                <button className="secondary-button" type="button" onClick={onReturnToReference}>
                  Voltar à referência
                </button>
              )}
              <button
                type="button"
                onClick={onExport}
                disabled={!canExport}
                title={
                  canExport
                    ? 'Exportar revisão aprovada'
                    : 'Valide e aprove a revisão para exportar'
                }
              >
                Exportar Markdown
              </button>
              <button
                type="button"
                onClick={onExportBatch}
                disabled={batchProjectCount < 2}
                title="Exportar leis processadas nesta sessão com relatório independente"
              >
                Exportar lote ({String(batchProjectCount)})
              </button>
            </div>
          </div>
          <fieldset className="projection-picker" disabled={projectionBusy}>
            <legend>Conteúdo do preview e da exportação</legend>
            <label>
              <input
                type="radio"
                name="projection-profile"
                value="complete_with_history"
                checked={document.projectionProfile === 'complete_with_history'}
                onChange={() => {
                  onProjectionChange('complete_with_history');
                }}
              />
              <span>
                <strong>Lei completa</strong>
                <small>Inclui redações anteriores e dispositivos sem eficácia.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="projection-profile"
                value="current_only"
                checked={document.projectionProfile === 'current_only'}
                onChange={() => {
                  onProjectionChange('current_only');
                }}
              />
              <span>
                <strong>Somente texto vigente</strong>
                <small>Omite histórico e subárvores revogadas, vetadas ou suspensas.</small>
              </span>
            </label>
            <p>
              A publicação canônica permanece completa; esta preferência não cria revisão jurídica.
            </p>
          </fieldset>
          <dl className="metadata-grid">
            {document.metadata.map((entry) => (
              <div key={entry.key}>
                <dt>{entry.key.replaceAll('_', ' ')}</dt>
                <dd>{Array.isArray(entry.value) ? entry.value.join(', ') : String(entry.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="callout-list">
            {document.callouts.map((callout, index) => (
              <aside
                className={`callout callout-${callout.calloutKind}`}
                key={`${callout.title}-${String(index)}`}
              >
                <strong>{callout.title}</strong>
                <p>{callout.plainText}</p>
              </aside>
            ))}
          </div>
          <ul className="preview-tree">
            {root?.items.map((node) => (
              <TreeNode
                key={node.previewNodeId}
                projectId={document.projectId}
                node={node}
                pages={pages}
                selectedId={selectedId}
                onToggle={onToggle}
                onLoadMore={(parentId, cursor) => {
                  onLoadMore(parentId, cursor);
                }}
                onNavigateReference={onNavigateReference}
              />
            ))}
          </ul>
          {root?.nextCursor !== null && root?.nextCursor !== undefined && (
            <button
              className="load-more"
              type="button"
              onClick={() => {
                onLoadMore(null, root.nextCursor ?? '');
              }}
            >
              Carregar mais dispositivos
            </button>
          )}
          {exportMessage !== null && (
            <p className="export-message" role="status">
              {exportMessage}
            </p>
          )}
          {batchExportReport !== null && (
            <section className="batch-export-report" aria-label="Relatório da exportação em lote">
              <strong>Resultado por lei</strong>
              <ul>
                {batchExportReport.results.map((result) => (
                  <li key={result.projectId}>
                    <span>
                      {result.sigla} — {result.title}
                    </span>
                    <strong>
                      {result.batchExportStatus === 'succeeded'
                        ? 'Exportada'
                        : `Falha: ${BATCH_EXPORT_FAILURE_LABELS[result.errorCode]}`}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
};

type EditorialSaveState = 'idle' | 'saving' | 'saved' | 'error';

type EditorialCorrectionFormProps = Readonly<{
  target: EditorialReviewTargetDto;
  busy: boolean;
  onCorrect(target: EditorialReviewTargetDto, value: string, reason: string): void;
  onConfirm(target: EditorialReviewTargetDto, reason: string): void;
}>;

const EditorialCorrectionForm = ({
  target,
  busy,
  onCorrect,
  onConfirm,
}: EditorialCorrectionFormProps): React.JSX.Element => {
  const [value, setValue] = useState(target.plainText);
  const [reason, setReason] = useState('');
  const reasonReady = reason.trim().length >= 2;
  return (
    <form
      className="editorial-correction"
      onSubmit={(event) => {
        event.preventDefault();
        onCorrect(target, value, reason);
      }}
    >
      <div className="editorial-correction-heading">
        <div>
          <strong>{target.label}</strong>
          <small>
            {target.nodeKind.replaceAll('_', ' ')} · confiança {target.confidence}
          </small>
        </div>
        <span className="review-badge">Revisão obrigatória</span>
      </div>
      <p className="confidence-reasons">
        Motivos:{' '}
        {target.confidenceReasons.map((reasonCode) => reasonCode.replaceAll('_', ' ')).join(', ')}
      </p>
      <label htmlFor={`editorial-text-${target.previewNodeId}`}>Interpretação textual atual</label>
      <textarea
        id={`editorial-text-${target.previewNodeId}`}
        value={value}
        rows={5}
        disabled={busy}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
      />
      <label htmlFor={`editorial-reason-${target.previewNodeId}`}>Motivo editorial</label>
      <textarea
        id={`editorial-reason-${target.previewNodeId}`}
        value={reason}
        rows={3}
        required
        disabled={busy}
        placeholder="Registre como a interpretação foi conferida na fonte oficial."
        onChange={(event) => {
          setReason(event.currentTarget.value);
        }}
      />
      <div className="editorial-actions">
        <button type="submit" disabled={busy || !reasonReady || value.trim().length === 0}>
          Salvar correção
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy || !reasonReady}
          onClick={() => {
            onConfirm(target, reason);
          }}
        >
          Confirmar interpretação
        </button>
      </div>
    </form>
  );
};

type ValidationPanelProps = Readonly<{
  diagnostics: readonly DiagnosticDto[];
  editorial: EditorialStateDto | null;
  saveState: EditorialSaveState;
  onSelect(diagnostic: DiagnosticDto | EditorialDiagnosticDto): void;
  onValidate(): void;
  onApprove(): void;
  onConfirmWarning(diagnostic: EditorialDiagnosticDto): void;
  onCorrect(target: EditorialReviewTargetDto, value: string, reason: string): void;
  onConfirmInterpretation(target: EditorialReviewTargetDto, reason: string): void;
}>;

const isEditorialDiagnostic = (
  diagnostic: DiagnosticDto | EditorialDiagnosticDto,
): diagnostic is EditorialDiagnosticDto => 'requiresConfirmation' in diagnostic;

const ValidationPanel = ({
  diagnostics,
  editorial,
  saveState,
  onSelect,
  onValidate,
  onApprove,
  onConfirmWarning,
  onCorrect,
  onConfirmInterpretation,
}: ValidationPanelProps): React.JSX.Element => {
  const [expanded, setExpanded] = useState(true);
  const editorialDiagnostics = editorial?.diagnostics ?? [];
  const allDiagnostics = [...editorialDiagnostics, ...diagnostics];
  const counts = {
    error: allDiagnostics.filter((item) => item.severity === 'error').length,
    warning: allDiagnostics.filter((item) => item.severity === 'warning').length,
    info: allDiagnostics.filter((item) => item.severity === 'info').length,
  };
  const busy = saveState === 'saving';
  const saveLabel =
    saveState === 'saving'
      ? 'Salvando…'
      : saveState === 'error'
        ? 'Falha ao salvar'
        : saveState === 'saved'
          ? 'Salvo no diário local'
          : 'Aguardando projeto';
  return (
    <aside
      className={`panel validation-panel${expanded ? '' : ' is-collapsed'}`}
      aria-labelledby="validation-title"
    >
      <header className="panel-header validation-header">
        <div>
          <p className="eyebrow">Diagnóstico</p>
          <h2 id="validation-title">Logs e validação</h2>
        </div>
        <button
          className="collapse-button"
          type="button"
          aria-expanded={expanded}
          aria-controls="validation-content"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span>{expanded ? 'Recolher' : 'Expandir'}</span>
          <span className="chevron" aria-hidden="true">
            {expanded ? '›' : '‹'}
          </span>
        </button>
      </header>
      <div id="validation-content" hidden={!expanded}>
        <div className="editorial-toolbar" aria-live="polite">
          <div>
            <span className={`save-indicator save-${saveState}`} aria-hidden="true" />
            <span>{saveLabel}</span>
          </div>
          <div className="editorial-actions">
            <button type="button" disabled={editorial === null || busy} onClick={onValidate}>
              Validar revisão
            </button>
            <button
              type="button"
              disabled={editorial?.canApprove !== true || busy}
              onClick={onApprove}
            >
              {editorial?.reviewApprovalStatus === 'approved'
                ? 'Preview aprovado'
                : 'Aprovar preview'}
            </button>
          </div>
          {editorial !== null ? (
            <p>
              {editorial.validationIsComplete ? 'Validação completa' : 'Validação incremental'} ·{' '}
              {String(editorial.blockingCount)} bloqueante(s) ·{' '}
              {String(editorial.unconfirmedWarningCount)} aviso(s) a confirmar
            </p>
          ) : null}
          {editorial?.reviewApprovalStatus === 'invalidated' ? (
            <p className="approval-invalidated" role="status">
              A aprovação anterior foi invalidada por uma nova correção.
            </p>
          ) : null}
        </div>
        {editorial?.reviewTargets.map((target) => (
          <EditorialCorrectionForm
            key={target.previewNodeId}
            target={target}
            busy={busy}
            onCorrect={onCorrect}
            onConfirm={onConfirmInterpretation}
          />
        ))}
        {allDiagnostics.length === 0 ? (
          <div className="validation-empty">
            <span className="validation-mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <h3>Nenhum problema encontrado</h3>
              <p>Os diagnósticos do pipeline aparecerão aqui.</p>
            </div>
          </div>
        ) : (
          <ul className="diagnostic-list">
            {allDiagnostics.map((item) => (
              <li key={item.diagnosticId}>
                <button
                  className="diagnostic-main"
                  type="button"
                  disabled={item.previewNodeId === null}
                  onClick={() => {
                    onSelect(item);
                  }}
                >
                  <span className={`severity-dot severity-${item.severity}`} aria-hidden="true" />
                  <span>
                    <strong>{item.code}</strong>
                    <small>{item.message}</small>
                  </span>
                </button>
                {isEditorialDiagnostic(item) && item.requiresConfirmation ? (
                  <button
                    className="confirm-warning"
                    type="button"
                    disabled={item.confirmed || busy}
                    onClick={() => {
                      onConfirmWarning(item);
                    }}
                  >
                    {item.confirmed ? 'Aviso confirmado' : 'Confirmar aviso'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <ul className="severity-legend" aria-label="Severidades dos registros">
          {(['error', 'warning', 'info'] as const).map((severity) => (
            <li key={severity}>
              <span className={`severity-dot severity-${severity}`} aria-hidden="true" />
              {severity === 'error' ? 'Erro' : severity === 'warning' ? 'Aviso' : 'Informação'}
              <span className="severity-count">{String(counts[severity])}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
};

export const App = (): React.JSX.Element => {
  const [desktopIntegration, setDesktopIntegration] = useState<DesktopIntegrationState>(() =>
    window.lexDesktop ? { kind: 'loading' } : { kind: 'unavailable' },
  );
  const [source, setSource] = useState<SourceSummaryDto | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [document, setDocument] = useState<PreviewDocumentDto | null>(null);
  const [pages, setPages] = useState<ReadonlyMap<string, PreviewPageDto>>(() => new Map());
  const [diagnostics, setDiagnostics] = useState<readonly DiagnosticDto[]>([]);
  const [editorial, setEditorial] = useState<EditorialStateDto | null>(null);
  const [metadata, setMetadata] = useState<MetadataStateDto | null>(null);
  const [editorialSaveState, setEditorialSaveState] = useState<EditorialSaveState>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [batchExportReport, setBatchExportReport] = useState<BatchExportResultDto | null>(null);
  const [batchProjects, setBatchProjects] = useState<readonly BatchProjectSummary[]>([]);
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [referenceHistory, setReferenceHistory] = useState<readonly ReferenceNavigationOrigin[]>(
    [],
  );
  const hasValidDocument = useRef(false);
  const pendingReferenceFocus = useRef<string | null>(null);

  useEffect(() => {
    const elementId = pendingReferenceFocus.current;
    if (elementId === null) return;
    const element = globalThis.document.getElementById(elementId);
    if (element === null) return;
    element.focus();
    pendingReferenceFocus.current = null;
  }, [document, pages]);

  const prepareImportAttempt = useCallback(() => {
    setError(null);
    setExportMessage(null);
    setBatchExportReport(null);
    setProgress(null);
  }, []);

  const beginProcessing = useCallback(async (selected: SourceSummaryDto) => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setSource(selected);
    const started = await api.pipeline.start({ sourceId: selected.sourceId });
    if (!started.ok) {
      setError(started.error.message);
      return;
    }
    setJobId(started.value.jobId);
    setProgress({
      jobId: started.value.jobId,
      projectId: started.value.projectId,
      sequence: 0,
      jobStatus: 'queued',
      phase: 'snapshot',
      completedUnits: 0,
      totalUnits: 6,
      message: 'Processamento enfileirado',
    });
  }, []);

  const loadProject = useCallback(async (projectId: string, revealPreviewNodeId?: string) => {
    const api = window.lexDesktop;
    if (api === undefined) return false;
    const [
      documentResult,
      pageResult,
      diagnosticsResult,
      editorialResult,
      metadataResult,
      revealResult,
    ] = await Promise.all([
      api.preview.getDocument({ projectId }),
      api.preview.getPage({ projectId, parentPreviewNodeId: null, cursor: null, limit: 25 }),
      api.diagnostics.getPage({ projectId, cursor: null, limit: 100 }),
      api.editorial.getState({ projectId }),
      api.metadata.getState({ projectId }),
      revealPreviewNodeId === undefined
        ? Promise.resolve(null)
        : api.preview.revealNode({ projectId, previewNodeId: revealPreviewNodeId }),
    ]);
    if (
      !documentResult.ok ||
      !pageResult.ok ||
      !diagnosticsResult.ok ||
      !editorialResult.ok ||
      !metadataResult.ok ||
      (revealPreviewNodeId !== undefined && revealResult?.ok !== true)
    ) {
      setError('O processamento terminou sem um preview disponível. Consulte os diagnósticos.');
      return false;
    }
    const nextPages = new Map<string, PreviewPageDto>([[ROOT_PAGE, pageResult.value]]);
    if (revealResult?.ok === true) {
      for (const item of revealResult.value.items) {
        const key = item.parentPreviewNodeId ?? ROOT_PAGE;
        const page = nextPages.get(key);
        if (page === undefined) {
          nextPages.set(key, { items: [item], nextCursor: null, totalItems: 1 });
        } else if (
          !page.items.some((candidate) => candidate.previewNodeId === item.previewNodeId)
        ) {
          nextPages.set(key, {
            ...page,
            items: [...page.items, item].sort((left, right) => left.order - right.order),
          });
        }
      }
    }
    hasValidDocument.current = true;
    startTransition(() => {
      setDocument(documentResult.value);
      setPages(nextPages);
      setDiagnostics(diagnosticsResult.value.items);
      setEditorial(editorialResult.value);
      setMetadata(metadataResult.value);
      setEditorialSaveState('saved');
      setSelectedId(revealPreviewNodeId ?? null);
      setBatchProjects((current) => {
        const next = current.filter((item) => item.projectId !== projectId);
        next.push({
          projectId,
          title: documentResult.value.title,
          sigla: documentResult.value.sigla,
          canExport: editorialResult.value.canExport,
        });
        return next;
      });
    });
    if (revealPreviewNodeId !== undefined) {
      requestAnimationFrame(() =>
        globalThis.document
          .getElementById(`preview-${revealPreviewNodeId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    }
    return true;
  }, []);

  useEffect(() => {
    let current = true;
    const api = window.lexDesktop;
    if (api !== undefined) {
      void api.app.getVersion().then((result) => {
        if (current)
          setDesktopIntegration(
            result.ok ? { kind: 'ready', version: result.value.version } : { kind: 'unavailable' },
          );
      });
      const dispose = api.pipeline.onProgress((next) => {
        setProgress((previous) =>
          previous === null || next.sequence > previous.sequence ? next : previous,
        );
        if (next.jobStatus === 'completed' && next.projectId !== null) {
          void loadProject(next.projectId);
        }
        if (next.jobStatus === 'failed') {
          setError(next.message);
          if (next.projectId !== null && !hasValidDocument.current)
            void api.diagnostics
              .getPage({ projectId: next.projectId, cursor: null, limit: 100 })
              .then((result) => {
                if (result.ok) setDiagnostics(result.value.items);
              });
        }
      });
      return () => {
        current = false;
        dispose();
      };
    }
    return () => {
      current = false;
    };
  }, [loadProject]);

  const selectLocal = useCallback(async () => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    prepareImportAttempt();
    const selected = await api.source.selectLocal();
    if (!selected.ok) {
      setError(selected.error.message);
      return;
    }
    if (selected.value === null) return;
    await beginProcessing(selected.value);
  }, [beginProcessing, prepareImportAttempt]);

  const importFromUrl = useCallback(
    async (url: string) => {
      const api = window.lexDesktop;
      if (api === undefined) return;
      prepareImportAttempt();
      const imported = await api.source.importFromUrl({ url: url.trim() });
      if (!imported.ok) {
        setError(imported.error.message);
        return;
      }
      await beginProcessing(imported.value);
    },
    [beginProcessing, prepareImportAttempt],
  );

  const cancel = useCallback(() => {
    if (jobId !== null) void window.lexDesktop?.pipeline.cancel({ jobId });
  }, [jobId]);

  const loadPage = useCallback(
    async (parentId: string | null, cursor: string | null = null) => {
      if (document === null || window.lexDesktop === undefined) return;
      const result = await window.lexDesktop.preview.getPage({
        projectId: document.projectId,
        parentPreviewNodeId: parentId,
        cursor,
        limit: 25,
      });
      if (!result.ok) return;
      const key = parentId ?? ROOT_PAGE;
      startTransition(() => {
        setPages((current) => {
          const next = new Map(current);
          const previous = current.get(key);
          next.set(
            key,
            previous === undefined || cursor === null
              ? result.value
              : { ...result.value, items: [...previous.items, ...result.value.items] },
          );
          return next;
        });
      });
    },
    [document],
  );

  const toggleNode = useCallback(
    (node: PreviewNodeDto) => {
      if (pages.has(node.previewNodeId)) {
        setPages((current) => {
          const next = new Map(current);
          next.delete(node.previewNodeId);
          return next;
        });
      } else {
        void loadPage(node.previewNodeId);
      }
    },
    [loadPage, pages],
  );

  const selectDiagnostic = useCallback(
    async (diagnostic: DiagnosticDto | EditorialDiagnosticDto) => {
      if (document === null || diagnostic.previewNodeId === null || window.lexDesktop === undefined)
        return;
      const result = await window.lexDesktop.preview.revealNode({
        projectId: document.projectId,
        previewNodeId: diagnostic.previewNodeId,
      });
      if (!result.ok) return;
      setPages((current) => {
        const next = new Map(current);
        for (const item of result.value.items) {
          const key = item.parentPreviewNodeId ?? ROOT_PAGE;
          const page = next.get(key);
          if (page === undefined) next.set(key, { items: [item], nextCursor: null, totalItems: 1 });
          else if (!page.items.some((candidate) => candidate.previewNodeId === item.previewNodeId))
            next.set(key, {
              ...page,
              items: [...page.items, item].sort((a, b) => a.order - b.order),
            });
        }
        return next;
      });
      setSelectedId(diagnostic.previewNodeId);
      requestAnimationFrame(() =>
        globalThis.document
          .getElementById(`preview-${diagnostic.previewNodeId ?? ''}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    },
    [document],
  );

  const navigateLegalReference = useCallback(
    async (referenceId: string, originPreviewNodeId: string, originElementId: string) => {
      const api = window.lexDesktop;
      if (api === undefined || document === null) return;
      setError(null);
      const destination = await api.preview.navigateLegalReference({
        projectId: document.projectId,
        referenceId,
      });
      if (!destination.ok) {
        setError(destination.error.message);
        return;
      }
      const loaded = await loadProject(
        destination.value.targetProjectId,
        destination.value.targetPreviewNodeId,
      );
      if (!loaded) return;
      setReferenceHistory((current) => [
        ...current,
        {
          projectId: document.projectId,
          previewNodeId: originPreviewNodeId,
          originElementId,
        },
      ]);
    },
    [document, loadProject],
  );

  const returnToLegalReference = useCallback(async () => {
    const origin = referenceHistory.at(-1);
    if (origin === undefined) return;
    pendingReferenceFocus.current = origin.originElementId;
    const loaded = await loadProject(origin.projectId, origin.previewNodeId);
    if (!loaded) {
      pendingReferenceFocus.current = null;
      return;
    }
    setReferenceHistory((current) => current.slice(0, -1));
  }, [loadProject, referenceHistory]);

  const runEditorialAction = useCallback(
    async (
      action: () => Promise<IpcResult<EditorialStateDto>>,
      refreshPreview: boolean,
    ): Promise<void> => {
      setError(null);
      setEditorialSaveState('saving');
      const result = await action();
      if (!result.ok) {
        setEditorialSaveState('error');
        setError(result.error.message);
        return;
      }
      setEditorial(result.value);
      setBatchProjects((current) =>
        current.map((item) =>
          item.projectId === result.value.projectId
            ? { ...item, canExport: result.value.canExport }
            : item,
        ),
      );
      setEditorialSaveState('saved');
      if (refreshPreview) await loadProject(result.value.projectId);
    },
    [loadProject],
  );

  const validateEditorial = useCallback(() => {
    const api = window.lexDesktop;
    if (document === null || api === undefined) return;
    void runEditorialAction(() => api.editorial.validate({ projectId: document.projectId }), false);
  }, [document, runEditorialAction]);

  const approveEditorial = useCallback(() => {
    const api = window.lexDesktop;
    if (document === null || api === undefined) return;
    void runEditorialAction(() => api.editorial.approve({ projectId: document.projectId }), false);
  }, [document, runEditorialAction]);

  const correctEditorialText = useCallback(
    (target: EditorialReviewTargetDto, value: string, reason: string) => {
      const api = window.lexDesktop;
      if (document === null || api === undefined) return;
      void runEditorialAction(
        () =>
          api.editorial.correctText({
            projectId: document.projectId,
            previewNodeId: target.previewNodeId,
            value,
            reason,
          }),
        true,
      );
    },
    [document, runEditorialAction],
  );

  const confirmEditorialInterpretation = useCallback(
    (target: EditorialReviewTargetDto, reason: string) => {
      const api = window.lexDesktop;
      if (document === null || api === undefined) return;
      void runEditorialAction(
        () =>
          api.editorial.confirmInterpretation({
            projectId: document.projectId,
            previewNodeId: target.previewNodeId,
            reason,
          }),
        true,
      );
    },
    [document, runEditorialAction],
  );

  const confirmEditorialWarning = useCallback(
    (diagnostic: EditorialDiagnosticDto) => {
      const api = window.lexDesktop;
      if (document === null || api === undefined) return;
      void runEditorialAction(
        () =>
          api.editorial.confirmWarning({
            projectId: document.projectId,
            diagnosticId: diagnostic.diagnosticId,
          }),
        false,
      );
    },
    [document, runEditorialAction],
  );

  const saveMetadata = useCallback(
    async (command: UpdateMetadataCommand): Promise<UpdateMetadataResult> => {
      const api = window.lexDesktop;
      if (api === undefined) {
        return {
          ok: false,
          error: {
            code: 'FAILED',
            message: 'A integração desktop não está disponível.',
            retryable: true,
          },
        };
      }
      const result = await api.metadata.update(command);
      if (!result.ok) return result;
      setMetadata(result.value);
      await loadProject(result.value.projectId);
      return result;
    },
    [loadProject],
  );

  const reloadMetadata = useCallback(async (): Promise<MetadataStateDto | null> => {
    const api = window.lexDesktop;
    if (api === undefined || document === null) return null;
    const result = await api.metadata.getState({ projectId: document.projectId });
    if (!result.ok) return null;
    setMetadata(result.value);
    return result.value;
  }, [document]);

  const exportMarkdown = useCallback(async () => {
    if (document === null || window.lexDesktop === undefined) return;
    setExportMessage(null);
    setBatchExportReport(null);
    const destination = await window.lexDesktop.export.chooseDestination({
      projectId: document.projectId,
      projectionProfile: document.projectionProfile,
    });
    if (!destination.ok || destination.value === null) return;
    const written = await window.lexDesktop.export.write({
      projectId: document.projectId,
      destinationId: destination.value.destinationId,
    });
    setExportMessage(
      written.ok
        ? `${written.value.fileName} exportado no perfil ${written.value.projectionProfile === 'current_only' ? 'somente vigente' : 'lei completa'}, com integridade verificada.`
        : written.error.message,
    );
  }, [document]);

  const changeProjection = useCallback(
    async (projectionProfile: ContentProjectionProfileDto) => {
      const api = window.lexDesktop;
      if (
        api === undefined ||
        document === null ||
        projectionBusy ||
        document.projectionProfile === projectionProfile
      ) {
        return;
      }
      setProjectionBusy(true);
      setError(null);
      const result = await api.preview.setProjectionProfile({
        projectId: document.projectId,
        projectionProfile,
      });
      if (!result.ok) {
        setError(result.error.message);
        setProjectionBusy(false);
        return;
      }
      await loadProject(document.projectId);
      setProjectionBusy(false);
    },
    [document, loadProject, projectionBusy],
  );

  const exportBatch = useCallback(async () => {
    const api = window.lexDesktop;
    if (api === undefined || batchProjects.length < 2) return;
    setExportMessage(null);
    setBatchExportReport(null);
    const destination = await api.export.chooseBatchDestination({
      projectIds: batchProjects.map((project) => project.projectId),
    });
    if (!destination.ok || destination.value === null) return;
    const written = await api.export.writeBatch({
      destinationId: destination.value.destinationId,
    });
    if (!written.ok) {
      setExportMessage(written.error.message);
      return;
    }
    setBatchExportReport(written.value);
    setExportMessage(
      `${String(written.value.succeeded)} lei(s) exportada(s); ${String(written.value.failed)} falha(s).`,
    );
  }, [batchProjects]);

  const integrationLabel =
    desktopIntegration.kind === 'ready'
      ? `Lex Editor ${desktopIntegration.version}`
      : desktopIntegration.kind === 'loading'
        ? 'Verificando aplicativo'
        : 'Integração indisponível';
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo-principal">
        Pular para o conteúdo
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <div>
            <strong>Lex Editor</strong>
            <span>Vinculex</span>
          </div>
        </div>
        <Navigation hasDocument={document !== null} />
        <div className="sidebar-footer">
          <span
            className={`integration-dot${desktopIntegration.kind === 'unavailable' ? ' is-unavailable' : ''}`}
            aria-hidden="true"
          />
          <span>
            <small>Ambiente local</small>
            <strong>{integrationLabel}</strong>
          </span>
        </div>
      </aside>
      <div className="application">
        <header className="topbar">
          <div>
            <p className="eyebrow">Área editorial</p>
            <h1>Preparação de conteúdo legislativo</h1>
          </div>
          <div className="topbar-meta" aria-label="Contexto atual">
            <span>Workspace local</span>
            <strong>{source?.displayName ?? 'Nova importação'}</strong>
          </div>
        </header>
        <main className="workspace" id="conteudo-principal">
          <ImportPanel
            source={source}
            progress={progress}
            error={error}
            onSelect={() => void selectLocal()}
            onImportUrl={(url) => void importFromUrl(url)}
            onCancel={cancel}
          />
          <PreviewPanel
            document={document}
            pages={pages}
            selectedId={selectedId}
            exportMessage={exportMessage}
            batchExportReport={batchExportReport}
            canExport={editorial?.canExport === true}
            projectionBusy={projectionBusy}
            batchProjectCount={batchProjects.length}
            canReturnToReference={referenceHistory.length > 0}
            onToggle={toggleNode}
            onLoadMore={(parent, cursor) => void loadPage(parent, cursor)}
            onProjectionChange={(profile) => void changeProjection(profile)}
            onExport={() => void exportMarkdown()}
            onExportBatch={() => void exportBatch()}
            onNavigateReference={(referenceId, originPreviewNodeId, originElementId) =>
              void navigateLegalReference(referenceId, originPreviewNodeId, originElementId)
            }
            onReturnToReference={() => void returnToLegalReference()}
          />
          <MetadataPanel state={metadata} onSave={saveMetadata} onReload={reloadMetadata} />
          <PublicationPanel
            key={document?.projectId ?? 'no-project'}
            projectId={document?.projectId ?? null}
            lawTitle={document?.title ?? null}
            sigla={document?.sigla ?? null}
            deviceCount={document?.totalPreviewNodes ?? 0}
            canPublish={editorial?.canExport === true}
          />
          <UpdatesPanel />
          <SourcesPanel />
          <AuditPanel currentProjectId={document?.projectId ?? null} />
          <ValidationPanel
            diagnostics={diagnostics}
            editorial={editorial}
            saveState={editorialSaveState}
            onSelect={(diagnostic) => void selectDiagnostic(diagnostic)}
            onValidate={validateEditorial}
            onApprove={approveEditorial}
            onConfirmWarning={confirmEditorialWarning}
            onCorrect={correctEditorialText}
            onConfirmInterpretation={confirmEditorialInterpretation}
          />
        </main>
      </div>
    </div>
  );
};
