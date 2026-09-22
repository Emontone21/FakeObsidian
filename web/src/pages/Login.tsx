import { useState, type FormEvent } from 'react';
import { api } from '../api.js';

export function Login({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (needsSetup && password !== repeat) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    try {
      if (needsSetup) await api.setup(password);
      else await api.login(password);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={submit}>
        <div className="brand">
          <span className="dot" />
          Bitácora
        </div>
        <p className="lead">
          {needsSetup
            ? 'Primera vez acá. Definí la contraseña con la que vas a entrar.'
            : 'Tu base de conocimiento personal.'}
        </p>

        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            autoFocus
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needsSetup && <span className="hint">Mínimo 8 caracteres.</span>}
        </div>

        {needsSetup && (
          <div className="field">
            <label htmlFor="repeat">Repetir contraseña</label>
            <input
              id="repeat"
              className="input"
              type="password"
              value={repeat}
              autoComplete="new-password"
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
        )}

        <button className="btn primary" type="submit" disabled={busy || password.length === 0} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Un momento…' : needsSetup ? 'Crear contraseña y entrar' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
