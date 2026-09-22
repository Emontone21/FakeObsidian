import { uniqueWikilinks, type LinkedNoteRef, type OutLink } from '@bitacora/shared';
import type { Db } from '../db/index.js';

/**
 * Recalcula los enlaces salientes de una nota a partir de su body.
 * Los [[...]] que no matchean ninguna nota quedan como enlaces no resueltos
 * (nodos fantasma en el grafo) hasta que la nota destino exista.
 */
export function reindexLinks(db: Db, noteId: string, noteTitleKey: string, body: string): void {
  db.prepare('DELETE FROM links WHERE from_note_id = ?').run(noteId);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO links (from_note_id, to_note_id, target_title, target_key) VALUES (?, ?, ?, ?)'
  );
  const resolve = db.prepare('SELECT id FROM notes WHERE title_key = ?');

  for (const link of uniqueWikilinks(body)) {
    // Una nota que se enlaza a si misma no aporta al grafo.
    if (link.targetKey === noteTitleKey) continue;
    const target = resolve.get(link.targetKey) as { id: string } | undefined;
    insert.run(noteId, target?.id ?? null, link.target, link.targetKey);
  }
}

/** Al crear o renombrar una nota, adopta los enlaces fantasma que la apuntaban. */
export function resolveInboundLinks(db: Db, noteId: string, titleKey: string): number {
  const info = db
    .prepare(
      'UPDATE links SET to_note_id = ? WHERE target_key = ? AND to_note_id IS NULL AND from_note_id <> ?'
    )
    .run(noteId, titleKey, noteId);
  return info.changes;
}

/** Al renombrar, los enlaces que apuntaban al titulo viejo dejan de resolver. */
export function unresolveStaleLinks(db: Db, noteId: string, newTitleKey: string): void {
  db.prepare('UPDATE links SET to_note_id = NULL WHERE to_note_id = ? AND target_key <> ?').run(
    noteId,
    newTitleKey
  );
}

export function outLinks(db: Db, noteId: string): OutLink[] {
  const rows = db
    .prepare(
      `SELECT l.target_title AS targetTitle, n.id AS id, n.title AS title, n.folder AS folder
         FROM links l
         LEFT JOIN notes n ON n.id = l.to_note_id
        WHERE l.from_note_id = ?
        ORDER BY l.id`
    )
    .all(noteId) as { targetTitle: string; id: string | null; title: string | null; folder: string | null }[];

  return rows.map((row) => ({
    targetTitle: row.targetTitle,
    note: row.id ? { id: row.id, title: row.title!, folder: row.folder! } : null
  }));
}

export function backLinks(db: Db, noteId: string): LinkedNoteRef[] {
  return db
    .prepare(
      `SELECT n.id AS id, n.title AS title, n.folder AS folder
         FROM links l
         JOIN notes n ON n.id = l.from_note_id
        WHERE l.to_note_id = ?
        ORDER BY n.date DESC, n.title`
    )
    .all(noteId) as LinkedNoteRef[];
}

/** Notas que enlazan a un titulo dado, para reescribir sus bodies al renombrar. */
export function notesLinkingToKey(db: Db, targetKey: string, excludeId: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT from_note_id AS id FROM links WHERE target_key = ? AND from_note_id <> ?')
    .all(targetKey, excludeId) as { id: string }[];
  return rows.map((r) => r.id);
}
