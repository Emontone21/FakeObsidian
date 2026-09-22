/**
 * Parser de pendientes: "- [ ] accion — responsable — DD/MM/AAAA".
 * Tolerante a proposito: el separador puede ser raya, guion doble o barra,
 * y responsable y fecha son opcionales.
 */

import { parseDateFlexible, titleKey } from '../normalize.js';
import { codeFenceMask } from './fences.js';
import { splitSections } from './sections.js';

export interface ParsedPending {
  /** Indice (0-based) de la linea dentro del body. */
  lineNo: number;
  /** Linea completa tal cual esta en el body. */
  rawLine: string;
  done: boolean;
  action: string;
  /** Clave normalizada de la accion: reconcilia ids entre reparseos. */
  actionKey: string;
  owner: string | null;
  /** YYYY-MM-DD, o null si no habia fecha parseable. */
  dueDate: string | null;
  /** Nombre de la seccion donde aparece, si aparece dentro de alguna. */
  section: string | null;
}

const CHECKBOX = /^(\s*)([-*+])\s+\[([ xX])\]\s*(.*)$/;
const SEPARATOR = /\s*[\u2014\u2013]\s*|\s+(?:--|\|)\s+/;

function splitFields(rest: string): string[] {
  return rest
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Todos los items con checkbox del body, en orden, ignorando bloques de codigo. */
export function parsePendingItems(body: string): ParsedPending[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const inCode = codeFenceMask(lines);
  const sections = splitSections(body);
  const items: ParsedPending[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    const raw = lines[i] ?? '';
    const match = CHECKBOX.exec(raw);
    if (!match) continue;

    const fields = splitFields(match[4] ?? '');
    if (fields.length === 0) continue;

    let owner: string | null = null;
    let dueDate: string | null = null;
    const rest = fields.slice(1);

    if (rest.length > 0) {
      const last = rest[rest.length - 1]!;
      const parsed = parseDateFlexible(last);
      if (parsed) {
        dueDate = parsed;
        rest.pop();
      }
      if (rest.length > 0) owner = rest.join(' - ');
    }

    const action = fields[0]!;
    const section = sections.find((s) => i >= s.start && i < s.end)?.heading ?? null;

    items.push({
      lineNo: i,
      rawLine: raw,
      done: (match[3] ?? ' ').toLowerCase() === 'x',
      action,
      actionKey: titleKey(action),
      owner,
      dueDate,
      section
    });
  }

  return items;
}

/**
 * Marca o desmarca el checkbox de una linea concreta del body.
 * Devuelve el body sin cambios si la linea no es un checkbox.
 */
export function setPendingLineDone(body: string, lineNo: number, done: boolean): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const raw = lines[lineNo];
  if (raw === undefined) return body;
  const match = CHECKBOX.exec(raw);
  if (!match) return body;
  lines[lineNo] = `${match[1]}${match[2]} [${done ? 'x' : ' '}] ${match[4] ?? ''}`.trimEnd();
  return lines.join(eol);
}
