/** Parser de [[wikilinks]] al estilo Obsidian. */

import { titleKey } from '../normalize.js';
import { blankInlineCode, codeFenceMask } from './fences.js';

export interface WikiLink {
  /** Texto dentro de los corchetes, antes del alias. */
  target: string;
  /** Clave normalizada para resolver contra notes.title_key. */
  targetKey: string;
  /** Texto despues del "|", si lo hay. */
  alias: string | null;
  /** true si venia como embed ![[...]]. */
  embed: boolean;
  line: number;
}

const WIKILINK = /(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

/** Todos los wikilinks del texto, en orden, ignorando bloques y tramos de codigo. */
export function parseWikilinks(body: string): WikiLink[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const inCode = codeFenceMask(lines);
  const found: WikiLink[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    const line = blankInlineCode(lines[i] ?? '');
    WIKILINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK.exec(line)) !== null) {
      const target = match[2]!.trim();
      if (!target) continue;
      found.push({
        target,
        targetKey: titleKey(target),
        alias: match[3] !== undefined ? match[3].trim() || null : null,
        embed: match[1] === '!',
        line: i
      });
    }
  }

  return found;
}

/** Wikilinks unicos por clave, preservando el orden de aparicion. */
export function uniqueWikilinks(body: string): WikiLink[] {
  const seen = new Set<string>();
  const out: WikiLink[] = [];
  for (const link of parseWikilinks(body)) {
    if (seen.has(link.targetKey)) continue;
    seen.add(link.targetKey);
    out.push(link);
  }
  return out;
}

/** Renderiza un titulo como wikilink. */
export function toWikilink(title: string): string {
  return `[[${title.replace(/[[\]|]/g, '').trim()}]]`;
}

/**
 * Reescribe los [[...]] que apuntaban a `oldKey` para que apunten a `newTitle`,
 * conservando el alias. Se usa al renombrar una nota, para no romper backlinks.
 */
export function replaceWikilinkTarget(body: string, oldKey: string, newTitle: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const inCode = codeFenceMask(lines);
  const clean = newTitle.replace(/[[\]|]/g, '').trim();

  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    const original = lines[i] ?? '';
    // La mascara conserva las posiciones, asi que los indices sirven en el original.
    const masked = blankInlineCode(original);
    let out = '';
    let last = 0;
    WIKILINK.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WIKILINK.exec(masked)) !== null) {
      if (titleKey(match[2] ?? '') !== oldKey) continue;
      const alias = match[3] !== undefined ? `|${match[3]}` : '';
      out += original.slice(last, match.index) + `${match[1]}[[${clean}${alias}]]`;
      last = match.index + match[0].length;
    }

    if (last > 0) lines[i] = out + original.slice(last);
  }

  return lines.join(eol);
}
