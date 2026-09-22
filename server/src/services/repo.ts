import type { Note, NoteSource } from '@bitacora/shared';
import type { Db } from '../db/index.js';

export interface NoteRow {
  id: string;
  title: string;
  title_key: string;
  folder: string;
  date: string;
  time: string;
  source: string;
  source_conversation_id: string | null;
  source_url: string | null;
  status: string;
  summary: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export const NOTE_COLUMNS = `
  id, title, title_key, folder, date, time, source,
  source_conversation_id, source_url, status, summary, body, created_at, updated_at
`;

export function rowToNote(row: NoteRow, tags: string[] = []): Note {
  return {
    id: row.id,
    title: row.title,
    titleKey: row.title_key,
    folder: row.folder,
    date: row.date,
    time: row.time,
    source: row.source as NoteSource,
    sourceConversationId: row.source_conversation_id,
    sourceUrl: row.source_url,
    status: row.status,
    summary: row.summary,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags
  };
}

/** Tags de varias notas en una sola consulta, para no hacer N+1. */
export function tagsForNotes(db: Db, noteIds: readonly string[]): Map<string, string[]> {
  const byNote = new Map<string, string[]>();
  if (noteIds.length === 0) return byNote;

  const placeholders = noteIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT nt.note_id AS note_id, t.name AS name
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id IN (${placeholders})
        ORDER BY nt.note_id, nt.position`
    )
    .all(...noteIds) as { note_id: string; name: string }[];

  for (const row of rows) {
    const list = byNote.get(row.note_id);
    if (list) list.push(row.name);
    else byNote.set(row.note_id, [row.name]);
  }
  return byNote;
}

export function tagsForNote(db: Db, noteId: string): string[] {
  return tagsForNotes(db, [noteId]).get(noteId) ?? [];
}
