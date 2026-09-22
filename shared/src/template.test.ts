import { describe, expect, it } from 'vitest';
import { getSection, listSectionNames } from './parse/sections.js';
import { parsePendingItems } from './parse/pending.js';
import { parseWikilinks } from './parse/wikilinks.js';
import { EMPTY_MARK, renderFrontmatter, renderNoteBody, renderNoteMarkdown, renderPendingLine } from './template.js';
import type { Note, SaveNoteInput } from './types.js';

const INPUT: SaveNoteInput = {
  title: 'OOS valoración lote AMX-2401',
  folder: 'Calidad',
  tags: ['claude', 'calidad', 'oos'],
  summary: 'Investigación de OOS por falla de calibración de HPLC.',
  contexto: 'El lote AMX-2401 presentó un resultado fuera de especificación en valoración.',
  decisiones: ['Se confirmó falla de calibración del HPLC.', '- Se decidió re-analizar con el equipo backup.'],
  pendientes: [
    { accion: 'Re-analizar el lote', responsable: 'Control de Calidad', fecha: '30/05/2026' },
    { accion: 'Redactar CAPA', responsable: 'Calidad' },
    { accion: 'Revisar SOP de calibración', fecha: '2026-06-12' },
    { accion: 'Avisar a Producción', hecho: true }
  ],
  referencias: ['Guía FDA sobre resultados OOS (2022)'],
  notasAdicionales: null,
  relacionados: ['Plan de validación de limpieza', 'Desviación DV-014']
};

describe('renderNoteBody', () => {
  const body = renderNoteBody(INPUT);

  it('emite las seis secciones de la plantilla en orden', () => {
    expect(listSectionNames(body)).toEqual([
      'Contexto',
      'Decisiones',
      'Pendientes',
      'Referencias',
      'Notas adicionales',
      'Relacionado'
    ]);
  });

  it('no incluye frontmatter ni H1: eso se genera desde las columnas', () => {
    expect(body.startsWith('## Contexto')).toBe(true);
    expect(body).not.toContain('---');
    expect(body).not.toContain('# OOS');
  });

  it('incluye el encabezado con el marcador de vacio cuando la seccion no trae nada', () => {
    expect(getSection(body, 'Notas adicionales')).toBe(EMPTY_MARK);
  });

  it('normaliza las vinetas sin duplicar el guion', () => {
    expect(getSection(body, 'Decisiones')).toBe(
      '- Se confirmó falla de calibración del HPLC.\n- Se decidió re-analizar con el equipo backup.'
    );
  });

  it('convierte relacionados en wikilinks', () => {
    expect(parseWikilinks(body).map((l) => l.target)).toEqual([
      'Plan de validación de limpieza',
      'Desviación DV-014'
    ]);
  });

  it('genera pendientes que el parser vuelve a leer igual (ida y vuelta)', () => {
    const items = parsePendingItems(body);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ action: 'Re-analizar el lote', owner: 'Control de Calidad', dueDate: '2026-05-30' });
    expect(items[1]).toMatchObject({ action: 'Redactar CAPA', owner: 'Calidad', dueDate: null });
    expect(items[2]).toMatchObject({ action: 'Revisar SOP de calibración', owner: null, dueDate: '2026-06-12' });
    expect(items[3]).toMatchObject({ action: 'Avisar a Producción', done: true });
  });

  it('renombra Decisiones a Conclusiones cuando solo hubo analisis', () => {
    const body2 = renderNoteBody({ ...INPUT, tipoSeccion: 'conclusiones' });
    expect(listSectionNames(body2)).toContain('Conclusiones');
    expect(listSectionNames(body2)).not.toContain('Decisiones');
  });

  it('usa el marcador de vacio en todas las secciones de una nota minima', () => {
    const vacia = renderNoteBody({
      ...INPUT,
      contexto: '',
      decisiones: [],
      pendientes: [],
      referencias: [],
      relacionados: []
    });
    for (const name of ['Contexto', 'Decisiones', 'Pendientes', 'Referencias', 'Relacionado']) {
      expect(getSection(vacia, name)).toBe(EMPTY_MARK);
    }
  });
});

describe('renderPendingLine', () => {
  it('omite el campo responsable cuando no hay, sin dejar relleno ilegible', () => {
    expect(renderPendingLine({ accion: 'Cerrar CAPA', fecha: '05/06/2026' })).toBe(
      '- [ ] Cerrar CAPA — 05/06/2026'
    );
  });

  it('cada forma de la linea vuelve a parsear a los mismos campos (ida y vuelta)', () => {
    const casos = [
      { accion: 'Con todo', responsable: 'Calidad', fecha: '05/06/2026' },
      { accion: 'Solo responsable', responsable: 'Calidad' },
      { accion: 'Solo fecha', fecha: '05/06/2026' },
      { accion: 'Pelado' }
    ];
    for (const caso of casos) {
      const parsed = parsePendingItems(renderPendingLine(caso))[0];
      expect(parsed?.action).toBe(caso.accion);
      expect(parsed?.owner).toBe(caso.responsable ?? null);
      expect(parsed?.dueDate).toBe(caso.fecha ? '2026-06-05' : null);
    }
  });

  it('conserva una fecha que no pudo parsear en vez de perderla', () => {
    // Los tools MCP validan el formato antes; esto cubre bodies editados a mano.
    expect(renderPendingLine({ accion: 'Revisar', fecha: 'antes de fin de mes' })).toBe(
      '- [ ] Revisar — antes de fin de mes'
    );
  });
});

const NOTE: Note = {
  id: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
  title: 'OOS valoración lote AMX-2401',
  titleKey: 'oos valoracion lote amx-2401',
  folder: 'Calidad',
  date: '2026-05-28',
  time: '14:32',
  source: 'claude',
  sourceConversationId: null,
  sourceUrl: null,
  status: 'archivado',
  summary: 'Investigación de OOS.',
  body: renderNoteBody(INPUT),
  createdAt: '2026-05-28T14:32:00-03:00',
  updatedAt: '2026-05-28T14:32:00-03:00',
  tags: ['claude', 'calidad', 'oos']
};

describe('renderNoteMarkdown', () => {
  const md = renderNoteMarkdown(NOTE);

  it('antepone el frontmatter y el H1', () => {
    expect(md.startsWith('---\nfecha: 2026-05-28\nhora: 14:32\n')).toBe(true);
    expect(md).toContain('fuente: Claude (conversación)');
    expect(md).toContain('tags: [claude, calidad, oos]');
    expect(md).toContain('estado: archivado');
    expect(md).toContain('\n# OOS valoración lote AMX-2401\n');
  });

  it('deja el markdown listo para Obsidian: frontmatter, H1 y luego las secciones', () => {
    const lines = md.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines.indexOf('---', 1)).toBe(6);
    expect(md.indexOf('# OOS')).toBeLessThan(md.indexOf('## Contexto'));
  });

  it('el frontmatter solo depende de las columnas', () => {
    const fm = renderFrontmatter({ ...NOTE, source: 'import', status: 'sin resumir' });
    expect(fm).toContain('fuente: Importado de claude.ai');
    expect(fm).toContain('estado: sin resumir');
  });
});
