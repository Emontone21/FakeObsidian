import { parsePendingItems, type PendingItem, type PendingItemWithNote } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { newId } from './ids.js';

interface PendingRow {
  id: string;
  note_id: string;
  position: number;
  line_no: number;
  raw_line: string;
  action: string;
  owner: string | null;
  due_date: string | null;
  done: number;
}

function rowToPending(row: PendingRow): PendingItem {
  return {
    id: row.id,
    noteId: row.note_id,
    position: row.position,
    lineNo: row.line_no,
    rawLine: row.raw_line,
    action: row.action,
    owner: row.owner,
    dueDate: row.due_date,
    done: row.done === 1
  };
}

/**
 * Recalcula los pendientes de una nota desde su body.
 * Reusa el id anterior cuando la accion no cambio, para que un pending_id que
 * un cliente MCP ya vio siga apuntando al mismo item despues de editar la nota.
 */
export function reindexPending(db: Db, noteId: string, body: string): void {
  const previous = db
    .prepare('SELECT id, action_key FROM pending_items WHERE note_id = ? ORDER BY position')
    .all(noteId) as { id: string; action_key: string }[];

  const reusable = new Map<string, string[]>();
  for (const row of previous) {
    const list = reusable.get(row.action_key);
    if (list) list.push(row.id);
    else reusable.set(row.action_key, [row.id]);
  }

  db.prepare('DELETE FROM pending_items WHERE note_id = ?').run(noteId);

  const insert = db.prepare(
    `INSERT INTO pending_items
       (id, note_id, position, line_no, raw_line, action, action_key, owner, due_date, done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  parsePendingItems(body).forEach((item, index) => {
    const id = reusable.get(item.actionKey)?.shift() ?? newId();
    insert.run(
      id,
      noteId,
      index,
      item.lineNo,
      item.rawLine,
      item.action,
      item.actionKey,
      item.owner,
      item.dueDate,
      item.done ? 1 : 0
    );
  });
}

export interface PendingFilter {
  owner?: string | null;
  /** YYYY-MM-DD: solo pendientes con fecha menor o igual. */
  dueBefore?: string | null;
  noteId?: string | null;
  includeDone?: boolean;
  limit?: number;
}

export function listPending(db: Db, filter: PendingFilter = {}): PendingItemWithNote[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filter.includeDone) where.push('p.done = 0');
  if (filter.noteId) {
    where.push('p.note_id = ?');
    params.push(filter.noteId);
  }
  if (filter.owner) {
    where.push('p.owner IS NOT NULL AND lower(p.owner) LIKE lower(?)');
    params.push(`%${filter.owner.replace(/[%_\\]/g, '\\$&')}%`);
  }
  if (filter.dueBefore) {
    where.push('p.due_date IS NOT NULL AND p.due_date <= ?');
    params.push(filter.dueBefore);
  }

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);

  const rows = db
    .prepare(
      `SELECT p.id, p.note_id, p.position, p.line_no, p.raw_line, p.action, p.owner, p.due_date, p.done,
              n.title AS noteTitle, n.folder AS noteFolder
         FROM pending_items p
         JOIN notes n ON n.id = p.note_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.done, p.due_date IS NULL, p.due_date, n.date DESC, p.position
        LIMIT ?`
    )
    .all(...params, limit) as (PendingRow & { noteTitle: string; noteFolder: string })[];

  return rows.map((row) => ({
    ...rowToPending(row),
    noteTitle: row.noteTitle,
    noteFolder: row.noteFolder
  }));
}

export function getPending(db: Db, id: string): PendingItem | null {
  const row = db.prepare('SELECT * FROM pending_items WHERE id = ?').get(id) as PendingRow | undefined;
  return row ? rowToPending(row) : null;
}
