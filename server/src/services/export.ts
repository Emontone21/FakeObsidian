import { renderNoteMarkdown, safeFileName, type Note } from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { NOTE_COLUMNS, rowToNote, tagsForNotes, type NoteRow } from './repo.js';

/** Nombre de archivo estilo Obsidian: "YYYY-MM-DD - Titulo.md". */
export function exportFileName(note: Note): string {
  return `${note.date} - ${safeFileName(note.title)}.md`;
}

export interface ExportedNote {
  /** Ruta relativa dentro del vault, con la carpeta adelante. */
  path: string;
  content: string;
}

export function exportNote(note: Note): ExportedNote {
  return {
    path: `${safeFileName(note.folder)}/${exportFileName(note)}`,
    content: renderNoteMarkdown(note)
  };
}

/** Todas las notas como .md validos para Obsidian (frontmatter + markdown). */
export function exportVault(db: Db): ExportedNote[] {
  const rows = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes ORDER BY folder, date DESC`).all() as NoteRow[];
  const tagsByNote = tagsForNotes(
    db,
    rows.map((r) => r.id)
  );
  return rows.map((row) => exportNote(rowToNote(row, tagsByNote.get(row.id) ?? [])));
}
