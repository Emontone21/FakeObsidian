import type {
  FolderCount,
  Graph,
  LinkedNoteRef,
  Note,
  OutLink,
  PendingItem,
  PendingItemWithNote,
  SearchHit,
  TagCount
} from '@bitacora/shared';

export type { FolderCount, Graph, LinkedNoteRef, Note, OutLink, PendingItemWithNote, SearchHit, TagCount };

export interface NoteDetail {
  note: Note;
  markdown: string;
  url: string;
  outlinks: OutLink[];
  backlinks: LinkedNoteRef[];
  pending: PendingItem[];
}

export interface NotesResponse {
  resultados: SearchHit[];
  total: number;
}

export interface Status {
  version: string;
  dbPath: string;
  timeZone: string;
  webBaseUrl: string;
  notas: number;
  carpetas: number;
  tags: number;
  enlaces: number;
  enlacesSinResolver: number;
  pendientesAbiertos: number;
  conectorRemoto: { habilitado: boolean; estado: string };
  resumidor: { habilitado: boolean; estado: string };
}

export interface ImportReport {
  total: number;
  imported: { id: string; title: string; conversationId: string | null }[];
  skipped: { title: string; reason: string }[];
  warnings: string[];
  archivo: string;
  dryRun: boolean;
}

export interface SummarizeResult {
  noteId: string;
  title: string;
  avisos: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Se dispara ante un 401 para que la app vuelva al login sin recargar. */
export const UNAUTHORIZED_EVENT = 'bitacora:unauthorized';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    credentials: 'same-origin'
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(401, 'Sesion vencida.');
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Error ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

const body = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });

function qs(params: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface NotesQuery {
  query?: string;
  folder?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  sort?: 'relevancia' | 'fecha' | 'titulo';
  limit?: number;
}

export interface GraphQuery {
  include_tags?: boolean;
  include_phantoms?: boolean;
  folder?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
}

export const api = {
  session: () => request<{ authenticated: boolean; needsSetup: boolean }>('/auth/session'),
  setup: (password: string) => request('/auth/setup', { method: 'POST', ...body({ password }) }),
  login: (password: string) => request('/auth/login', { method: 'POST', ...body({ password }) }),
  logout: () => request('/auth/logout', { method: 'POST', ...body({}) }),
  changePassword: (current: string, next: string) =>
    request('/auth/password', { method: 'POST', ...body({ current, next }) }),

  folders: () => request<{ carpetas: FolderCount[] }>('/folders'),
  createFolder: (name: string) => request<{ created: boolean }>('/folders', { method: 'POST', ...body({ name }) }),
  renameFolder: (from: string, name: string) =>
    request(`/folders/${encodeURIComponent(from)}`, { method: 'PATCH', ...body({ name }) }),
  deleteFolder: (name: string, moveTo: string) =>
    request(`/folders/${encodeURIComponent(name)}${qs({ moveTo })}`, { method: 'DELETE' }),

  tags: (prefix?: string) => request<{ tags: TagCount[] }>(`/tags${qs({ prefix })}`),
  renameTag: (from: string, name: string) =>
    request<{ name: string }>(`/tags/${encodeURIComponent(from)}`, { method: 'PATCH', ...body({ name }) }),

  notes: (query: NotesQuery = {}) => request<NotesResponse>(`/notes${qs({ ...query })}`),
  note: (id: string) => request<NoteDetail>(`/notes/${encodeURIComponent(id)}`),
  createNote: (data: Record<string, unknown>) =>
    request<{ note: Note; url: string }>('/notes', { method: 'POST', ...body(data) }),
  updateNote: (id: string, data: Record<string, unknown>) =>
    request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, { method: 'PATCH', ...body(data) }),
  deleteNote: (id: string) => request<{ deleted: string }>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  pending: (params: { owner?: string; due_before?: string; note_id?: string; include_done?: boolean } = {}) =>
    request<{ pendientes: PendingItemWithNote[] }>(`/pending${qs({ ...params })}`),
  setPendingDone: (id: string, done: boolean) =>
    request<{ changed: boolean }>(`/pending/${encodeURIComponent(id)}/done`, { method: 'POST', ...body({ done }) }),

  graph: (query: GraphQuery = {}) => request<Graph>(`/graph${qs({ ...query })}`),
  localGraph: (id: string, depth: number, query: GraphQuery = {}) =>
    request<Graph>(`/graph/${encodeURIComponent(id)}${qs({ ...query, depth })}`),

  status: () => request<Status>('/status'),

  /** Sube el zip (o el conversations.json) del export de claude.ai. */
  importExport: (file: File, options: { dryRun?: boolean; folder?: string } = {}) =>
    request<ImportReport>(`/import${qs({ dry_run: options.dryRun, folder: options.folder })}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': 'application/octet-stream' }
    }),

  summarizeNote: (id: string) =>
    request<SummarizeResult>(`/notes/${encodeURIComponent(id)}/summarize`, { method: 'POST' })
};
