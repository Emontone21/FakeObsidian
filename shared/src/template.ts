/**
 * Render de la plantilla fija de nota.
 * El servidor recibe campos estructurados y arma el markdown: el cliente MCP
 * nunca escribe el markdown a mano.
 */

import { formatDateForBody, parseDateFlexible } from './normalize.js';
import { toWikilink } from './parse/wikilinks.js';
import type { ClosingSection, Note, NoteSource, PendingInput, SaveNoteInput } from './types.js';

export const SECTION_CONTEXTO = 'Contexto';
export const SECTION_DECISIONES = 'Decisiones';
export const SECTION_CONCLUSIONES = 'Conclusiones';
export const SECTION_PENDIENTES = 'Pendientes';
export const SECTION_REFERENCIAS = 'Referencias';
export const SECTION_NOTAS_ADICIONALES = 'Notas adicionales';
export const SECTION_RELACIONADO = 'Relacionado';

/** Marcador de seccion vacia: el encabezado se incluye igual. */
export const EMPTY_MARK = '\u2014';

/** Secciones de la plantilla, en el orden en que se renderizan. */
export const TEMPLATE_SECTIONS = [
  SECTION_CONTEXTO,
  SECTION_DECISIONES,
  SECTION_PENDIENTES,
  SECTION_REFERENCIAS,
  SECTION_NOTAS_ADICIONALES,
  SECTION_RELACIONADO
] as const;

const SOURCE_LABEL: Record<NoteSource, string> = {
  claude: 'Claude (conversaci\u00f3n)',
  import: 'Importado de claude.ai',
  manual: 'Manual'
};

export function closingSectionTitle(kind: ClosingSection | undefined): string {
  return kind === 'conclusiones' ? SECTION_CONCLUSIONES : SECTION_DECISIONES;
}

/** Una linea de pendiente con el formato de la plantilla. */
export function renderPendingLine(item: PendingInput): string {
  const parts = [item.accion.trim()];
  const owner = item.responsable?.trim();
  const dateRaw = item.fecha?.trim();
  const parsed = dateRaw ? parseDateFlexible(dateRaw) : null;
  // Una fecha que no parsea se conserva tal cual: perderla seria peor que dejarla cruda.
  // Los tools MCP la rechazan antes de llegar aca, asi que solo pasa con bodies
  // editados a mano, y al reparsear cae en "responsable" en vez de en "fecha".
  const dateText = parsed ? formatDateForBody(parsed) : dateRaw || null;

  // Sin relleno para el responsable ausente: el parser reconoce una fecha en el
  // segundo campo, y "accion \u2014 \u2014 \u2014 fecha" seria ilegible.
  if (owner) parts.push(owner);
  if (dateText) parts.push(dateText);

  return `- [${item.hecho ? 'x' : ' '}] ${parts.join(' \u2014 ')}`;
}

/** Lista de vinetas, o el marcador de vacio si no hay items. */
export function renderBulletList(items: readonly string[]): string {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  if (clean.length === 0) return EMPTY_MARK;
  return clean.map((i) => (/^[-*+]\s/.test(i) ? i : `- ${i}`)).join('\n');
}

/** Parrafo libre, o el marcador de vacio si viene sin contenido. */
export function renderParagraph(text: string | null | undefined): string {
  const clean = (text ?? '').trim();
  return clean.length > 0 ? clean : EMPTY_MARK;
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content}\n`;
}

/**
 * Renderiza el body de la nota: arranca en "## Contexto".
 * El H1 y el frontmatter NO van en el body, se generan desde las columnas.
 */
/** Bloque de pendientes, una linea por item. */
export function renderPendingList(items: readonly PendingInput[]): string {
  if (items.length === 0) return EMPTY_MARK;
  return items.map(renderPendingLine).join('\n');
}

/** Bloque de "Relacionado": un wikilink por titulo. */
export function renderRelatedList(titles: readonly string[]): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return EMPTY_MARK;
  return clean.map((t) => `- ${toWikilink(t)}`).join('\n');
}

export function renderNoteBody(input: SaveNoteInput): string {
  return [
    section(SECTION_CONTEXTO, renderParagraph(input.contexto)),
    section(closingSectionTitle(input.tipoSeccion), renderBulletList(input.decisiones)),
    section(SECTION_PENDIENTES, renderPendingList(input.pendientes)),
    section(SECTION_REFERENCIAS, renderBulletList(input.referencias)),
    section(SECTION_NOTAS_ADICIONALES, renderParagraph(input.notasAdicionales)),
    section(SECTION_RELACIONADO, renderRelatedList(input.relacionados))
  ].join('\n');
}

const YAML_NEEDS_QUOTES = /^[\s>|&*!%@`{}[\],#?:-]|[:#]\s|\s$|^$/;

function yamlScalar(value: string): string {
  return YAML_NEEDS_QUOTES.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value;
}

/** Frontmatter YAML generado desde las columnas de la nota. */
export function renderFrontmatter(note: Note): string {
  return [
    '---',
    `fecha: ${note.date}`,
    `hora: ${note.time}`,
    `fuente: ${yamlScalar(SOURCE_LABEL[note.source] ?? note.source)}`,
    `tags: [${note.tags.join(', ')}]`,
    `estado: ${yamlScalar(note.status)}`,
    '---'
  ].join('\n');
}

/** Nota completa: frontmatter + H1 + body. Es lo que se exporta a Obsidian. */
export function renderNoteMarkdown(note: Note): string {
  return `${renderFrontmatter(note)}\n\n# ${note.title}\n\n${note.body.trim()}\n`;
}
