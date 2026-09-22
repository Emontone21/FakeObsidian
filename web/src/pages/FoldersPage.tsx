import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { buildFolderColors, folderColor } from '../components/GraphView.js';
import { ErrorBanner, Loading, Page } from '../components/Page.js';
import { useAsync } from '../hooks.js';

export function FoldersPage() {
  const folders = useAsync(() => api.folders(), []);
  const folderColors = useMemo(
    () => buildFolderColors((folders.data?.carpetas ?? []).map((f) => f.name)),
    [folders.data]
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('General');
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      folders.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
    }
  }

  return (
    <Page title="Carpetas" narrow>
      <ErrorBanner message={error} />

      <div className="panel">
        <h2>Nueva carpeta</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Nombre de la carpeta"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!newName.trim()}
            onClick={() =>
              void run(async () => {
                await api.createFolder(newName.trim());
                setNewName('');
              })
            }
          >
            Crear
          </button>
        </div>
      </div>

      {folders.loading && !folders.data ? (
        <Loading />
      ) : (
        <div className="panel">
          <h2>{folders.data?.carpetas.length ?? 0} carpetas</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Carpeta</th>
                <th style={{ width: 80 }}>Notas</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {folders.data?.carpetas.map((folder) => (
                <tr key={folder.name}>
                  <td>
                    {editing === folder.name ? (
                      <input
                        className="input"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void run(() => api.renameFolder(folder.name, draft.trim()));
                            setEditing(null);
                          }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="swatch"
                          style={{ width: 9, height: 9, borderRadius: '50%', background: folderColor(folder.name, folderColors) }}
                        />
                        <Link to={`/?folder=${encodeURIComponent(folder.name)}`}>{folder.name}</Link>
                      </span>
                    )}
                  </td>
                  <td>{folder.noteCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    {editing === folder.name ? (
                      <>
                        <button
                          className="btn sm primary"
                          onClick={() => {
                            void run(() => api.renameFolder(folder.name, draft.trim()));
                            setEditing(null);
                          }}
                        >
                          Guardar
                        </button>{' '}
                        <button className="btn sm ghost" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn sm"
                          onClick={() => {
                            setEditing(folder.name);
                            setDraft(folder.name);
                          }}
                        >
                          Renombrar
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => setDeleting(folder.name)}>
                          Borrar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 12 }}>
            Renombrar una carpeta mueve sus notas. Si el nombre nuevo ya existe, las dos se fusionan.
          </p>
        </div>
      )}

      {deleting && (
        <div className="modal-backdrop" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Borrar «{deleting}»</h2>
            <p>Las notas que estén adentro se mudan a la carpeta que elijas. No se borra ninguna nota.</p>
            <div className="field">
              <label>Mover las notas a</label>
              <select className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {folders.data?.carpetas
                  .filter((f) => f.name !== deleting)
                  .map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDeleting(null)}>
                Cancelar
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  void run(() => api.deleteFolder(deleting, moveTo));
                  setDeleting(null);
                }}
              >
                Borrar carpeta
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
