/**
 * Deteccion de bloques de codigo cercados.
 * Los parsers la usan para no confundir "## algo" o "[[algo]]" dentro de un
 * bloque ``` con un encabezado o un wikilink real.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/** Devuelve, por linea, si esa linea esta dentro (o es) un bloque de codigo cercado. */
export function codeFenceMask(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const match = FENCE.exec(lines[i] ?? '');
    if (open === null) {
      if (!match) continue;
      const marker = match[1]!;
      // Una apertura con backticks no puede llevar backticks en la info string.
      if (marker.startsWith('`') && match[2]!.includes('`')) continue;
      open = marker;
      mask[i] = true;
      continue;
    }

    mask[i] = true;
    if (
      match &&
      match[1]!.startsWith(open[0]!) &&
      match[1]!.length >= open.length &&
      match[2]!.trim() === ''
    ) {
      open = null;
    }
  }

  return mask;
}

/** Reemplaza los tramos de codigo en linea (`asi`) por espacios, conservando las posiciones. */
export function blankInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let ticks = 0;
      while (line[i + ticks] === '`') ticks++;
      const marker = '`'.repeat(ticks);
      const close = line.indexOf(marker, i + ticks);
      if (close !== -1) {
        out += ' '.repeat(close + ticks - i);
        i = close + ticks;
        continue;
      }
    }
    out += line[i];
    i++;
  }
  return out;
}
