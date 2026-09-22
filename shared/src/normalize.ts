/**
 * Normalizacion de titulos, tags y fechas.
 * Todo lo que necesite "comparar sin importar acentos ni mayusculas" pasa por aca.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Quita acentos y diacriticos, preservando la letra base. */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
}

/**
 * Clave canonica de un titulo. Dos titulos con la misma clave son la misma nota:
 * asi [[Desviación de calidad]] resuelve a la nota "Desviacion de Calidad".
 */
export function titleKey(title: string): string {
  return stripDiacritics(title).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Convencion de tags del vault: minusculas, sin acentos, sin espacios (guiones). */
export function normalizeTag(tag: string): string {
  return stripDiacritics(tag)
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normaliza una lista de tags, deduplica y preserva el orden.
 * `first` fuerza un tag al principio (tipicamente "claude").
 */
export function normalizeTagList(tags: Iterable<string>, opts: { first?: string } = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  };
  if (opts.first) push(opts.first);
  for (const tag of tags) push(tag);
  return out;
}

export interface ZonedNow {
  /** YYYY-MM-DD en la zona horaria pedida */
  date: string;
  /** HH:MM en la zona horaria pedida */
  time: string;
  /** ISO-8601 con offset explicito, ej. 2026-05-28T14:32:07-03:00 */
  iso: string;
}

function zonedParts(timeZone: string, at: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

/** Offset de la zona horaria en minutos (positivo al este de Greenwich). */
export function timeZoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const p = zonedParts(timeZone, at);
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asIfUtc - truncated) / 60000);
}

/** Fecha, hora e ISO con offset para la zona horaria configurada. */
export function zonedNow(timeZone: string, at: Date = new Date()): ZonedNow {
  const p = zonedParts(timeZone, at);
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  const offset = timeZoneOffsetMinutes(timeZone, at);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetText = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { date, time, iso: `${date}T${p.hour}:${p.minute}:${p.second}${offsetText}` };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Parsea una fecha escrita a mano en la nota y la devuelve como YYYY-MM-DD.
 * Acepta DD/MM/AAAA, DD-MM-AAAA, D/M/AA y YYYY-MM-DD. Devuelve null si no parsea.
 */
export function parseDateFlexible(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return isRealDate(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }

  const dmy = DMY_DATE.exec(text);
  if (dmy) {
    const [, dRaw, mRaw, yRaw] = dmy;
    const day = Number(dRaw);
    const month = Number(mRaw);
    let year = Number(yRaw);
    if (yRaw!.length === 2) year += year < 70 ? 2000 : 1900;
    if (!isRealDate(year, month, day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

/** YYYY-MM-DD -> DD/MM/AAAA, que es el formato que va en el cuerpo de la nota. */
export function formatDateForBody(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate.trim());
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const FS_FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g;

/** Nombre de archivo seguro para exportar a Obsidian en Windows, macOS y Linux. */
export function safeFileName(title: string): string {
  const cleaned = title.replace(FS_FORBIDDEN, '-').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return (cleaned || 'Sin titulo').slice(0, 120);
}
