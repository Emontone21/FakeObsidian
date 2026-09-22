import {
  appendToSection,
  listSectionNames,
  normalizeTagList,
  parsePendingItems,
  renameSection,
  renderBulletList,
  renderNoteBody,
  renderParagraph,
  renderPendingList,
  renderRelatedList,
  replaceSection,
  replaceWikilinkTarget,
  setPendingLineDone,
  titleKey,
  toWikilink,
  uniqueWikilinks,
  zonedNow,
  SECTION_CONCLUSIONES,
  SECTION_CONTEXTO,
  SECTION_DECISIONES,
  SECTION_NOTAS_ADICIONALES,
  SECTION_PENDIENTES,
  SECTION_REFERENCIAS,
  SECTION_RELACIONADO,
  type Note,
  type PendingItem,
  type SaveNoteInput,
  type UpdateNoteInput
} from '@bitacora/shared';
import type { Config } from '../config.js';
import { writeTransaction, type Db } from '../db/index.js';
import { BitacoraError, invalidInput, notFound } from './errors.js';
import { newId } from './ids.js';
import { ensureFolder } from './folders.js';
import {
  notesLinkingToKey,
  reindexLinks,
  resolveInboundLinks,
  unresolveStaleLinks
} from './links.js';
import { getPending, reindexPending } from './pending.js';
import { NOTE_COLUMNS, rowToNote, tagsForNote, type NoteRow } from './repo.js';
import { pruneOrphanTags, setNoteTags } from './tags.js';

export interface Ctx {
  db: Db;
  config: Config;
}

function stamp(ctx: Ctx) {
  return zonedNow(ctx.config.timeZone);
}

export function noteUrl(config: Config, id: string): string {
  return `${config.webBaseUrl}/nota/${id}`;
}

function selectRow(db: Db, id: string): NoteRow | undefined {
  return db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`).get(id) as NoteRow | undefined;
}

export function getNoteById(db: Db, id: string): Note | null {
  const row = selectRow(db, id);
  return row ? rowToNote(row, tagsForNote(db, row.id)) : null;
}

export function getNoteByTitle(db: Db, title: string): Note | null {
  const row = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE title_key = ?`).get(titleKey(title)) as
    | NoteRow
    | undefined;
  return row ? rowToNote(row, tagsForNote(db, row.id)) : null;
}

/** Busca por id y, si no encuentra, por titulo. Es lo que usa get_note. */
export function findNote(db: Db, idOrTitle: string): Note | null {
  return getNoteById(db, idOrTitle) ?? getNoteByTitle(db, idOrTitle);
}

export function requireNote(db: Db, idOrTitle: string): Note {
  const note = findNote(db, idOrTitle);
  if (!note) throw notFound(`No existe ninguna nota con id o titulo "${idOrTitle}".`);
  return note;
}

/**
 * Devuelve un titulo libre. Si el titulo ya esta tomado agrega " (2)", " (3)"...
 * Los titulos son unicos en todo el vault para que [[Titulo]] nunca sea ambiguo.
 */
export function uniqueTitle(db: Db, desired: string, excludeId?: string): { title: string; adjusted: boolean } {
  const base = desired.trim().replace(/\s+/g, ' ');
  if (!base) throw invalidInput('El titulo no puede estar vacio.');

  const taken = db.prepare('SELECT id FROM notes WHERE title_key = ?');
  let candidate = base;
  let suffix = 1;

  for (;;) {
    const row = taken.get(titleKey(candidate)) as { id: string } | undefined;
    if (!row || row.id === excludeId) return { title: candidate, adjusted: candidate !== base };
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
}

/** Recalcula enlaces y pendientes de una nota desde su body. */
function reindexNote(db: Db, id: string, noteTitleKey: string, body: string): void {
  reindexLinks(db, id, noteTitleKey, body);
  reindexPending(db, id, body);
}

function unresolvedTargets(db: Db, noteId: string): string[] {
  const rows = db
    .prepare('SELECT target_title FROM links WHERE from_note_id = ? AND to_note_id IS NULL ORDER BY id')
    .all(noteId) as { target_title: string }[];
  return rows.map((r) => r.target_title);
}

export interface SaveNoteResult {
  note: Note;
  url: string;
  /** true si hubo que agregar sufijo " (2)" por choque de titulo. */
  titleAdjusted: boolean;
  /** true si la carpeta no existia y se creo. */
  folderCreated: boolean;
  /** Titulos de "Relacionado" que todavia no corresponden a ninguna nota. */
  unresolvedLinks: string[];
}

export function createNote(ctx: Ctx, input: SaveNoteInput): SaveNoteResult {
  const { db } = ctx;
  const now = stamp(ctx);
  const source = input.source ?? 'claude';

  return writeTransaction(db, (): SaveNoteResult => {
    const folderCreated = ensureFolder(db, input.folder, now.iso);
    const { title, adjusted } = uniqueTitle(db, input.title);
    const key = titleKey(title);
    const body = renderNoteBody({ ...input, title });
    const id = newId();

    db.prepare(
      `INSERT INTO notes (id, title, title_key, folder, date, time, source,
                          source_conversation_id, source_url, status, summary, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      title,
      key,
      input.folder.trim(),
      // Importar y sembrar traen la fecha original; lo normal es la de hoy.
      input.date ?? now.date,
      input.time ?? now.time,
      source,
      input.sourceConversationId ?? null,
      input.sourceUrl ?? null,
      input.status ?? 'archivado',
      input.summary.trim(),
      body,
      now.iso,
      now.iso
    );

    setNoteTags(db, id, normalizeTagList(input.tags, source === 'claude' ? { first: 'claude' } : {}));
    reindexNote(db, id, key, body);
    // Una nota nueva adopta los enlaces fantasma que ya la apuntaban.
    resolveInboundLinks(db, id, key);

    return {
      note: getNoteById(db, id)!,
      url: noteUrl(ctx.config, id),
      titleAdjusted: adjusted,
      folderCreated,
      unresolvedLinks: unresolvedTargets(db, id)
    };
  });
}

/** Nombre real de la seccion de cierre de una nota: "Decisiones" o "Conclusiones". */
function closingSectionOf(body: string): string {
  const names = listSectionNames(body);
  const conclusiones = names.find((n) => titleKey(n) === titleKey(SECTION_CONCLUSIONES));
  const decisiones = names.find((n) => titleKey(n) === titleKey(SECTION_DECISIONES));
  return conclusiones ?? decisiones ?? SECTION_DECISIONES;
}

function applySectionEdits(body: string, input: UpdateNoteInput): string {
  let next = body;

  if (input.tipoSeccion) {
    const wanted = input.tipoSeccion === 'conclusiones' ? SECTION_CONCLUSIONES : SECTION_DECISIONES;
    const current = closingSectionOf(next);
    if (titleKey(current) !== titleKey(wanted)) next = renameSection(next, current, wanted);
  }

  if (input.contexto !== undefined) next = replaceSection(next, SECTION_CONTEXTO, renderParagraph(input.contexto));
  if (input.decisiones !== undefined) {
    next = replaceSection(next, closingSectionOf(next), renderBulletList(input.decisiones));
  }
  if (input.pendientes !== undefined) {
    next = replaceSection(next, SECTION_PENDIENTES, renderPendingList(input.pendientes));
  }
  if (input.referencias !== undefined) {
    next = replaceSection(next, SECTION_REFERENCIAS, renderBulletList(input.referencias));
  }
  if (input.notasAdicionales !== undefined) {
    next = replaceSection(next, SECTION_NOTAS_ADICIONALES, renderParagraph(input.notasAdicionales));
  }
  if (input.relacionados !== undefined) {
    next = replaceSection(next, SECTION_RELACIONADO, renderRelatedList(input.relacionados));
  }

  return next;
}

const SECTION_FIELDS = [
  'contexto',
  'decisiones',
  'pendientes',
  'referencias',
  'notasAdicionales',
  'relacionados',
  'tipoSeccion'
] as const;

export function updateNote(ctx: Ctx, idOrTitle: string, input: UpdateNoteInput): SaveNoteResult {
  const { db } = ctx;
  const now = stamp(ctx);

  return writeTransaction(db, (): SaveNoteResult => {
    const existing = requireNote(db, idOrTitle);

    if (input.bodyMarkdown !== undefined && SECTION_FIELDS.some((f) => input[f] !== undefined)) {
      throw invalidInput(
        'Usa body_markdown para reemplazar la nota entera, o los campos por seccion, pero no las dos cosas a la vez.'
      );
    }

    const body =
      input.bodyMarkdown !== undefined
        ? input.bodyMarkdown.replace(/\r\n?/g, '\n').trim() + '\n'
        : applySectionEdits(existing.body, input);

    let title = existing.title;
    let adjusted = false;
    if (input.title !== undefined && titleKey(input.title) !== existing.titleKey) {
      const unique = uniqueTitle(db, input.title, existing.id);
      title = unique.title;
      adjusted = unique.adjusted;
    } else if (input.title !== undefined) {
      title = input.title.trim();
    }
    const key = titleKey(title);

    let folderCreated = false;
    const folder = input.folder?.trim() || existing.folder;
    if (folder !== existing.folder) folderCreated = ensureFolder(db, folder, now.iso);

    db.prepare(
      `UPDATE notes
          SET title = ?, title_key = ?, folder = ?, status = ?, summary = ?, source_url = ?, body = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      title,
      key,
      folder,
      input.status ?? existing.status,
      input.summary !== undefined ? input.summary.trim() : existing.summary,
      input.sourceUrl !== undefined ? input.sourceUrl : existing.sourceUrl,
      body,
      now.iso,
      existing.id
    );

    if (input.tags !== undefined) setNoteTags(db, existing.id, normalizeTagList(input.tags));

    reindexNote(db, existing.id, key, body);

    if (key !== existing.titleKey) {
      // Renombrar no debe romper el grafo: se reescriben los [[...]] que la apuntaban.
      for (const linkerId of notesLinkingToKey(db, existing.titleKey, existing.id)) {
        const linker = selectRow(db, linkerId);
        if (!linker) continue;
        const rewritten = replaceWikilinkTarget(linker.body, existing.titleKey, title);
        if (rewritten === linker.body) continue;
        db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(rewritten, now.iso, linkerId);
        reindexNote(db, linkerId, linker.title_key, rewritten);
      }
      unresolveStaleLinks(db, existing.id, key);
      resolveInboundLinks(db, existing.id, key);
    }

    return {
      note: getNoteById(db, existing.id)!,
      url: noteUrl(ctx.config, existing.id),
      titleAdjusted: adjusted,
      folderCreated,
      unresolvedLinks: unresolvedTargets(db, existing.id)
    };
  });
}

/** Agrega markdown al final de una seccion existente. */
export function appendToNote(ctx: Ctx, idOrTitle: string, section: string, markdown: string): Note {
  const { db } = ctx;
  const now = stamp(ctx);

  return writeTransaction(db, (): Note => {
    const note = requireNote(db, idOrTitle);
    const sections = listSectionNames(note.body);
    const match = sections.find((s) => titleKey(s) === titleKey(section));
    if (!match) {
      throw new BitacoraError(
        'SECTION_NOT_FOUND',
        `La nota no tiene la seccion "${section}". Secciones disponibles: ${sections.join(', ')}.`
      );
    }

    const body = appendToSection(note.body, match, markdown);
    db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, now.iso, note.id);
    reindexNote(db, note.id, note.titleKey, body);
    return getNoteById(db, note.id)!;
  });
}

export interface LinkNotesResult {
  from: Note;
  targetTitle: string;
  resolved: boolean;
  alreadyLinked: boolean;
}

/** Agrega un [[wikilink]] en la seccion "Relacionado" de la nota origen. */
export function linkNotes(ctx: Ctx, fromIdOrTitle: string, toIdOrTitle: string): LinkNotesResult {
  const { db } = ctx;
  const now = stamp(ctx);

  return writeTransaction(db, (): LinkNotesResult => {
    const from = requireNote(db, fromIdOrTitle);
    const target = findNote(db, toIdOrTitle);
    const targetTitle = target?.title ?? toIdOrTitle.trim();

    if (target && target.id === from.id) {
      throw invalidInput('Una nota no puede enlazarse a si misma.');
    }
    if (!targetTitle) throw invalidInput('Falta el titulo o el id de la nota destino.');

    const already = uniqueWikilinks(from.body).some((l) => l.targetKey === titleKey(targetTitle));
    if (already) {
      return { from, targetTitle, resolved: target !== null, alreadyLinked: true };
    }

    const body = appendToSection(from.body, SECTION_RELACIONADO, `- ${toWikilink(targetTitle)}`);
    db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, now.iso, from.id);
    reindexNote(db, from.id, from.titleKey, body);

    return {
      from: getNoteById(db, from.id)!,
      targetTitle,
      resolved: target !== null,
      alreadyLinked: false
    };
  });
}

export interface PendingToggleResult {
  pending: PendingItem;
  note: Note;
  changed: boolean;
}

/**
 * Marca un pendiente como hecho reescribiendo la linea en el body.
 * La nota es la fuente de verdad: el indice se recalcula despues.
 */
export function setPendingDone(ctx: Ctx, pendingId: string, done: boolean): PendingToggleResult {
  const { db } = ctx;
  const now = stamp(ctx);

  return writeTransaction(db, (): PendingToggleResult => {
    const item = getPending(db, pendingId);
    if (!item) throw notFound(`No existe el pendiente "${pendingId}".`);
    const note = getNoteById(db, item.noteId);
    if (!note) throw notFound(`El pendiente "${pendingId}" apunta a una nota que ya no existe.`);
    if (item.done === done) return { pending: item, note, changed: false };

    let body = setPendingLineDone(note.body, item.lineNo, done);
    if (body === note.body) {
      // Red de seguridad por si la linea se movio: se busca por la accion.
      const fallback = parsePendingItems(note.body).find((p) => p.actionKey === titleKey(item.action));
      if (fallback) body = setPendingLineDone(note.body, fallback.lineNo, done);
    }
    if (body === note.body) {
      throw new BitacoraError('CONFLICT', `No se encontro la linea del pendiente "${item.action}" en la nota.`);
    }

    db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, now.iso, note.id);
    reindexNote(db, note.id, note.titleKey, body);

    const refreshed = getPending(db, pendingId);
    return { pending: refreshed ?? { ...item, done }, note: getNoteById(db, note.id)!, changed: true };
  });
}

export function deleteNote(db: Db, idOrTitle: string): Note {
  return writeTransaction(db, (): Note => {
    const note = requireNote(db, idOrTitle);
    // Los backlinks no se borran: quedan como enlaces no resueltos (ON DELETE SET NULL).
    db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    pruneOrphanTags(db);
    return note;
  });
}

export function listRecentNotes(db: Db, limit = 10): Note[] {
  // El id desempata: updated_at tiene precision de segundos y dos notas guardadas
  // en el mismo segundo quedarian en orden arbitrario.
  const rows = db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(Math.min(Math.max(limit, 1), 100)) as NoteRow[];
  return rows.map((row) => rowToNote(row, tagsForNote(db, row.id)));
}
