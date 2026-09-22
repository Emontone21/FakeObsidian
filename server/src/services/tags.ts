import { normalizeTag, normalizeTagList, type TagCount } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { BitacoraError } from './errors.js';

export function listTags(db: Db, prefix?: string): TagCount[] {
  const clean = prefix ? normalizeTag(prefix) : '';
  const where = clean ? 'WHERE t.name LIKE ? ESCAPE \'\\\'' : '';
  const params = clean ? [`${clean.replace(/[%_\\]/g, '\\$&')}%`] : [];
  return db
    .prepare(
      `SELECT t.name AS name, count(nt.note_id) AS noteCount
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         ${where}
        GROUP BY t.id
        ORDER BY noteCount DESC, t.name`
    )
    .all(...params) as TagCount[];
}

function tagId(db: Db, name: string): number {
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

/** Reemplaza los tags de una nota conservando el orden recibido. */
export function setNoteTags(db: Db, noteId: string, tags: readonly string[]): string[] {
  const normalized = normalizeTagList(tags);
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insert = db.prepare('INSERT INTO note_tags (note_id, tag_id, position) VALUES (?, ?, ?)');
  normalized.forEach((tag, index) => insert.run(noteId, tagId(db, tag), index));
  pruneOrphanTags(db);
  return normalized;
}

/** Borra los tags que ya no usa ninguna nota. */
export function pruneOrphanTags(db: Db): void {
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)').run();
}

/**
 * Renombra un tag. Si el destino ya existe, fusiona: las notas del tag viejo
 * pasan a tener el nuevo sin duplicarse.
 */
export function renameTag(db: Db, from: string, to: string): string {
  const fromName = normalizeTag(from);
  const toName = normalizeTag(to);
  if (!toName) throw new BitacoraError('INVALID_INPUT', 'El tag destino queda vacio al normalizarlo.');
  if (fromName === toName) return toName;

  db.transaction(() => {
    const source = db.prepare('SELECT id FROM tags WHERE name = ?').get(fromName) as { id: number } | undefined;
    if (!source) throw new BitacoraError('NOT_FOUND', `No existe el tag "${fromName}".`);
    const target = db.prepare('SELECT id FROM tags WHERE name = ?').get(toName) as { id: number } | undefined;

    if (!target) {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(toName, source.id);
      return;
    }

    db.prepare(
      `INSERT OR IGNORE INTO note_tags (note_id, tag_id, position)
       SELECT note_id, ?, position FROM note_tags WHERE tag_id = ?`
    ).run(target.id, source.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(source.id);
  })();

  return toName;
}
