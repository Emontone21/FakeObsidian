import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBanner, Loading, Page } from '../components/Page.js';
import { useAsync, useTheme } from '../hooks.js';

export function SettingsPage({ onLoggedOut }: { onLoggedOut: () => void }) {
  const status = useAsync(() => api.status(), []);
  const [theme, toggleTheme] = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function changePassword() {
    setError(null);
    setNotice(null);
    if (next !== repeat) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    try {
      await api.changePassword(current, next);
      setNotice('Contraseña cambiada. Se cerraron todas las sesiones.');
      setTimeout(onLoggedOut, 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la contraseña.');
    }
  }

  return (
    <Page title="Ajustes" narrow>
      <ErrorBanner message={error} />
      {notice && <div className="banner ok">{notice}</div>}

      <div className="panel">
        <h2>Copias y exportación</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          Todo tu vault en <code>.md</code> con frontmatter YAML: la carpeta que baja se abre directamente como vault
          de Obsidian. El backup es la base SQLite entera, lista para restaurar.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn primary" href="/api/export/vault.zip">
            Exportar vault (.zip)
          </a>
          <a className="btn" href="/api/export/backup.db">
            Backup de la base (.db)
          </a>
        </div>
      </div>

      <div className="panel">
        <h2>Apariencia</h2>
        <button className="btn" onClick={toggleTheme}>
          {theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        </button>
      </div>

      <div className="panel">
        <h2>Contraseña</h2>
        <div className="field">
          <label>Contraseña actual</label>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label>Contraseña nueva</label>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="hint">Mínimo 8 caracteres. Al cambiarla se cierran todas las sesiones abiertas.</span>
        </div>
        <div className="field">
          <label>Repetir la nueva</label>
          <input className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        <button
          className="btn primary"
          disabled={!current || next.length < 8}
          onClick={() => void changePassword()}
        >
          Cambiar contraseña
        </button>
      </div>

      <div className="panel">
        <h2>Estado del vault</h2>
        {status.loading && !status.data ? (
          <Loading />
        ) : status.data ? (
          <table className="table">
            <tbody>
              <tr>
                <td>Notas</td>
                <td>{status.data.notas}</td>
              </tr>
              <tr>
                <td>Carpetas</td>
                <td>{status.data.carpetas}</td>
              </tr>
              <tr>
                <td>Tags</td>
                <td>{status.data.tags}</td>
              </tr>
              <tr>
                <td>Enlaces resueltos</td>
                <td>{status.data.enlaces}</td>
              </tr>
              <tr>
                <td>Enlaces sin resolver</td>
                <td>{status.data.enlacesSinResolver}</td>
              </tr>
              <tr>
                <td>Pendientes abiertos</td>
                <td>{status.data.pendientesAbiertos}</td>
              </tr>
              <tr>
                <td>Zona horaria</td>
                <td>{status.data.timeZone}</td>
              </tr>
              <tr>
                <td>Base de datos</td>
                <td>
                  <code style={{ fontSize: 12 }}>{status.data.dbPath}</code>
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="panel">
        <h2>Resumir notas importadas</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          El camino normal es pedírselo a <strong>Claude Desktop</strong>, que ya está conectado por MCP: usá el
          prompt <code>resumir-importadas</code> del conector Bitácora. No hace falta ninguna clave y no cuesta nada
          aparte de tu suscripción.
        </p>
        <p className="hint">
          Opcional, para tandas grandes sin supervisión: con <code>ANTHROPIC_API_KEY</code> en el <code>.env</code>,
          el servidor las resume solo desde la pantalla de importación. Estado actual:{' '}
          {status.data?.resumidor.estado ?? 'cargando…'}
        </p>
      </div>

      <div className="panel">
        <h2>Acceso desde claude.ai</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>{status.data?.conectorRemoto.estado ?? 'Cargando…'}</p>
        <p className="hint">
          Claude Desktop y Claude Code hablan con Bitácora por stdio, que es un proceso local y no necesita nada de
          esto. Usar el vault desde claude.ai en el navegador o el celular sí lo necesitaría: los servidores de
          Anthropic no pueden alcanzar tu <code>127.0.0.1</code>, así que haría falta exponer <code>/mcp</code> por
          Streamable HTTP con OAuth 2.1 detrás de un Cloudflare Tunnel y un dominio propio.
        </p>
      </div>
    </Page>
  );
}
