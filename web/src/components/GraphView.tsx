import type { GraphEdge, GraphNode } from '@bitacora/shared';
import { forceCollide } from 'd3-force';
import ForceGraph, { type LinkObject } from 'force-graph';
import { useEffect, useMemo, useRef } from 'react';

/** Paleta estable por carpeta: el mismo nombre siempre da el mismo color. */
const PALETTE = [
  '#a882ff',
  '#5fbf80',
  '#e0a458',
  '#5fa8d3',
  '#e5645f',
  '#4ecdc4',
  '#f78fb3',
  '#9bc53d',
  '#f4a261',
  '#7d8cc4'
];

const PHANTOM_COLOR = '#6a6a74';

/** Debajo de este zoom las etiquetas se ocultan para que no se superpongan. */
const LABEL_MIN_SCALE = 0.55;
const TAG_COLOR = '#8f7fbf';

/**
 * Asigna un color por carpeta segun su posicion en la lista.
 * Un hash daria colisiones (dos carpetas del mismo color); por indice, mientras
 * haya hasta diez carpetas, todas quedan distintas.
 */
export function buildFolderColors(folders: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  folders.forEach((name, index) => map.set(name, PALETTE[index % PALETTE.length]!));
  return map;
}

export function folderColor(folder: string, colors?: Map<string, string>): string {
  if (!folder) return PHANTOM_COLOR;
  const assigned = colors?.get(folder);
  if (assigned) return assigned;
  // Sin mapa (o carpeta nueva todavia no listada) caemos a un hash estable.
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = (hash * 31 + folder.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

export function nodeColor(node: GraphNode, colors?: Map<string, string>): string {
  if (node.phantom) return PHANTOM_COLOR;
  if (node.id.startsWith('tag:')) return TAG_COLOR;
  return folderColor(node.folder, colors);
}

function radiusOf(node: GraphNode): number {
  return Math.max(3, Math.min(13, 3 + Math.sqrt(node.degree) * 2.1));
}

export interface PhysicsSettings {
  /** Repulsion entre nodos: mas negativo, mas separados. */
  charge: number;
  linkDistance: number;
  centerStrength: number;
}

export const DEFAULT_PHYSICS: PhysicsSettings = { charge: -160, linkDistance: 42, centerStrength: 0.06 };

interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  physics?: PhysicsSettings;
  /** Ids resaltados por el buscador. */
  highlight?: Set<string>;
  /** Nodo central: se dibuja con un anillo. */
  focusId?: string | null;
  onSelect?: (node: GraphNode | null) => void;
  onOpen?: (node: GraphNode) => void;
  /** Se llama con la instancia para poder recentrar desde afuera. */
  onReady?: (controls: { recenter: () => void }) => void;
  /** Color por carpeta, para que coincida con la leyenda y las tarjetas. */
  colors?: Map<string, string>;
}

interface SimNode extends GraphNode {
  x?: number;
  y?: number;
}

/** force-graph reemplaza source/target por el nodo resuelto una vez montado. */
interface SimLink extends LinkObject<SimNode> {
  kind: GraphEdge['kind'];
}

export function GraphView({
  nodes,
  edges,
  physics = DEFAULT_PHYSICS,
  highlight,
  focusId,
  onSelect,
  onOpen,
  onReady,
  colors
}: GraphViewProps) {
  const holder = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph<SimNode, SimLink> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // El hover se guarda fuera de React: cambiarlo no debe re-renderizar el arbol.
  const hoveredRef = useRef<string | null>(null);
  const relatedRef = useRef<Set<string>>(new Set());
  const highlightRef = useRef<Set<string> | undefined>(highlight);
  const focusRef = useRef<string | null | undefined>(focusId);
  const colorsRef = useRef<Map<string, string> | undefined>(colors);
  // zoomToFit se dispara una vez por cada conjunto de datos, al frenar la fisica.
  const fitPendingRef = useRef(true);
  highlightRef.current = highlight;
  focusRef.current = focusId;
  colorsRef.current = colors;

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [edges]);
  const adjacencyRef = useRef(adjacency);
  adjacencyRef.current = adjacency;

  // Se crea una sola vez: force-graph guarda las posiciones dentro de los nodos.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const graph = new ForceGraph<SimNode, SimLink>(element)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeLabel(() => '')
      .enableNodeDrag(true)
      // El resaltado de vecinos se dibuja en cada cuadro, asi que no pausamos el loop.
      .autoPauseRedraw(false)
      .linkColor((link: SimLink) => {
        const hovered = hoveredRef.current;
        const active =
          hovered !== null && (sourceId(link) === hovered || targetId(link) === hovered);
        if (active) return 'rgba(168,130,255,0.85)';
        if (hovered !== null) return 'rgba(130,130,145,0.10)';
        return link.kind === 'tag' ? 'rgba(143,127,191,0.22)' : 'rgba(130,130,145,0.34)';
      })
      .linkWidth((link: SimLink) => {
        const hovered = hoveredRef.current;
        return hovered !== null && (sourceId(link) === hovered || targetId(link) === hovered) ? 2 : 1;
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const data = node as SimNode;
        const hovered = hoveredRef.current;
        const dimmed = hovered !== null && !relatedRef.current.has(data.id);
        const searched = highlightRef.current?.has(data.id) ?? false;
        const radius = radiusOf(data);

        ctx.save();
        ctx.globalAlpha = dimmed ? 0.13 : 1;

        ctx.beginPath();
        ctx.arc(data.x ?? 0, data.y ?? 0, radius, 0, 2 * Math.PI);
        ctx.fillStyle = nodeColor(data, colorsRef.current);
        ctx.fill();

        if (data.phantom) {
          ctx.lineWidth = 1.2 / globalScale;
          ctx.strokeStyle = 'rgba(200,200,210,0.5)';
          ctx.setLineDash([2 / globalScale, 2 / globalScale]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (searched || data.id === focusRef.current) {
          ctx.lineWidth = 2.4 / globalScale;
          ctx.strokeStyle = searched ? '#ffd166' : '#ffffff';
          ctx.beginPath();
          ctx.arc(data.x ?? 0, data.y ?? 0, radius + 2.5 / globalScale, 0, 2 * Math.PI);
          ctx.stroke();
        }

        // La etiqueta aparece al acercarse o al pasar el mouse, como en Obsidian.
        // Con miles de nodos el encuadre deja un globalScale chico y quedan ocultas,
        // que es justo lo que se quiere para que no se pisen entre si.
        if (globalScale > LABEL_MIN_SCALE || data.id === hovered || searched) {
          // Dividir por la escala mantiene el texto a 12 px en pantalla a cualquier zoom.
          const fontSize = 12 / globalScale;
          ctx.font = `${fontSize}px -apple-system, Segoe UI, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = dimmed ? 'rgba(160,160,170,0.35)' : 'rgba(225,226,232,0.92)';
          const label = data.title.length > 34 ? `${data.title.slice(0, 33)}…` : data.title;
          ctx.fillText(label, data.x ?? 0, (data.y ?? 0) + radius + 2 / globalScale);
        }

        ctx.restore();
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        const data = node as SimNode;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(data.x ?? 0, data.y ?? 0, radiusOf(data) + 3, 0, 2 * Math.PI);
        ctx.fill();
      })
      .onNodeHover((node) => {
        const data = node as SimNode | null;
        hoveredRef.current = data?.id ?? null;
        relatedRef.current = data
          ? new Set([data.id, ...(adjacencyRef.current.get(data.id) ?? [])])
          : new Set();

        const tooltip = tooltipRef.current;
        if (tooltip) {
          if (data) {
            tooltip.style.display = 'block';
            tooltip.innerHTML = '';
            const title = document.createElement('strong');
            title.textContent = data.title;
            const detail = document.createElement('span');
            detail.textContent = data.phantom
              ? 'Enlace sin resolver'
              : [data.folder, data.date, data.summary].filter(Boolean).join(' · ');
            tooltip.append(title, detail);
          } else {
            tooltip.style.display = 'none';
          }
        }
        element.style.cursor = data ? 'pointer' : 'default';
      })
      .onNodeClick((node) => onSelectRef.current?.(node as SimNode))
      .onBackgroundClick(() => onSelectRef.current?.(null))
      .onNodeDrag((node) => {
        // Al soltar queda fijo donde lo dejaste, igual que en Obsidian.
        const data = node as SimNode & { fx?: number; fy?: number };
        data.fx = data.x;
        data.fy = data.y;
      })
      .onEngineStop(() => {
        // Encuadrar recien cuando la simulacion se asento: hacerlo antes deja
        // nodos fuera de pantalla porque el layout todavia se esta expandiendo.
        if (!fitPendingRef.current) return;
        fitPendingRef.current = false;
        graph.zoomToFit(400, 90);
      });

    // Doble click: abrir la nota. force-graph no lo expone, va sobre el contenedor.
    const onDoubleClick = () => {
      const hovered = hoveredRef.current;
      if (!hovered) return;
      const node = graph.graphData().nodes.find((n) => n.id === hovered);
      if (node) onOpenRef.current?.(node as SimNode);
    };
    element.addEventListener('dblclick', onDoubleClick);

    const onMouseMove = (event: MouseEvent) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || tooltip.style.display === 'none') return;
      const bounds = element.getBoundingClientRect();
      tooltip.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 290)}px`;
      tooltip.style.top = `${event.clientY - bounds.top + 14}px`;
    };
    element.addEventListener('mousemove', onMouseMove);

    const resize = new ResizeObserver(() => {
      graph.width(element.clientWidth).height(element.clientHeight);
    });
    resize.observe(element);
    graph.width(element.clientWidth).height(element.clientHeight);

    // Sin colision los nodos se enciman y las etiquetas quedan ilegibles.
    graph.d3Force('collide', forceCollide<SimNode>((node) => radiusOf(node) + 6));

    graphRef.current = graph;
    onReadyRef.current?.({ recenter: () => graph.zoomToFit(400, 90) });

    return () => {
      resize.disconnect();
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('mousemove', onMouseMove);
      graph._destructor();
      graphRef.current = null;
    };
  }, []);

  // Callbacks por ref: cambiarlos no debe recrear el grafo.
  const onSelectRef = useRef(onSelect);
  const onOpenRef = useRef(onOpen);
  const onReadyRef = useRef(onReady);
  onSelectRef.current = onSelect;
  onOpenRef.current = onOpen;
  onReadyRef.current = onReady;

  // Los datos se reemplazan solo cuando cambia el conjunto de nodos o aristas.
  const signature = useMemo(
    () => `${nodes.map((n) => n.id).join('|')}#${edges.map((e) => `${e.source}>${e.target}`).join('|')}`,
    [nodes, edges]
  );

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const present = new Set(nodes.map((n) => n.id));
    fitPendingRef.current = true;
    graph.graphData({
      // Copias propias: force-graph les escribe x/y/vx/vy encima.
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.filter((e) => present.has(e.source) && present.has(e.target)).map((e) => ({ ...e }))
    });
    // Red de seguridad por si onEngineStop tarda en llegar (grafos muy grandes).
    const timer = setTimeout(() => {
      if (!fitPendingRef.current) return;
      fitPendingRef.current = false;
      graph.zoomToFit(400, 90);
    }, 4000);
    return () => clearTimeout(timer);
  }, [signature]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    (graph.d3Force('charge') as { strength(v: number): unknown } | undefined)?.strength(physics.charge);
    (graph.d3Force('link') as { distance(v: number): unknown } | undefined)?.distance(physics.linkDistance);
    (graph.d3Force('center') as { strength(v: number): unknown } | undefined)?.strength(physics.centerStrength);
    graph.d3ReheatSimulation();
  }, [physics.charge, physics.linkDistance, physics.centerStrength]);

  return (
    <div className="graph-canvas" ref={holder}>
      <div className="graph-tooltip" ref={tooltipRef} style={{ display: 'none' }} />
    </div>
  );
}

function endpointId(endpoint: SimLink['source']): string {
  if (typeof endpoint === 'string') return endpoint;
  if (typeof endpoint === 'number') return String(endpoint);
  return endpoint?.id ?? '';
}

function sourceId(link: SimLink): string {
  return endpointId(link.source);
}

function targetId(link: SimLink): string {
  return endpointId(link.target);
}
