import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBanner, Empty, Loading, Page } from '../components/Page.js';
import { useAsync } from '../hooks.js';

export function TagsPage() {
  const tags = useAsync(() => api.tags(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function rename(from: string, to: string) {
    setError(null);
    setNotice(null);
    const exists = tags.data?.tags.some((t) => t.name === to.trim().toLowerCase());
    try {
      const result = await api.renameTag(from, to.trim());
      setNotice(exists ? `Se fusionó «${from}» dentro de «${result.name}».` : `«${from}» ahora es «${result.name}».`);
      tags.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo renombrar el tag.');
    }
  }

  return (
    <Page title="Tags" narrow>
      <ErrorBanner message={error} />
      {notice && <div className="banner ok">{notice}</div>}

      {tags.loading && !tags.data ? (
        <Loading />
      ) : (tags.data?.tags.length ?? 0) === 0 ? (
        <Empty title="Todavía no hay tags">Los tags salen del frontmatter de cada nota.</Empty>
      ) : (
        <div className="panel">
          <h2>{tags.data?.tags.length} tags en uso</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th style={{ width: 80 }}>Notas</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {tags.data?.tags.map((tag) => (
                <tr key={tag.name}>
                  <td>
                    {editing === tag.name ? (
                      <input
                        className="input"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void rename(tag.name, draft);
                            setEditing(null);
                          }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <Link to={`/?tags=${encodeURIComponent(tag.name)}`}>#{tag.name}</Link>
                    )}
                  </td>
                  <td>{tag.noteCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    {editing === tag.name ? (
                      <>
                        <button
                          className="btn sm primary"
                          onClick={() => {
                            void rename(tag.name, draft);
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
                      <button
                        className="btn sm"
                        onClick={() => {
                          setEditing(tag.name);
                          setDraft(tag.name);
                        }}
                      >
                        Renombrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 12 }}>
            Si renombrás un tag al nombre de otro que ya existe, los dos se fusionan sin duplicar notas. Los tags se
            normalizan solos: minúsculas, sin acentos y con guiones.
          </p>
        </div>
      )}
    </Page>
  );
}
