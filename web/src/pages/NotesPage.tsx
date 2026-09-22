import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type NotesQuery } from '../api.js';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page.js';
import { buildFolderColors, folderColor } from '../components/GraphView.js';
import { useAsync, useDebounced } from '../hooks.js';

export function NotesPage() {
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<NotesQuery['sort']>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const debouncedQuery = useDebounced(query);
  const tagKey = tags.join(',');

  const folders = useAsync(() => api.folders(), []);
  const folderColors = useMemo(
    () => buildFolderColors((folders.data?.carpetas ?? []).map((f) => f.name)),
    [folders.data]
  );
  const allTags = useAsync(() => api.tags(), []);
  const notes = useAsync(
    () =>
      api.notes({
        query: debouncedQuery || undefined,
        folder: folder || undefined,
        tags: tags.length > 0 ? tags : undefined,
        date_from: from || undefined,
        date_to: to || undefined,
        sort,
        limit: 120
      }),
    [debouncedQuery, folder, tagKey, from, to, sort]
  );

  const toggleTag = (name: string) =>
    setTags((current) => (current.includes(name) ? current.filter((t) => t !== name) : [...current, name]));

  const filtered = Boolean(query || folder || tags.length > 0 || from || to);

  return (
    <Page
      title="Notas"
      actions={
        <Link className="btn primary" to="/nota/nueva">
          Nueva nota
        </Link>
      }
    >
      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Buscar en título, resumen y cuerpo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">Todas las carpetas</option>
          {folders.data?.carpetas.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({f.noteCount})
            </option>
          ))}
        </select>
        <select
          className="select"
          value={sort ?? ''}
          onChange={(e) => setSort((e.target.value || undefined) as NotesQuery['sort'])}
        >
          <option value="">Orden automático</option>
          <option value="fecha">Por fecha</option>
          <option value="titulo">Por título</option>
          <option value="relevancia">Por relevancia</option>
        </select>
        <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          Desde
          <input className="input" style={{ width: 138 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          Hasta
          <input className="input" style={{ width: 138 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <button
            className="btn ghost"
            onClick={() => {
              setQuery('');
              setFolder('');
              setTags([]);
              setFrom('');
              setTo('');
              setSort(undefined);
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      {allTags.data && allTags.data.tags.length > 0 && (
        <div className="chips" style={{ marginBottom: 18 }}>
          {allTags.data.tags.slice(0, 26).map((tag) => (
            <button
              key={tag.name}
              className={tags.includes(tag.name) ? 'chip on' : 'chip'}
              onClick={() => toggleTag(tag.name)}
            >
              #{tag.name}
              <span style={{ opacity: 0.6 }}>{tag.noteCount}</span>
            </button>
          ))}
        </div>
      )}

      <ErrorBanner message={notes.error} />

      {notes.loading && !notes.data ? (
        <Loading />
      ) : notes.data && notes.data.resultados.length === 0 ? (
        <Empty title={filtered ? 'Ningún resultado' : 'Todavía no hay notas'}>
          {filtered
            ? 'Probá con otras palabras o limpiá los filtros.'
            : 'Guardá una conversación desde Claude, o creá una nota a mano.'}
        </Empty>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            {notes.data && notes.data.resultados.length < notes.data.total
              ? `Mostrando ${notes.data.resultados.length} de ${notes.data.total} notas`
              : `${notes.data?.total ?? 0} nota${notes.data?.total === 1 ? '' : 's'}`}
          </p>
          <div className="cards">
            {notes.data?.resultados.map((note) => (
              <Link className="card" key={note.id} to={`/nota/${note.id}`}>
                <h3>{note.title}</h3>
                <div className="meta">
                  <span
                    className="swatch"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: folderColor(note.folder, folderColors),
                      display: 'inline-block'
                    }}
                  />
                  {note.folder}
                  <span>·</span>
                  {note.date}
                </div>
                <p className="summary">{note.summary || note.snippet}</p>
                {note.tags.length > 0 && (
                  <div className="chips">
                    {note.tags.map((tag) => (
                      <span className="chip" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
