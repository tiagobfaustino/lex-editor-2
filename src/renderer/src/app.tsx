import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import type {
  DiagnosticDto,
  PreviewDocumentDto,
  PreviewNodeDto,
  PreviewPageDto,
  ProgressDto,
  SourceSummaryDto,
} from '../../shared/ipc/import.js';

type DesktopIntegrationState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; version: string }>
  | Readonly<{ kind: 'unavailable' }>;

const ROOT_PAGE = 'root';

const navigationItems = [
  { label: 'Importação', detail: 'Nova fonte', href: '#importacao', available: true },
  { label: 'Preview e edição', detail: 'Revisão jurídica', href: '#preview', available: true },
  { label: 'Fila de atualizações', detail: 'Em breve', available: false },
  { label: 'Configuração de fontes', detail: 'Em breve', available: false },
] as const;

const Navigation = ({ hasDocument }: { hasDocument: boolean }): React.JSX.Element => (
  <nav className="primary-navigation" aria-label="Navegação principal">
    <p className="navigation-label">Espaço de trabalho</p>
    <ul className="navigation-list">
      {navigationItems.map((item, index) => (
        <li key={item.label}>
          {item.available ? (
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
          ) : (
            <span className="navigation-item is-disabled" aria-disabled="true">
              <span className="navigation-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </span>
          )}
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
  node: PreviewNodeDto;
  pages: ReadonlyMap<string, PreviewPageDto>;
  selectedId: string | null;
  onToggle(node: PreviewNodeDto): void;
  onLoadMore(parentId: string, cursor: string): void;
}>;

const TreeNode = ({
  node,
  pages,
  selectedId,
  onToggle,
  onLoadMore,
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
        {node.plainText.length > 0 && <p>{node.plainText}</p>}
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
              node={child}
              pages={pages}
              selectedId={selectedId}
              onToggle={onToggle}
              onLoadMore={onLoadMore}
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
  onToggle(node: PreviewNodeDto): void;
  onLoadMore(parentId: string | null, cursor: string): void;
  onExport(): void;
}>;

const PreviewPanel = ({
  document,
  pages,
  selectedId,
  exportMessage,
  onToggle,
  onLoadMore,
  onExport,
}: PreviewPanelProps): React.JSX.Element => {
  const root = pages.get(ROOT_PAGE);
  return (
    <section className="panel preview-panel" id="preview" aria-labelledby="preview-title">
      <header className="panel-header preview-header">
        <div>
          <p className="eyebrow">Documento</p>
          <h2 id="preview-title">Preview</h2>
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
            <button type="button" onClick={onExport}>
              Exportar Markdown
            </button>
          </div>
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
                node={node}
                pages={pages}
                selectedId={selectedId}
                onToggle={onToggle}
                onLoadMore={(parentId, cursor) => {
                  onLoadMore(parentId, cursor);
                }}
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
        </div>
      )}
    </section>
  );
};

const ValidationPanel = ({
  diagnostics,
  onSelect,
}: {
  diagnostics: readonly DiagnosticDto[];
  onSelect: (diagnostic: DiagnosticDto) => void;
}): React.JSX.Element => {
  const [expanded, setExpanded] = useState(true);
  const counts = {
    error: diagnostics.filter((item) => item.severity === 'error').length,
    warning: diagnostics.filter((item) => item.severity === 'warning').length,
    info: diagnostics.filter((item) => item.severity === 'info').length,
  };
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
        {diagnostics.length === 0 ? (
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
            {diagnostics.map((item) => (
              <li key={item.diagnosticId}>
                <button
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const hasValidDocument = useRef(false);

  const prepareImportAttempt = useCallback(() => {
    setError(null);
    setExportMessage(null);
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

  const loadProject = useCallback(async (projectId: string) => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    const [documentResult, pageResult, diagnosticsResult] = await Promise.all([
      api.preview.getDocument({ projectId }),
      api.preview.getPage({ projectId, parentPreviewNodeId: null, cursor: null, limit: 25 }),
      api.diagnostics.getPage({ projectId, cursor: null, limit: 100 }),
    ]);
    if (!documentResult.ok || !pageResult.ok || !diagnosticsResult.ok) {
      setError('O processamento terminou sem um preview disponível. Consulte os diagnósticos.');
      return;
    }
    hasValidDocument.current = true;
    startTransition(() => {
      setDocument(documentResult.value);
      setPages(new Map([[ROOT_PAGE, pageResult.value]]));
      setDiagnostics(diagnosticsResult.value.items);
      setSelectedId(null);
    });
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
    async (diagnostic: DiagnosticDto) => {
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

  const exportMarkdown = useCallback(async () => {
    if (document === null || window.lexDesktop === undefined) return;
    setExportMessage(null);
    const destination = await window.lexDesktop.export.chooseDestination({
      projectId: document.projectId,
    });
    if (!destination.ok || destination.value === null) return;
    const written = await window.lexDesktop.export.write({
      projectId: document.projectId,
      destinationId: destination.value.destinationId,
    });
    setExportMessage(
      written.ok
        ? `${written.value.fileName} exportado com integridade verificada.`
        : written.error.message,
    );
  }, [document]);

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
            onToggle={toggleNode}
            onLoadMore={(parent, cursor) => void loadPage(parent, cursor)}
            onExport={() => void exportMarkdown()}
          />
          <ValidationPanel
            diagnostics={diagnostics}
            onSelect={(diagnostic) => void selectDiagnostic(diagnostic)}
          />
        </main>
      </div>
    </div>
  );
};
