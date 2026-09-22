import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PendingItemWithNote } from '../api.js';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page.js';
import { useAsync } from '../hooks.js';

type GroupBy = 'ninguno' | 'responsable' | 'nota' | 'fecha';

const TODAY = new Date().toISOString().slice(0, 10);

function dueClass(due: string | null): string {
  if (!due) return 'due';
  if (due < TODAY) return 'due overdue';
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return due <= soon ? 'due soon' : 'due';
}

function formatDue(due: string | null): string {
  if (!due) return '—';
  const [y, m, d] = due.split('-');
  return `${d}/${m}/${y}`;
}

export function PendingPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('ninguno');
  const [includeDone, setIncludeDone] = useState(false);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const pending = useAsync(
    () => api.pending({ include_done: includeDone, owner: owner || undefined }),
    [includeDone, owner]
  );

  const groups = useMemo(() => {
    const items = pending.data?.pendientes ?? [];
    if (groupBy === 'ninguno') return [{ title: '', items }];

    const map = new Map<string, PendingItemWithNote[]>();
    for (const item of items) {
      const key =
        groupBy === 'responsable'
          ? (item.owner ?? 'Sin responsable')
          : groupBy === 'nota'
            ? item.noteTitle
            : item.dueDate
              ? formatDue(item.dueDate)
              : 'Sin fecha';
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].map(([title, items]) => ({ title, items }));
  }, [pending.data, groupBy]);

  async function toggle(item: PendingItemWithNote, done: boolean) {
    setBusy(item.id);
    try {
      await api.setPendingDone(item.id, done);
      pending.reload();
    } finally {
      setBusy(null);
    }
  }

  const total = pending.data?.pendientes.length ?? 0;

  return (
    <Page title="Pendientes">
      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Filtrar por responsable…"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <select className="select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="ninguno">Sin agrupar</option>
          <option value="responsable">Por responsable</option>
          <option value="nota">Por nota</option>
          <option value="fecha">Por fecha</option>
        </select>
        <label className="nav-link" style={{ padding: '6px 10px' }}>
          <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
          Mostrar los hechos
        </label>
      </div>

      <ErrorBanner message={pending.error} />

      {pending.loading && !pending.data ? (
        <Loading />
      ) : total === 0 ? (
        <Empty title={includeDone ? 'No hay pendientes' : 'Nada pendiente'}>
          Los pendientes salen de las líneas <code>- [ ]</code> de tus notas.
        </Empty>
      ) : (
        groups.map((group) => (
          <div key={group.title || 'todos'}>
            {group.title && (
              <div className="group-head">
                {group.title}
                <span className="line" />
                {group.items.length}
              </div>
            )}
            <div className="panel" style={{ padding: '6px 10px' }}>
              <table className="table">
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={item.done}
                          disabled={busy === item.id}
                          onChange={(e) => void toggle(item, e.target.checked)}
                        />
                      </td>
                      <td>
                        <div className={item.done ? 'pending-row done' : 'pending-row'}>
                          <div>
                            <div className="action">{item.action}</div>
                            <Link className="from" to={`/nota/${item.noteId}`}>
                              {item.noteFolder} · {item.noteTitle}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td style={{ width: 160 }}>{item.owner ?? <span className="hint">—</span>}</td>
                      <td style={{ width: 110 }}>
                        <span className={item.done ? 'due' : dueClass(item.dueDate)}>{formatDue(item.dueDate)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </Page>
  );
}
