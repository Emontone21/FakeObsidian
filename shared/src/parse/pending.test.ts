import { describe, expect, it } from 'vitest';
import { parsePendingItems, setPendingLineDone } from './pending.js';

const BODY = `## Pendientes

- [ ] Re-analizar lote AMX-2401 — Control de Calidad — 30/05/2026
- [x] Avisar al responsable técnico — Calidad
- [ ] Cerrar el CAPA — 05/06/2026
- [ ] Revisar procedimiento sin datos extra
* [ ] Validar limpieza | Producción | 12/06/2026

## Notas adicionales

\`\`\`md
- [ ] Este no cuenta, está en un bloque de código
\`\`\`
`;

describe('parsePendingItems', () => {
  const items = parsePendingItems(BODY);

  it('encuentra solo los checkboxes reales', () => {
    expect(items).toHaveLength(5);
    expect(items.every((i) => !i.action.includes('bloque de código'))).toBe(true);
  });

  it('separa accion, responsable y fecha', () => {
    expect(items[0]).toMatchObject({
      action: 'Re-analizar lote AMX-2401',
      owner: 'Control de Calidad',
      dueDate: '2026-05-30',
      done: false
    });
  });

  it('lee el estado hecho', () => {
    expect(items[1]).toMatchObject({ action: 'Avisar al responsable técnico', owner: 'Calidad', done: true });
    expect(items[1]?.dueDate).toBeNull();
  });

  it('entiende una fecha sin responsable', () => {
    expect(items[2]).toMatchObject({ action: 'Cerrar el CAPA', owner: null, dueDate: '2026-06-05' });
  });

  it('acepta un pendiente pelado', () => {
    expect(items[3]).toMatchObject({ action: 'Revisar procedimiento sin datos extra', owner: null, dueDate: null });
  });

  it('acepta barra como separador y vinetas con asterisco', () => {
    expect(items[4]).toMatchObject({ action: 'Validar limpieza', owner: 'Producción', dueDate: '2026-06-12' });
  });

  it('registra la seccion y la linea de cada item', () => {
    expect(items[0]?.section).toBe('Pendientes');
    expect(items[0]?.lineNo).toBe(2);
  });

  it('da una clave estable para reconciliar ids entre reparseos', () => {
    expect(parsePendingItems('- [ ] Cerrar el CAPA')[0]?.actionKey).toBe(items[2]?.actionKey);
  });
});

describe('setPendingLineDone', () => {
  it('reescribe la linea en el body conservando accion, responsable y fecha', () => {
    const next = setPendingLineDone(BODY, 2, true);
    expect(next.split('\n')[2]).toBe('- [x] Re-analizar lote AMX-2401 — Control de Calidad — 30/05/2026');
    expect(parsePendingItems(next)[0]?.done).toBe(true);
  });

  it('puede desmarcar', () => {
    const marked = setPendingLineDone(BODY, 3, false);
    expect(parsePendingItems(marked)[1]?.done).toBe(false);
  });

  it('no toca el body si la linea no es un checkbox', () => {
    expect(setPendingLineDone(BODY, 0, true)).toBe(BODY.replace(/\r\n?/g, '\n'));
  });
});
