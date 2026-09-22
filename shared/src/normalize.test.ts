import { describe, expect, it } from 'vitest';
import {
  formatDateForBody,
  normalizeTag,
  normalizeTagList,
  parseDateFlexible,
  safeFileName,
  titleKey,
  zonedNow
} from './normalize.js';

describe('normalizeTag', () => {
  it('aplica la convencion: minusculas, sin acentos, con guiones', () => {
    expect(normalizeTag('Batch Record')).toBe('batch-record');
    expect(normalizeTag('Desviación')).toBe('desviacion');
    expect(normalizeTag('  I+D  ')).toBe('i-d');
    expect(normalizeTag('#OOS')).toBe('oos');
    expect(normalizeTag('evento   adverso')).toBe('evento-adverso');
  });

  it('descarta tags que quedan vacios', () => {
    expect(normalizeTag('---')).toBe('');
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('normalizeTagList', () => {
  it('pone claude primero, deduplica y preserva el orden', () => {
    expect(normalizeTagList(['Calidad', 'OOS', 'calidad'], { first: 'claude' })).toEqual([
      'claude',
      'calidad',
      'oos'
    ]);
  });

  it('no duplica claude si ya venia en la lista', () => {
    expect(normalizeTagList(['claude', 'gmp'], { first: 'claude' })).toEqual(['claude', 'gmp']);
  });
});

describe('titleKey', () => {
  it('ignora acentos, mayusculas y espacios de mas', () => {
    expect(titleKey('Desviación  de   Calidad')).toBe('desviacion de calidad');
    expect(titleKey('OOS lote AMX-2401')).toBe(titleKey('oos   lote amx-2401'));
  });
});

describe('parseDateFlexible', () => {
  it('acepta los formatos que se escriben a mano', () => {
    expect(parseDateFlexible('30/05/2026')).toBe('2026-05-30');
    expect(parseDateFlexible('5-6-2026')).toBe('2026-06-05');
    expect(parseDateFlexible('2026-06-05')).toBe('2026-06-05');
    expect(parseDateFlexible('01/02/26')).toBe('2026-02-01');
  });

  it('rechaza fechas invalidas y texto suelto', () => {
    expect(parseDateFlexible('31/02/2026')).toBeNull();
    expect(parseDateFlexible('Control de Calidad')).toBeNull();
    expect(parseDateFlexible('')).toBeNull();
  });

  it('va y vuelve al formato del cuerpo de la nota', () => {
    expect(formatDateForBody('2026-05-30')).toBe('30/05/2026');
  });
});

describe('zonedNow', () => {
  it('usa la zona horaria configurada, no la del proceso', () => {
    const at = new Date('2026-05-28T02:30:00Z');
    const mvd = zonedNow('America/Montevideo', at);
    expect(mvd.date).toBe('2026-05-27');
    expect(mvd.time).toBe('23:30');
    expect(mvd.iso).toBe('2026-05-27T23:30:00-03:00');
  });
});

describe('safeFileName', () => {
  it('saca los caracteres prohibidos en Windows', () => {
    expect(safeFileName('OOS: valoración lote 24/01')).toBe('OOS- valoración lote 24-01');
  });
});
