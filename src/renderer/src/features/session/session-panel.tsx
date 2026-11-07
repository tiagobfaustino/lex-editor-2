import { useEffect, useState, type SubmitEvent } from 'react';

import type { SessionStateDto, SessionStateResult } from '../../../../shared/ipc/session.js';

export const SessionPanel = (): React.JSX.Element => {
  const [state, setState] = useState<SessionStateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.lexDesktop;
    if (api === undefined) return;
    void api.session.getState().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.value);
      else setMessage(result.error.message);
    });
    return () => {
      active = false;
    };
  }, []);

  const apply = (result: SessionStateResult) => {
    if (result.ok) {
      setState(result.value);
      setMessage(null);
    } else setMessage(result.error.message);
    setBusy(false);
  };

  const signIn = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = window.lexDesktop;
    if (api === undefined || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = data.get('email');
    const password = data.get('password');
    form.reset();
    if (typeof email !== 'string' || typeof password !== 'string') return;
    setBusy(true);
    setMessage(null);
    apply(await api.session.signIn({ email, password }));
  };

  const signOut = async () => {
    const api = window.lexDesktop;
    if (api === undefined || busy) return;
    setBusy(true);
    apply(await api.session.signOut());
  };

  const authenticated = state?.sessionState === 'authenticated';
  return (
    <section className="panel" id="sessao" aria-labelledby="session-heading">
      <h2 id="session-heading">Sessão individual</h2>
      <p role="status">
        {state === null
          ? 'Verificando sessão.'
          : state.sessionState === 'not_configured'
            ? 'Conexão editorial não configurada.'
            : authenticated
              ? `Sessão ativa — ${state.role === 'administrador_tecnico' ? 'Administrador Técnico' : 'Editor Jurídico'}.`
              : 'Entre para acessar as operações editoriais remotas.'}
      </p>
      {message === null ? null : <p role="alert">{message}</p>}
      {authenticated ? (
        <button type="button" disabled={busy} onClick={() => void signOut()}>
          Sair da sessão
        </button>
      ) : state?.sessionState === 'signed_out' ? (
        <form onSubmit={(event) => void signIn(event)}>
          <label htmlFor="session-email">E-mail</label>
          <input
            id="session-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            disabled={busy}
          />
          <label htmlFor="session-password">Senha</label>
          <input
            id="session-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1_024}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      ) : null}
    </section>
  );
};
