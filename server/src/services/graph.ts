import { normalizeTag, type Graph, type GraphEdge, type GraphNode } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { notFound } from './errors.js';
import { tagsForNotes } from './repo.js';

export interface GraphOptions {
  /** Suma los tags como nodos propios, conectados a las notas que los usan. */
  includeTags?: boolean;
  /** Suma los [[...]] sin resolver como nodos fantasma. */
  includePhantoms?: boolean;
  folder?: string | null;
  tags?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

interface NodeRow {
  id: string;
  title: string;
  folder: string;
  date: string;
  summary: string;
}

export const PHANTOM_PREFIX = 'phantom:';
export const TAG_PREFIX = 'tag:';

function toNodes(db: Db, rows: NodeRow[], degrees: Map<string, number>): GraphNode[] {
  const tagsByNote = tagsForNotes(
    db,
    rows.map((r) => r.id)
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    folder: row.folder,
    date: row.date,
    summary: row.summary,
    tags: tagsByNote.get(row.id) ?? [],
    degree: degrees.get(row.id) ?? 0
  }));
}

function degreeMap(db: Db, ids: readonly string[]): Map<string, number> {
  const degrees = new Map<string, number>();
  if (ids.length === 0) return degrees;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, sum(c) AS degree FROM (
         SELECT from_note_id AS id, count(*) AS c FROM links WHERE from_note_id IN (${placeholders}) GROUP BY from_note_id
         UNION ALL
         SELECT to_note_id AS id, count(*) AS c FROM links WHERE to_note_id IN (${placeholders}) GROUP BY to_note_id
       ) GROUP BY id`
    )
    .all(...ids, ...ids) as { id: string; degree: number }[];
  for (const row of rows) degrees.set(row.id, row.degree);
  return degrees;
}

/** Vecinos directos de una nota, en los dos sentidos del enlace. */
function neighborsOf(db: Db, noteId: string): string[] {
  const rows = db
    .prepare(
      `SELECT to_note_id AS id FROM links WHERE from_note_id = ? AND to_note_id IS NOT NULL
       UNION
       SELECT from_note_id AS id FROM links WHERE to_note_id = ?`
    )
    .all(noteId, noteId) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Nodos y aristas alrededor de una nota, hasta la profundidad pedida. */
export function getNeighborhood(db: Db, noteId: string, depth = 1, options: GraphOptions = {}): Graph {
  const root = db.prepare('SELECT id, title, folder, date, summary FROM notes WHERE id = ?').get(noteId) as
    | NodeRow
    | undefined;
  if (!root) throw notFound(`No existe la nota "${noteId}".`);

  const included = new Set<string>([noteId]);
  let frontier = [noteId];
  const maxDepth = Math.min(Math.max(depth, 0), 4);

  for (let level = 0; level < maxDepth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of neighborsOf(db, id)) {
        if (included.has(neighbor)) continue;
        included.add(neighbor);
        next.push(neighbor);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  const ids = [...included];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id, title, folder, date, summary FROM notes WHERE id IN (${placeholders})`)
    .all(...ids) as NodeRow[];

  const nodes = toNodes(db, rows, degreeMap(db, ids));
  const edges: GraphEdge[] = (
    db
      .prepare(
        `SELECT from_note_id AS source, to_note_id AS target
           FROM links
          WHERE from_note_id IN (${placeholders}) AND to_note_id IN (${placeholders})`
      )
      .all(...ids, ...ids) as { source: string; target: string }[]
  ).map((row) => ({ ...row, kind: 'wikilink' as const }));

  if (options.includePhantoms) {
    const phantoms = db
      .prepare(
        `SELECT DISTINCT from_note_id AS source, target_title, target_key
           FROM links
          WHERE from_note_id IN (${placeholders}) AND to_note_id IS NULL`
      )
      .all(...ids) as { source: string; target_title: string; target_key: string }[];

    const seen = new Set<string>();
    for (const row of phantoms) {
      const id = `${PHANTOM_PREFIX}${row.target_key}`;
      if (!seen.has(id)) {
        seen.add(id);
        nodes.push({
          id,
          title: row.target_title,
          folder: '',
          date: '',
          summary: 'Enlace sin resolver: la nota todavia no existe.',
          tags: [],
          degree: 1,
          phantom: true
        });
      }
      edges.push({ source: row.source, target: id, kind: 'wikilink' });
    }
  }

  return { nodes, edges };
}

/** Grafo completo del vault, con los filtros de la vista /grafo. */
export function getFullGraph(db: Db, options: GraphOptions = {}): Graph {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.folder) {
    clauses.push('n.folder = ?');
    params.push(options.folder);
  }
  if (options.dateFrom) {
    clauses.push('n.date >= ?');
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    clauses.push('n.date <= ?');
    params.push(options.dateTo);
  }
  const tags = (options.tags ?? []).map(normalizeTag).filter(Boolean);
  if (tags.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = n.id AND t.name IN (${tags.map(() => '?').join(', ')}))`
    );
    params.push(...tags);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT n.id, n.title, n.folder, n.date, n.summary FROM notes n ${where} ORDER BY n.date DESC`)
    .all(...params) as NodeRow[];

  const ids = rows.map((r) => r.id);
  const visible = new Set(ids);
  const nodes = toNodes(db, rows, degreeMap(db, ids));
  const edges: GraphEdge[] = [];

  const links = db
    .prepare('SELECT from_note_id AS source, to_note_id AS target, target_title, target_key FROM links')
    .all() as { source: string; target: string | null; target_title: string; target_key: string }[];

  const phantomSeen = new Set<string>();
  for (const link of links) {
    if (!visible.has(link.source)) continue;
    if (link.target) {
      if (visible.has(link.target)) edges.push({ source: link.source, target: link.target, kind: 'wikilink' });
      continue;
    }
    if (!options.includePhantoms) continue;
    const id = `${PHANTOM_PREFIX}${link.target_key}`;
    if (!phantomSeen.has(id)) {
      phantomSeen.add(id);
      nodes.push({
        id,
        title: link.target_title,
        folder: '',
        date: '',
        summary: 'Enlace sin resolver: la nota todavia no existe.',
        tags: [],
        degree: 1,
        phantom: true
      });
    }
    edges.push({ source: link.source, target: id, kind: 'wikilink' });
  }

  if (options.includeTags) {
    const tagRows = db
      .prepare(
        `SELECT t.name AS name, nt.note_id AS noteId
           FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
          ORDER BY t.name`
      )
      .all() as { name: string; noteId: string }[];

    const tagSeen = new Map<string, number>();
    for (const row of tagRows) {
      if (!visible.has(row.noteId)) continue;
      const id = `${TAG_PREFIX}${row.name}`;
      tagSeen.set(id, (tagSeen.get(id) ?? 0) + 1);
      edges.push({ source: row.noteId, target: id, kind: 'tag' });
    }
    for (const [id, degree] of tagSeen) {
      nodes.push({
        id,
        title: `#${id.slice(TAG_PREFIX.length)}`,
        folder: '',
        date: '',
        summary: `Tag usado en ${degree} nota(s).`,
        tags: [],
        degree
      });
    }
  }

  return { nodes, edges };
}
