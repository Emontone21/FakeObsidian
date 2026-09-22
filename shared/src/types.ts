/** Tipos compartidos entre el servidor MCP, la API REST y (en fase 2) la web. */

export type NoteSource = 'claude' | 'import' | 'manual';

/** Nombre de la seccion de cierre: decisiones cerradas vs. solo analisis. */
export type ClosingSection = 'decisiones' | 'conclusiones';

export interface Note {
  id: string;
  title: string;
  titleKey: string;
  folder: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  source: NoteSource;
  sourceConversationId: string | null;
  sourceUrl: string | null;
  status: string;
  summary: string;
  /** Markdown sin frontmatter y sin el H1: arranca en "## Contexto". Fuente de verdad. */
  body: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface PendingItem {
  id: string;
  noteId: string;
  position: number;
  lineNo: number;
  rawLine: string;
  action: string;
  owner: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  done: boolean;
}

export interface PendingItemWithNote extends PendingItem {
  noteTitle: string;
  noteFolder: string;
}

export interface NoteLink {
  fromNoteId: string;
  toNoteId: string | null;
  targetTitle: string;
  targetKey: string;
}

export interface LinkedNoteRef {
  id: string;
  title: string;
  folder: string;
}

/** Enlace saliente: resuelto (apunta a una nota) o no resuelto (nodo fantasma). */
export interface OutLink {
  targetTitle: string;
  note: LinkedNoteRef | null;
}

export interface PendingInput {
  accion: string;
  responsable?: string | null;
  /** DD/MM/AAAA o YYYY-MM-DD */
  fecha?: string | null;
  hecho?: boolean;
}

export interface SaveNoteInput {
  title: string;
  folder: string;
  tags: string[];
  summary: string;
  contexto: string;
  decisiones: string[];
  pendientes: PendingInput[];
  referencias: string[];
  notasAdicionales?: string | null;
  relacionados: string[];
  tipoSeccion?: ClosingSection;
  sourceUrl?: string | null;
  sourceConversationId?: string | null;
  source?: NoteSource;
  status?: string;
}

export interface UpdateNoteInput {
  title?: string;
  folder?: string;
  tags?: string[];
  summary?: string;
  contexto?: string;
  decisiones?: string[];
  pendientes?: PendingInput[];
  referencias?: string[];
  notasAdicionales?: string | null;
  relacionados?: string[];
  tipoSeccion?: ClosingSection;
  status?: string;
  sourceUrl?: string | null;
  /** Reemplaza el body entero; excluyente con los campos por seccion. */
  bodyMarkdown?: string;
}

export interface SearchHit {
  id: string;
  title: string;
  folder: string;
  date: string;
  tags: string[];
  summary: string;
  score: number;
  snippet: string;
}

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  date: string;
  tags: string[];
  summary: string;
  degree: number;
  /** true para enlaces no resueltos: la nota todavia no existe. */
  phantom?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'wikilink' | 'tag';
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FolderCount {
  name: string;
  noteCount: number;
}

export interface TagCount {
  name: string;
  noteCount: number;
}
