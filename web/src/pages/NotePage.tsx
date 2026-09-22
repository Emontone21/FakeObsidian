import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type NoteDetail } from '../api.js';
import { buildFolderColors, GraphView } from '../components/GraphView.js';
import { NoteMarkdown } from '../components/NoteMarkdown.js';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page.js';
import { useAsync } from '../hooks.js';

export function NotePage() {
  const { id = '' } = useParams();
  if (id === 'nueva') return <NewNote />;
  return <ExistingNote id={id} />;
}

/* ---------------------------------------------------------------- nota nueva */

function NewNote() {
  const navigate = useNavigate();
  const folders = useAsync(() => api.folders(), []);
  const [form, setForm] = useState({
    title: '',
    folder: 'General',
    tags: '',
    summary: '',
    contexto: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createNote({
        title: form.title,
        folder: form.folder,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        summary: form.summary,
        contexto: form.contexto,
        decisiones: [],
        pendientes: [],
        referencias: [],
        relacionados: []
      });
      navigate(`/nota/${result.note.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la nota.');
      setBusy(false);
    }
  }

  return (
    <Page title="Nueva nota" narrow>
      <ErrorBanner message={error} />
      <div className="panel">
        <div className="field">
          <label>Título</label>
          <input
            className="input"
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <span className="hint">Sin la fecha adelante. Si ya existe, se le agrega un sufijo.</span>
        </div>
        <div className="field">
          <label>Carpeta</label>
          <select
            className="select"
            value={form.folder}
            onChange={(e) => setForm({ ...form, folder: e.target.value })}
          >
            {folders.data?.carpetas.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Tags</label>
          <input
            className="input"
            placeholder="calidad, oos"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <span className="hint">Separados por coma. Se normalizan solos.</span>
        </div>
        <div className="field">
          <label>Resumen</label>
          <input
            className="input"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Contexto</label>
          <textarea
            className="textarea"
            rows={5}
            value={form.contexto}
            onChange={(e) => setForm({ ...form, contexto: e.target.value })}
          />
        </div>
        <div className="modal-actions">
          <Link className="btn ghost" to="/">
            Cancelar
          </Link>
          <button className="btn primary" disabled={busy || !form.title.trim()} onClick={() => void create()}>
            Crear nota
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Se crea con la plantilla completa; después podés editar el cuerpo entero.
        </p>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ nota existente */

function ExistingNote({ id }: { id: string }) {
  const navigate = useNavigate();
  const detail = useAsync(() => api.note(id), [id]);
  const folders = useAsync(() => api.folders(), []);
  const folderColors = useMemo(
    () => buildFolderColors((folders.data?.carpetas ?? []).map((f) => f.name)),
    [folders.data]
  );
  const status = useAsync(() => api.status(), []);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [depth, setDepth] = useState(1);
  const [summarizing, setSummarizing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const local = useAsync(
    () => (detail.data ? api.localGraph(detail.data.note.id, depth, { include_phantoms: true }) : Promise.resolve(null)),
    [detail.data?.note.id, depth]
  );

  useEffect(() => setEditing(false), [id]);

  if (detail.loading && !detail.data) return <Page title="Nota"><Loading /></Page>;
  if (detail.error || !detail.data) {
    return (
      <Page title="Nota">
        <Empty title="No encontramos esa nota">
          <p>{detail.error}</p>
          <Link className="btn" to="/">
            Volver al listado
          </Link>
        </Empty>
      </Page>
    );
  }

  const { note, outlinks, backlinks, pending } = detail.data;
  const sinResumir = note.tags.includes('sin-resumir');

  async function toggleTask(index: number, done: boolean) {
    const item = pending[index];
    if (!item) return;
    await api.setPendingDone(item.id, done);
    detail.reload();
  }

  async function remove() {
    await api.deleteNote(note.id);
    navigate('/');
  }

  async function summarize() {
    setSummarizing(true);
    setNotice(null);
    try {
      const result = await api.summarizeNote(note.id);
      setNotice({
        kind: 'ok',
        text:
          result.avisos.length > 0
            ? `Resumen generado. ${result.avisos.join(' ')}`
            : 'Resumen generado: la nota ya tiene contexto, decisiones y pendientes.'
      });
      detail.reload();
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : 'No se pudo generar el resumen.' });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <Page
      title={note.title}
      actions={
        <>
          {sinResumir && status.data?.resumidor.habilitado && (
            <button className="btn primary" disabled={summarizing} onClick={() => void summarize()}>
              {summarizing ? 'Resumiendo…' : 'Generar resumen'}
            </button>
          )}
          <button className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Ver' : 'Editar'}
          </button>
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            Borrar
          </button>
        </>
      }
    >
      {notice && <div className={notice.kind === 'ok' ? 'banner ok' : 'banner error'}>{notice.text}</div>}

      {sinResumir && (
        <div className="banner info">
          Esta nota se importó sin resumir. Pedíle a <strong>Claude Desktop</strong> que la complete: ya está
          conectado por MCP y puede leer la transcripción y llenar contexto, decisiones y pendientes. Alcanza con
          «resumí la nota «{note.title}» de Bitácora». También podés escribirla a mano desde «Editar».
        </div>
      )}

      {editing ? (
        <NoteEditor
          detail={detail.data}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            detail.reload();
          }}
        />
      ) : (
        <div className="note-layout">
          <div>
            <div className="frontmatter">
              <div>
                <span className="k">fecha</span> {note.date} {note.time}
              </div>
              <div>
                <span className="k">fuente</span>{' '}
                {note.source === 'claude' ? 'Claude (conversación)' : note.source}
                {note.sourceUrl && (
                  <>
                    {' · '}
                    <a href={note.sourceUrl} target="_blank" rel="noreferrer">
                      ver conversación
                    </a>
                  </>
                )}
              </div>
              <div>
                <span className="k">tags</span> [{note.tags.join(', ')}]
              </div>
              <div>
                <span className="k">estado</span> {note.status}
              </div>
            </div>

            <h1 style={{ fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>{note.title}</h1>
            <div className="chips" style={{ marginBottom: 22 }}>
              <Link className="chip folder" to={`/?folder=${encodeURIComponent(note.folder)}`}>
                {note.folder}
              </Link>
              {note.tags.map((tag) => (
                <span className="chip" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>

            <NoteMarkdown body={note.body} outlinks={outlinks} onToggleTask={(i, d) => void toggleTask(i, d)} />
          </div>

          <aside className="sidepanel">
            <div className="panel">
              <h2>Grafo local</h2>
              <div className="graph-embed">
                {local.data && (
                  <GraphView
                    nodes={local.data.nodes}
                    edges={local.data.edges}
                    focusId={note.id}
                    colors={folderColors}
                    onOpen={(n) => {
                      if (!n.phantom) navigate(`/nota/${n.id}`);
                    }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[1, 2].map((d) => (
                  <button key={d} className={depth === d ? 'btn sm primary' : 'btn sm'} onClick={() => setDepth(d)}>
                    {d} salto{d > 1 ? 's' : ''}
                  </button>
                ))}
                <Link className="btn sm ghost" to="/grafo" style={{ marginLeft: 'auto' }}>
                  Ver completo
                </Link>
              </div>
            </div>

            <div className="panel">
              <h2>Backlinks ({backlinks.length})</h2>
              {backlinks.length === 0 ? (
                <p className="hint">Ninguna nota enlaza a esta todavía.</p>
              ) : (
                <div className="link-list">
                  {backlinks.map((link) => (
                    <Link key={link.id} to={`/nota/${link.id}`}>
                      {link.title}
                      <span className="folder">{link.folder}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>Enlaces salientes ({outlinks.length})</h2>
              {outlinks.length === 0 ? (
                <p className="hint">Esta nota no enlaza a ninguna otra.</p>
              ) : (
                <div className="link-list">
                  {outlinks.map((link) =>
                    link.note ? (
                      <Link key={link.targetTitle} to={`/nota/${link.note.id}`}>
                        {link.note.title}
                        <span className="folder">{link.note.folder}</span>
                      </Link>
                    ) : (
                      <span key={link.targetTitle} style={{ padding: '5px 8px', color: 'var(--text-faint)' }}>
                        {link.targetTitle}
                        <span className="folder">sin resolver</span>
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>¿Borrar esta nota?</h2>
            <p>
              Se va a borrar <strong>{note.title}</strong> para siempre. Las notas que la enlazan quedan con el
              enlace sin resolver. Esto no se puede deshacer.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={() => void remove()}>
                Borrar la nota
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------- editor */

function NoteEditor({
  detail,
  onCancel,
  onSaved
}: {
  detail: NoteDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const folders = useAsync(() => api.folders(), []);
  const [title, setTitle] = useState(detail.note.title);
  const [folder, setFolder] = useState(detail.note.folder);
  const [tags, setTags] = useState(detail.note.tags.join(', '));
  const [summary, setSummary] = useState(detail.note.summary);
  const [body, setBody] = useState(detail.note.body);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateNote(detail.note.id, {
        title,
        folder,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        summary,
        body_markdown: body
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <ErrorBanner message={error} />
      <div className="panel">
        <div className="field">
          <label>Título</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <span className="hint">Al renombrar, los [[wikilinks]] que apuntan acá se reescriben solos.</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Carpeta</label>
            <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.data?.carpetas.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Tags</label>
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Resumen</label>
          <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Cuerpo</h2>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Editar' : 'Vista previa'}
          </button>
        </div>
        {preview ? (
          <NoteMarkdown body={body} outlinks={detail.outlinks} />
        ) : (
          <textarea className="textarea" rows={26} value={body} onChange={(e) => setBody(e.target.value)} />
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          El frontmatter y el título se generan solos desde los campos de arriba: acá va de <code>## Contexto</code>{' '}
          en adelante.
        </p>
      </div>

      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
