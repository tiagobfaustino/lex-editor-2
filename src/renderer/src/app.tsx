import { useEffect, useState } from 'react';

type DesktopIntegrationState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; version: string }>
  | Readonly<{ kind: 'unavailable' }>;

const navigationItems = [
  { label: 'Importação', detail: 'Nova fonte', href: '#importacao', available: true },
  { label: 'Preview e edição', detail: 'Revisão jurídica', href: '#preview', available: true },
  { label: 'Fila de atualizações', detail: 'Em breve', available: false },
  { label: 'Configuração de fontes', detail: 'Em breve', available: false },
] as const;

const legalStatuses = [
  { label: 'Vigente', token: 'active' },
  { label: 'Revogado', token: 'revoked' },
  { label: 'Vetado', token: 'vetoed' },
  { label: 'Alterado', token: 'amended' },
] as const;

const logSeverities = [
  { label: 'Erro', token: 'error' },
  { label: 'Aviso', token: 'warning' },
  { label: 'Informação', token: 'info' },
] as const;

const Navigation = (): React.JSX.Element => (
  <nav className="primary-navigation" aria-label="Navegação principal">
    <p className="navigation-label">Espaço de trabalho</p>
    <ul className="navigation-list">
      {navigationItems.map((item, index) => (
        <li key={item.label}>
          {item.available ? (
            <a
              className={index === 0 ? 'navigation-item is-current' : 'navigation-item'}
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

const ImportPanel = (): React.JSX.Element => (
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
        Inicie uma nova lei a partir de uma fonte oficial. Os controles serão habilitados na etapa
        de importação.
      </p>

      <fieldset className="source-form" disabled>
        <legend className="visually-hidden">Fonte da importação</legend>
        <label htmlFor="source-url">URL da fonte oficial</label>
        <div className="field-row">
          <input id="source-url" type="url" placeholder="https://..." />
          <button type="button">Importar URL</button>
        </div>
        <div className="separator">
          <span>ou</span>
        </div>
        <button className="secondary-button" type="button">
          Selecionar arquivo local
        </button>
      </fieldset>

      <p className="availability-note">
        <span aria-hidden="true">•</span>
        Importação funcional será entregue na Feature 005
      </p>
    </div>
  </section>
);

const PreviewPanel = (): React.JSX.Element => (
  <section className="panel preview-panel" id="preview" aria-labelledby="preview-title">
    <header className="panel-header preview-header">
      <div>
        <p className="eyebrow">Documento</p>
        <h2 id="preview-title">Preview</h2>
      </div>
      <div className="document-state">
        <span className="state-dot" aria-hidden="true" />
        Nenhuma lei carregada
      </div>
    </header>

    <div className="preview-empty">
      <div className="document-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="empty-kicker">Área de revisão</p>
      <h3>O documento aparecerá aqui</h3>
      <p>
        Depois da importação, esta área concentrará a hierarquia, o conteúdo e os indicadores de
        validação.
      </p>
      <a href="#importacao">Ir para Importação</a>
    </div>

    <footer className="status-legend" aria-label="Legenda de estados jurídicos">
      <span className="legend-title">Estados jurídicos</span>
      <ul>
        {legalStatuses.map((status) => (
          <li key={status.token}>
            <span className={`status-swatch status-${status.token}`} aria-hidden="true" />
            {status.label}
          </li>
        ))}
      </ul>
    </footer>
  </section>
);

const ValidationPanel = (): React.JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      className={isExpanded ? 'panel validation-panel' : 'panel validation-panel is-collapsed'}
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
          aria-expanded={isExpanded}
          aria-controls="validation-content"
          onClick={() => {
            setIsExpanded((currentValue) => !currentValue);
          }}
        >
          <span>{isExpanded ? 'Recolher' : 'Expandir'}</span>
          <span className="chevron" aria-hidden="true">
            {isExpanded ? '›' : '‹'}
          </span>
        </button>
      </header>

      <div id="validation-content" hidden={!isExpanded}>
        <div className="validation-empty">
          <span className="validation-mark" aria-hidden="true">
            ✓
          </span>
          <div>
            <h3>Nenhuma verificação executada</h3>
            <p>Erros, avisos e informações do pipeline serão organizados aqui.</p>
          </div>
        </div>
        <ul className="severity-legend" aria-label="Severidades dos registros">
          {logSeverities.map((severity) => (
            <li key={severity.token}>
              <span className={`severity-dot severity-${severity.token}`} aria-hidden="true" />
              {severity.label}
              <span className="severity-count">0</span>
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

  useEffect(() => {
    let isCurrent = true;
    const desktopApi = window.lexDesktop;

    if (desktopApi) {
      void desktopApi.app.getVersion().then((result) => {
        if (!isCurrent) {
          return;
        }

        setDesktopIntegration(
          result.ok ? { kind: 'ready', version: result.value.version } : { kind: 'unavailable' },
        );
      });
    }

    return () => {
      isCurrent = false;
    };
  }, []);

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

        <Navigation />

        <div className="sidebar-footer">
          <span
            className={
              desktopIntegration.kind === 'unavailable'
                ? 'integration-dot is-unavailable'
                : 'integration-dot'
            }
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
            <strong>Nova importação</strong>
          </div>
        </header>

        <main className="workspace" id="conteudo-principal">
          <ImportPanel />
          <PreviewPanel />
          <ValidationPanel />
        </main>
      </div>
    </div>
  );
};
