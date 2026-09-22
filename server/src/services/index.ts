import {
  renderNoteMarkdown,
  type FolderCount,
  type Graph,
  type LinkedNoteRef,
  type Note,
  type OutLink,
  type PendingItem,
  type PendingItemWithNote,
  type SaveNoteInput,
  type SearchHit,
  type TagCount,
  type UpdateNoteInput,
  zonedNow
} from '@bitacora/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { deleteFolder, ensureFolder, listFolders, renameFolder } from './folders.js';
import { exportNote, exportVault, type ExportedNote } from './export.js';
import { getFullGraph, getNeighborhood, type GraphOptions } from './graph.js';
import { backLinks, outLinks } from './links.js';
import {
  appendToNote,
  createNote,
  deleteNote,
  findNote,
  getNoteById,
  linkNotes,
  listRecentNotes,
  noteUrl,
  requireNote,
  setPendingDone,
  updateNote,
  type Ctx,
  type LinkNotesResult,
  type PendingToggleResult,
  type SaveNoteResult
} from './notes.js';
import { listPending, type PendingFilter } from './pending.js';
import { searchNotes, type SearchFilter } from './search.js';
import { listTags, renameTag } from './tags.js';

/** Nota completa con todo lo que necesita get_note y la vista /nota/:id. */
export interface NoteDetail {
  note: Note;
  /** Markdown listo para Obsidian: frontmatter + H1 + body. */
  markdown: string;
  url: string;
  outlinks: OutLink[];
  backlinks: LinkedNoteRef[];
  pending: PendingItem[];
}

/**
 * Capa de servicios: es la unica logica de la app.
 * La comparten el MCP por stdio, el MCP por HTTP (fase 3) y la API REST (fase 2).
 */
export interface Services {
  readonly db: Db;
  readonly config: Config;

  listFolders(): FolderCount[];
  createFolder(name: string): boolean;
  renameFolder(from: string, to: string): void;
  deleteFolder(name: string, moveTo: string): void;

  listTags(prefix?: string): TagCount[];
  renameTag(from: string, to: string): string;

  searchNotes(filter: SearchFilter): SearchHit[];
  getNote(idOrTitle: string): NoteDetail | null;
  requireNoteDetail(idOrTitle: string): NoteDetail;
  listRecentNotes(limit?: number): Note[];

  saveNote(input: SaveNoteInput): SaveNoteResult;
  updateNote(idOrTitle: string, input: UpdateNoteInput): SaveNoteResult;
  appendToNote(idOrTitle: string, section: string, markdown: string): Note;
  linkNotes(fromIdOrTitle: string, toIdOrTitle: string): LinkNotesResult;
  deleteNote(idOrTitle: string): Note;

  listPending(filter?: PendingFilter): PendingItemWithNote[];
  setPendingDone(pendingId: string, done: boolean): PendingToggleResult;

  getNeighborhood(noteId: string, depth?: number, options?: GraphOptions): Graph;
  getFullGraph(options?: GraphOptions): Graph;

  exportNote(note: Note): ExportedNote;
  exportVault(): ExportedNote[];
}

export function createServices(db: Db, config: Config): Services {
  const ctx: Ctx = { db, config };

  const detail = (note: Note): NoteDetail => ({
    note,
    markdown: renderNoteMarkdown(note),
    url: noteUrl(config, note.id),
    outlinks: outLinks(db, note.id),
    backlinks: backLinks(db, note.id),
    pending: listPending(db, { noteId: note.id, includeDone: true })
  });

  return {
    db,
    config,

    listFolders: () => listFolders(db),
    createFolder: (name) => ensureFolder(db, name, zonedNow(config.timeZone).iso),
    renameFolder: (from, to) => renameFolder(db, from, to),
    deleteFolder: (name, moveTo) => deleteFolder(db, name, moveTo),

    listTags: (prefix) => listTags(db, prefix),
    renameTag: (from, to) => renameTag(db, from, to),

    searchNotes: (filter) => searchNotes(db, filter),
    getNote: (idOrTitle) => {
      const note = findNote(db, idOrTitle);
      return note ? detail(note) : null;
    },
    requireNoteDetail: (idOrTitle) => detail(requireNote(db, idOrTitle)),
    listRecentNotes: (limit) => listRecentNotes(db, limit),

    saveNote: (input) => createNote(ctx, input),
    updateNote: (idOrTitle, input) => updateNote(ctx, idOrTitle, input),
    appendToNote: (idOrTitle, section, markdown) => appendToNote(ctx, idOrTitle, section, markdown),
    linkNotes: (from, to) => linkNotes(ctx, from, to),
    deleteNote: (idOrTitle) => deleteNote(db, idOrTitle),

    listPending: (filter) => listPending(db, filter),
    setPendingDone: (pendingId, done) => setPendingDone(ctx, pendingId, done),

    getNeighborhood: (noteId, depth, options) => getNeighborhood(db, noteId, depth ?? 1, options),
    getFullGraph: (options) => getFullGraph(db, options),

    exportNote,
    exportVault: () => exportVault(db)
  };
}

export { getNoteById, noteUrl };
export type { ExportedNote, GraphOptions, LinkNotesResult, PendingFilter, SaveNoteResult, SearchFilter };
