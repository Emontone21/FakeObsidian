import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ImportReport } from '../api.js';
import { ErrorBanner, Page } from '../components/Page.js';
import { useAsync } from '../hooks.js';

type Phase = 'idle' | 'analizando' | 'previsualizado' | 'importando' | 'listo';

interface SummaryProgress {
  total: number;
  hechas: number;
  fallidas: { title: string; error: string }[];
}

export function ImportPage() {
  const status = useAsync(() => api.status(), []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryProgress | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setSummary(null);
    setPhase('idle');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function analyze(chosen: File) {
    setFile(chosen);
    setError(null);
    setResult(null);
    setSummary(null);
    setPhase('analizando');
    try {
      setPreview(await api.importExport(chosen, { dryRun: true }));
      setPhase('previsualizado');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
      setPhase('idle');
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    setPhase('importando');
    try {
      setResult(await api.importExport(file));
      setPhase('listo');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo importar.');
      setPhase('previsualizado');
    }
  }

  /** Resume las notas importadas de a una, para poder mostrar el avance. */
  async function summarizeAll() {
    if (!result) return;
    const pendientes = result.imported;
    setSummary({ total: pendientes.length, hechas: 0, fallidas: [] });

    for (const note of pendientes) {
      try {
        await api.summarizeNote(note.id);
        setSummary((s) => (s ? { ...s, hechas: s.hechas + 1 } : s));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'error desconocido';
        setSummary((s) =>
          s ? { ...s, hechas: s.hechas + 1, fallidas: [...s.fallidas, { title: note.title, error: message }] } : s
        );
      }
    }
  }

  const busy = phase === 'analizando' || phase === 'importando';

  return (
    <Page title="Importar" narrow>
      <ErrorBanner message={error} />

      <div className="panel">
        <h2>Export de claude.ai</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          En claude.ai entrá a <strong>Configuración → Privacidad → Exportar datos</strong>. Te llega un mail con un
          zip. Subilo acá tal cual: cada conversación se convierte en una nota en la carpeta{' '}
          <code>Importado</code>, con la transcripción completa en un bloque plegable.
        </p>

        <input
          ref={fileInput}
          className="input"
          type="file"
          accept=".zip,.json,application/zip,application/json"
          disabled={busy}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void analyze(chosen);
          }}
        />
        <p className="hint" style={{ marginTop: 8 }}>
          Funciona con el zip entero o con el <code>conversations.json</code> de adentro. Si volvés a importar el
          mismo archivo, no se duplica nada: cada nota queda atada al id de su conversación.
        </p>
      </div>

      {phase === 'analizando' && <div className="banner info">Leyendo el archivo…</div>}

      {preview && phase !== 'listo' && (
        <div className="panel">
          <h2>Qué se va a importar</h2>
          <table className="table">
            <tbody>
              <tr>
                <td>Archivo leído</td>
                <td>
                  <code>{preview.archivo}</code>
                </td>
              </tr>
              <tr>
                <td>Conversaciones encontradas</td>
                <td>{preview.total}</td>
              </tr>
              <tr>
                <td>Se van a crear</td>
                <td>
                  <strong>{preview.imported.length}</strong>
                </td>
              </tr>
              <tr>
                <td>Ya estaban importadas</td>
                <td>{preview.skipped.length}</td>
              </tr>
            </tbody>
          </table>

          {preview.warnings.length > 0 && (
            <div className="banner info" style={{ marginTop: 12 }}>
              {preview.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          {preview.imported.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="hint" style={{ cursor: 'pointer' }}>
                Ver los {preview.imported.length} títulos
              </summary>
              <ul style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {preview.imported.slice(0, 200).map((c, i) => (
                  <li key={`${c.conversationId}-${i}`}>{c.title}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={reset} disabled={busy}>
              Cancelar
            </button>
            <button
              className="btn primary"
              disabled={busy || preview.imported.length === 0}
              onClick={() => void runImport()}
            >
              {phase === 'importando' ? 'Importando…' : `Importar ${preview.imported.length} conversaciones`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="panel">
          <h2>Listo</h2>
          <div className="banner ok">
            Se importaron {result.imported.length} conversaciones
            {result.skipped.length > 0 ? `, y se saltearon ${result.skipped.length} que ya estaban` : ''}.
          </div>

          {result.warnings.length > 0 && (
            <div className="banner info">
              {result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          <div className="link-list" style={{ marginBottom: 14 }}>
            {result.imported.slice(0, 50).map((note) => (
              <Link key={note.id} to={`/nota/${note.id}`}>
                {note.title}
              </Link>
            ))}
            {result.imported.length > 50 && (
              <span className="hint">…y {result.imported.length - 50} más. Están todas en «Importado».</span>
            )}
          </div>

          {status.data?.resumidor.habilitado ? (
            <>
              <p style={{ color: 'var(--text-muted)' }}>
                Las notas quedaron con la transcripción cruda y el tag <code>sin-resumir</code>. Podés generarles
                la plantilla estructurada (contexto, decisiones, pendientes, referencias) con Claude.
              </p>
              {summary ? (
                <div className="banner info">
                  Resumiendo… {summary.hechas} de {summary.total}
                  {summary.fallidas.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      Fallaron {summary.fallidas.length}: {summary.fallidas.map((f) => f.title).join(', ')}
                    </div>
                  )}
                </div>
              ) : (
                <button className="btn primary" onClick={() => void summarizeAll()}>
                  Generar resumen de las {result.imported.length} notas
                </button>
              )}
            </>
          ) : (
            <p className="hint">
              {status.data?.resumidor.estado} Podés resumirlas después agregando la clave al <code>.env</code>, o
              abrir cada nota y escribir el resumen a mano.
            </p>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={reset}>
              Importar otro archivo
            </button>
          </div>
        </div>
      )}
    </Page>
  );
}
