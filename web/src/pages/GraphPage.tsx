import type { GraphEdge, GraphNode } from '@bitacora/shared';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import {
  buildFolderColors,
  DEFAULT_PHYSICS,
  folderColor,
  GraphView,
  type PhysicsSettings
} from '../components/GraphView.js';
import { ErrorBanner, Loading } from '../components/Page.js';
import { useAsync, useDebounced } from '../hooks.js';

/** Tope de aristas por tag compartido: sin esto un tag muy usado tapa el grafo. */
const MAX_TAG_EDGES = 3000;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function GraphPage() {
  const navigate = useNavigate();
  const [showTagNodes, setShowTagNodes] = useState(false);
  const [showPhantoms, setShowPhantoms] = useState(true);
  const [showTagEdges, setShowTagEdges] = useState(false);
  const [showOrphans, setShowOrphans] = useState(true);
  const [folder, setFolder] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const recenterRef = useRef<() => void>(() => {});

  const folders = useAsync(() => api.folders(), []);
  const graph = useAsync(
    () =>
      api.graph({
        include_tags: showTagNodes,
        include_phantoms: showPhantoms,
        folder: folder || undefined,
        date_from: from || undefined,
        date_to: to || undefined
      }),
    [showTagNodes, showPhantoms, folder, from, to]
  );

  const debouncedSearch = useDebounced(search, 200);
  const folderColors = useMemo(
    () => buildFolderColors((folders.data?.carpetas ?? []).map((f) => f.name)),
    [folders.data]
  );

  const { nodes, edges } = useMemo(() => {
    const base = graph.data ?? { nodes: [], edges: [] };
    let nodes = base.nodes;
    let edges = base.edges;

    if (showTagEdges) {
      const byTag = new Map<string, string[]>();
      for (const node of nodes) {
        if (node.phantom || node.id.startsWith('tag:')) continue;
        for (const tag of node.tags) {
          const list = byTag.get(tag);
          if (list) list.push(node.id);
          else byTag.set(tag, [node.id]);
        }
      }
      const extra: GraphEdge[] = [];
      for (const ids of byTag.values()) {
        for (let i = 0; i < ids.length && extra.length < MAX_TAG_EDGES; i++) {
          for (let j = i + 1; j < ids.length && extra.length < MAX_TAG_EDGES; j++) {
            extra.push({ source: ids[i]!, target: ids[j]!, kind: 'tag' });
          }
        }
      }
      edges = [...edges, ...extra];
    }

    if (!showOrphans) {
      const connected = new Set<string>();
      for (const edge of edges) {
        connected.add(edge.source);
        connected.add(edge.target);
      }
      nodes = nodes.filter((node) => connected.has(node.id));
      const visible = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => visible.has(e.source) && visible.has(e.target));
    }

    return { nodes, edges };
  }, [graph.data, showTagEdges, showOrphans]);

  const highlight = useMemo(() => {
    const term = normalize(debouncedSearch.trim());
    if (!term) return undefined;
    return new Set(nodes.filter((n) => normalize(n.title).includes(term)).map((n) => n.id));
  }, [debouncedSearch, nodes]);

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (node.phantom || node.id.startsWith('tag:')) continue;
      counts.set(node.folder, (counts.get(node.folder) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  return (
    <div className="main">
      <header className="topbar">
        <h1>Grafo</h1>
        <div className="spacer" />
        <span className="hint">
          {nodes.length} nodos · {edges.length} aristas
        </span>
        <button className="btn" onClick={() => recenterRef.current()}>
          Recentrar
        </button>
      </header>

      <div className="graph-page">
        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <div className="graph-overlay">
            <input
              className="input"
              placeholder="Resaltar notas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {highlight && (
              <span className="chip on" style={{ alignSelf: 'center' }}>
                {highlight.size} coinciden
              </span>
            )}
          </div>

          {graph.loading && !graph.data ? (
            <Loading />
          ) : (
            <GraphView
              nodes={nodes}
              edges={edges}
              physics={physics}
              highlight={highlight}
              colors={folderColors}
              onSelect={setSelected}
              onOpen={(node) => {
                if (!node.phantom && !node.id.startsWith('tag:')) navigate(`/nota/${node.id}`);
              }}
              onReady={(controls) => {
                recenterRef.current = controls.recenter;
              }}
            />
          )}
        </div>

        <aside className="graph-controls">
          <ErrorBanner message={graph.error} />

          {selected && (
            <div className="group">
              <h2>Seleccionada</h2>
              <div className="panel" style={{ margin: 0, padding: 12 }}>
                <strong style={{ color: 'var(--text-strong)' }}>{selected.title}</strong>
                {selected.phantom ? (
                  <p className="hint" style={{ margin: '6px 0 0' }}>
                    Enlace sin resolver: esa nota todavía no existe.
                  </p>
                ) : selected.id.startsWith('tag:') ? (
                  <p className="hint" style={{ margin: '6px 0 0' }}>{selected.summary}</p>
                ) : (
                  <>
                    <div className="hint" style={{ margin: '4px 0 8px' }}>
                      {selected.folder} · {selected.date} · {selected.degree} enlaces
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>{selected.summary}</p>
                    <Link className="btn sm primary" to={`/nota/${selected.id}`}>
                      Abrir nota
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="group">
            <h2>Mostrar</h2>
            <label className="row">
              <input type="checkbox" checked={showTagNodes} onChange={(e) => setShowTagNodes(e.target.checked)} />
              Tags como nodos
            </label>
            <label className="row">
              <input type="checkbox" checked={showPhantoms} onChange={(e) => setShowPhantoms(e.target.checked)} />
              Enlaces sin resolver
            </label>
            <label className="row">
              <input type="checkbox" checked={showTagEdges} onChange={(e) => setShowTagEdges(e.target.checked)} />
              Aristas por tag compartido
            </label>
            <label className="row">
              <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
              Notas huérfanas
            </label>
          </div>

          <div className="group">
            <h2>Filtrar</h2>
            <select
              className="select"
              value={folder}
              style={{ marginBottom: 8 }}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="">Todas las carpetas</option>
              {folders.data?.carpetas.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.noteCount})
                </option>
              ))}
            </select>
            <div className="dates">
              <input className="input" type="date" value={from} title="Desde" onChange={(e) => setFrom(e.target.value)} />
              <input className="input" type="date" value={to} title="Hasta" onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="group">
            <h2>Fuerzas</h2>
            <Slider
              label="Repulsión"
              min={-600}
              max={-20}
              step={10}
              value={physics.charge}
              display={String(-physics.charge)}
              onChange={(charge) => setPhysics((p) => ({ ...p, charge }))}
            />
            <Slider
              label="Distancia de enlaces"
              min={10}
              max={180}
              step={2}
              value={physics.linkDistance}
              display={String(physics.linkDistance)}
              onChange={(linkDistance) => setPhysics((p) => ({ ...p, linkDistance }))}
            />
            <Slider
              label="Fuerza central"
              min={0}
              max={0.5}
              step={0.01}
              value={physics.centerStrength}
              display={physics.centerStrength.toFixed(2)}
              onChange={(centerStrength) => setPhysics((p) => ({ ...p, centerStrength }))}
            />
            <button className="btn sm ghost" onClick={() => setPhysics(DEFAULT_PHYSICS)}>
              Restablecer fuerzas
            </button>
          </div>

          {legend.length > 0 && (
            <div className="group">
              <h2>Carpetas</h2>
              <div className="legend">
                {legend.map(([name, count]) => (
                  <div className="item" key={name}>
                    <span className="swatch" style={{ background: folderColor(name, folderColors) }} />
                    {name}
                    <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{count}</span>
                  </div>
                ))}
                {showPhantoms && (
                  <div className="item">
                    <span className="swatch" style={{ background: '#6a6a74' }} />
                    Sin resolver
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="hint">
            Arrastrá para mover nodos, rueda para el zoom, doble click para abrir la nota.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="slider-label">
        <span>{label}</span>
        <span>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
