/**
 * Lectura y escritura de las secciones "## ..." del body de una nota.
 * El body es la fuente de verdad, asi que todo update por seccion pasa por aca.
 */

import { titleKey } from '../normalize.js';
import { codeFenceMask } from './fences.js';

const H2 = /^\s{0,3}##\s+(.+?)\s*#*\s*$/;

export interface SectionSpan {
  /** Texto del encabezado tal cual aparece, ej. "Notas adicionales". */
  heading: string;
  /** Clave normalizada para comparar sin importar acentos ni mayusculas. */
  key: string;
  /** Indice (0-based) de la linea "## ...". */
  headingLine: number;
  /** Primera linea de contenido. */
  start: number;
  /** Fin exclusivo del contenido. */
  end: number;
}

function toLines(body: string): string[] {
  return body.replace(/\r\n?/g, '\n').split('\n');
}

/** Todas las secciones de nivel 2 del body, en orden. */
export function splitSections(body: string): SectionSpan[] {
  const lines = toLines(body);
  const inCode = codeFenceMask(lines);
  const spans: SectionSpan[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    const match = H2.exec(lines[i] ?? '');
    if (!match) continue;
    const heading = match[1]!.trim();
    if (spans.length > 0) spans[spans.length - 1]!.end = i;
    spans.push({ heading, key: titleKey(heading), headingLine: i, start: i + 1, end: lines.length });
  }

  return spans;
}

export function listSectionNames(body: string): string[] {
  return splitSections(body).map((s) => s.heading);
}

function findSpan(body: string, name: string): SectionSpan | null {
  const key = titleKey(name);
  return splitSections(body).find((s) => s.key === key) ?? null;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start++;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
  return lines.slice(start, end);
}

/** Contenido de una seccion (sin el encabezado), o null si no existe. */
export function getSection(body: string, name: string): string | null {
  const span = findSpan(body, name);
  if (!span) return null;
  const lines = toLines(body);
  return trimBlankEdges(lines.slice(span.start, span.end)).join('\n');
}

/** Reemplaza el contenido de una seccion. Si no existe, la agrega al final. */
export function replaceSection(body: string, name: string, content: string): string {
  const span = findSpan(body, name);
  const normalized = trimBlankEdges(content.replace(/\r\n?/g, '\n').split('\n'));

  if (!span) {
    const head = trimBlankEdges(toLines(body));
    return [...head, '', `## ${name}`, '', ...normalized, ''].join('\n');
  }

  const lines = toLines(body);
  const next = [...lines.slice(0, span.start), '', ...normalized, '', ...lines.slice(span.end)];
  return trimBlankEdges(next).join('\n') + '\n';
}

const EMPTY_CONTENT = /^[\s—–-]*$|^n\/?a$/i;

/** Agrega markdown al final de una seccion. Si la seccion estaba en "—", la reemplaza. */
export function appendToSection(body: string, name: string, markdown: string): string {
  const current = getSection(body, name);
  const addition = trimBlankEdges(markdown.replace(/\r\n?/g, '\n').split('\n')).join('\n');
  if (current === null) return replaceSection(body, name, addition);
  if (EMPTY_CONTENT.test(current)) return replaceSection(body, name, addition);
  return replaceSection(body, name, `${current}\n${addition}`);
}

/** true si la seccion no existe o solo tiene el marcador de vacio. */
export function isSectionEmpty(body: string, name: string): boolean {
  const content = getSection(body, name);
  return content === null || EMPTY_CONTENT.test(content);
}

/** Cambia el texto del encabezado de una seccion, conservando su contenido y posicion. */
export function renameSection(body: string, from: string, to: string): string {
  const span = findSpan(body, from);
  if (!span) return body;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = toLines(body);
  lines[span.headingLine] = `## ${to}`;
  return lines.join(eol);
}
