import type { SearchHit } from '@bitacora/shared';
import { normalizeTag } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { tagsForNotes } from './repo.js';

export type SearchSort = 'relevancia' | 'fecha' | 'titulo';

export interface SearchFilter {
  query?: string | null;
  folder?: string | null;
  tags?: string[] | null;
  /** YYYY-MM-DD */
  dateFrom?: string | null;
  /** YYYY-MM-DD */
  dateTo?: string | null;
  limit?: number;
  /** Por defecto: relevancia si hay consulta, fecha si no. */
  sort?: SearchSort | null;
}

/**
 * Traduce lo que escribe el usuario a sintaxis FTS5 segura.
 * Cada palabra va entre comillas (asi los signos no rompen la consulta) y con
 * prefijo *, para que "desviac" encuentre "desviacion".
 */
export function toFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' ');
}

interface HitRow {
  id: string;
  title: string;
  folder: string;
  date: string;
  summary: string;
  rank: number | null;
  snippet: string | null;
}

function buildFilters(filter: SearchFilter): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.folder) {
    clauses.push('n.folder = ?');
    params.push(filter.folder);
  }
  if (filter.dateFrom) {
    clauses.push('n.date >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    clauses.push('n.date <= ?');
    params.push(filter.dateTo);
  }

  const tags = (filter.tags ?? []).map(normalizeTag).filter(Boolean);
  if (tags.length > 0) {
    // La nota tiene que tener todos los tags pedidos, no alguno.
    clauses.push(
      `(SELECT count(DISTINCT t.name)
          FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id AND t.name IN (${tags.map(() => '?').join(', ')})) = ?`
    );
    params.push(...tags, tags.length);
  }

  return { clauses, params };
}

function decorate(db: Db, rows: HitRow[]): SearchHit[] {
  const tagsByNote = tagsForNotes(
    db,
    rows.map((r) => r.id)
  );

  // bm25 devuelve negativos muy chicos (del orden de 1e-6), inservibles como numero
  // suelto. Se expone la relevancia relativa a la mejor coincidencia: 100 = la mejor.
  const ranks = rows.map((r) => r.rank).filter((r): r is number => r !== null);
  const best = ranks.length > 0 ? Math.min(...ranks) : 0;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    folder: row.folder,
    date: row.date,
    tags: tagsByNote.get(row.id) ?? [],
    summary: row.summary,
    score: row.rank === null || best === 0 ? 0 : Math.round((row.rank / best) * 1000) / 10,
    snippet: row.snippet ?? row.summary
  }));
}
/** Clausula ORDER BY segun el criterio pedido. "rank" solo existe en la consulta FTS. */
function orderBy(sort: SearchSort, hasRank: boolean): string {
  if (sort === 'titulo') return 'n.title COLLATE NOCASE';
  if (sort === 'fecha' || !hasRank) return 'n.date DESC, n.id DESC';
  return 'rank';
}

export function searchNotes(db: Db, filter: SearchFilter = {}): SearchHit[] {
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 500);
  const { clauses, params } = buildFilters(filter);
  const match = filter.query ? toFtsQuery(filter.query) : null;
  const sort: SearchSort = filter.sort ?? (match ? 'relevancia' : 'fecha');

  if (!match) {
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT n.id, n.title, n.folder, n.date, n.summary, NULL AS rank, NULL AS snippet
           FROM notes n
           ${where}
          ORDER BY ${orderBy(sort, false)}
          LIMIT ?`
      )
      .all(...params, limit) as HitRow[];
    return decorate(db, rows);
  }

  const where = ['notes_fts MATCH ?', ...clauses].join(' AND ');
  const sql = `SELECT n.id, n.title, n.folder, n.date, n.summary,
                      bm25(notes_fts, 10.0, 5.0, 1.0) AS rank,
                      snippet(notes_fts, 2, '[', ']', '\u2026', 14) AS snippet
                 FROM notes_fts
                 JOIN notes n ON n.rowid = notes_fts.rowid
                WHERE ${where}
                ORDER BY ${orderBy(sort, true)}
                LIMIT ?`;

  try {
    return decorate(db, db.prepare(sql).all(match, ...params, limit) as HitRow[]);
  } catch {
    // Si FTS5 rechaza la consulta igual devolvemos algo util en vez de fallar.
    const like = `%${filter.query!.replace(/[%_\\]/g, '\\$&')}%`;
    const fallbackWhere = ["(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')", ...clauses].join(' AND ');
    const rows = db
      .prepare(
        `SELECT n.id, n.title, n.folder, n.date, n.summary, NULL AS rank, NULL AS snippet
           FROM notes n
          WHERE ${fallbackWhere}
          ORDER BY ${orderBy(sort, false)}
          LIMIT ?`
      )
      .all(like, like, ...params, limit) as HitRow[];
    return decorate(db, rows);
  }
}

/** Cuantas notas matchean los filtros, ignorando el limite: la UI muestra "N de M". */
export function countNotes(db: Db, filter: SearchFilter = {}): number {
  const { clauses, params } = buildFilters(filter);
  const match = filter.query ? toFtsQuery(filter.query) : null;

  if (!match) {
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const row = db.prepare(`SELECT count(*) AS total FROM notes n ${where}`).get(...params) as { total: number };
    return row.total;
  }

  try {
    const where = ['notes_fts MATCH ?', ...clauses].join(' AND ');
    const row = db
      .prepare(
        `SELECT count(*) AS total FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid WHERE ${where}`
      )
      .get(match, ...params) as { total: number };
    return row.total;
  } catch {
    return searchNotes(db, { ...filter, limit: 500 }).length;
  }
}
