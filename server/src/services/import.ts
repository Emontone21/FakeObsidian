import {
  describeConversation,
  renderTranscript,
  zonedNow,
  type ImportedConversation,
  type ParseResult
} from '@bitacora/shared';
import type { Db } from '../db/index.js';
import { NOTE_COLUMNS, rowToNote, tagsForNote, type NoteRow } from './repo.js';
import { createNote, type Ctx } from './notes.js';

export const IMPORT_FOLDER = 'Importado';
export const IMPORT_TAGS = ['import', 'sin-resumir'];
export const IMPORT_STATUS = 'sin resumir';

export interface ImportedNoteRef {
  id: string;
  title: string;
  conversationId: string | null;
}

export interface SkippedConversation {
  title: string;
  reason: string;
}

export interface ImportReport {
  /** Conversaciones encontradas en el archivo. */
  total: number;
  imported: ImportedNoteRef[];
  skipped: SkippedConversation[];
  warnings: string[];
}

/** Busca una nota ya importada por el id de su conversacion de origen. */
export function findNoteByConversationId(db: Db, conversationId: string) {
  const row = db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE source_conversation_id = ?`)
    .get(conversationId) as NoteRow | undefined;
  return row ? rowToNote(row, tagsForNote(db, row.id)) : null;
}

/** Fecha y hora de la conversacion, en la zona horaria configurada. */
function conversationStamp(conversation: ImportedConversation, timeZone: string): { date: string; time: string } {
  if (!conversation.createdAt) {
    const now = zonedNow(timeZone);
    return { date: now.date, time: now.time };
  }
  const at = new Date(conversation.createdAt);
  if (Number.isNaN(at.getTime())) {
    const now = zonedNow(timeZone);
    return { date: now.date, time: now.time };
  }
  const stamped = zonedNow(timeZone, at);
  return { date: stamped.date, time: stamped.time };
}

export interface ImportOptions {
  folder?: string;
  /** Solo cuenta lo que haria, sin escribir nada. */
  dryRun?: boolean;
}

/**
 * Crea una nota por conversacion en la carpeta Importado.
 * Si el id de la conversacion ya esta en el vault, la saltea: reimportar el
 * mismo archivo no duplica nada.
 */
export function importConversations(ctx: Ctx, parsed: ParseResult, options: ImportOptions = {}): ImportReport {
  const folder = options.folder?.trim() || IMPORT_FOLDER;
  const report: ImportReport = {
    total: parsed.conversations.length,
    imported: [],
    skipped: [],
    warnings: [...parsed.warnings]
  };

  let sinId = 0;

  for (const conversation of parsed.conversations) {
    if (conversation.id && findNoteByConversationId(ctx.db, conversation.id)) {
      report.skipped.push({ title: conversation.title, reason: 'Ya estaba importada.' });
      continue;
    }
    if (!conversation.id) sinId += 1;

    if (options.dryRun) {
      report.imported.push({ id: '', title: conversation.title, conversationId: conversation.id });
      continue;
    }

    const stamp = conversationStamp(conversation, ctx.config.timeZone);
    const result = createNote(ctx, {
      title: conversation.title,
      folder,
      tags: IMPORT_TAGS,
      summary: describeConversation(conversation),
      contexto: '',
      decisiones: [],
      pendientes: [],
      referencias: [],
      notasAdicionales: renderTranscript(conversation, ctx.config.timeZone),
      relacionados: [],
      source: 'import',
      sourceConversationId: conversation.id,
      status: IMPORT_STATUS,
      date: stamp.date,
      time: stamp.time
    });

    report.imported.push({
      id: result.note.id,
      title: result.note.title,
      conversationId: conversation.id
    });
  }

  if (sinId > 0) {
    report.warnings.push(
      `${sinId} conversaciones no traian id, asi que si volves a importar el archivo se van a duplicar.`
    );
  }

  return report;
}
