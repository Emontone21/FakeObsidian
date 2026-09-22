import type { FolderCount } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { BitacoraError, notFound } from './errors.js';

export function listFolders(db: Db): FolderCount[] {
  return db
    .prepare(
      `SELECT f.name AS name, count(n.id) AS noteCount
         FROM folders f
         LEFT JOIN notes n ON n.folder = f.name
        GROUP BY f.name
        ORDER BY f.position, f.name`
    )
    .all() as FolderCount[];
}

export function folderExists(db: Db, name: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM folders WHERE name = ?').get(name) as { ok: number } | undefined;
  return row !== undefined;
}

/** Crea la carpeta si no existe. Devuelve true si la creo en esta llamada. */
export function ensureFolder(db: Db, name: string, now: string): boolean {
  const clean = name.trim();
  if (!clean) throw new BitacoraError('INVALID_INPUT', 'El nombre de la carpeta no puede estar vacio.');
  if (folderExists(db, clean)) return false;
  const next = db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM folders').get() as { p: number };
  db.prepare('INSERT INTO folders (name, position, created_at) VALUES (?, ?, ?)').run(clean, next.p, now);
  return true;
}

export function renameFolder(db: Db, from: string, to: string): void {
  const clean = to.trim();
  if (!clean) throw new BitacoraError('INVALID_INPUT', 'El nombre de la carpeta no puede estar vacio.');
  if (!folderExists(db, from)) throw notFound(`No existe la carpeta "${from}".`);
  if (from === clean) return;
  if (folderExists(db, clean)) {
    // Fusion: las notas se mudan y la carpeta vieja desaparece.
    db.transaction(() => {
      db.prepare('UPDATE notes SET folder = ? WHERE folder = ?').run(clean, from);
      db.prepare('DELETE FROM folders WHERE name = ?').run(from);
    })();
    return;
  }
  // ON UPDATE CASCADE mueve las notas solo.
  db.prepare('UPDATE folders SET name = ? WHERE name = ?').run(clean, from);
}

/** Borra una carpeta y manda sus notas a `moveTo`. */
export function deleteFolder(db: Db, name: string, moveTo: string): void {
  if (!folderExists(db, name)) throw notFound(`No existe la carpeta "${name}".`);
  if (!folderExists(db, moveTo)) throw notFound(`No existe la carpeta destino "${moveTo}".`);
  if (name === moveTo) throw new BitacoraError('INVALID_INPUT', 'La carpeta destino debe ser distinta.');
  db.transaction(() => {
    db.prepare('UPDATE notes SET folder = ? WHERE folder = ?').run(moveTo, name);
    db.prepare('DELETE FROM folders WHERE name = ?').run(name);
  })();
}
