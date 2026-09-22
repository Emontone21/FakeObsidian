import { getSection, parseClaudeExport, listSectionNames } from '@bitacora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing.js';

let app: TestApp;

const EXPORT = [
  {
    uuid: 'conv-1',
    name: 'Análisis de OOS en amoxicilina',
    created_at: '2026-03-04T13:15:00.000000Z',
    chat_messages: [
      { sender: 'human', text: 'Tengo un OOS en el lote AMX-2401.', created_at: '2026-03-04T13:15:00Z' },
      { sender: 'assistant', text: '## Análisis\n\nRevisemos la calibración.', created_at: '2026-03-04T13:16:00Z' }
    ]
  },
  {
    uuid: 'conv-2',
    name: 'Consulta sobre rotulado Mercosur',
    created_at: '2026-05-06T16:30:00.000000Z',
    chat_messages: [{ sender: 'human', text: '¿Qué cambia con la armonización?' }]
  }
];

beforeEach(() => {
  app = createTestApp();
});

afterEach(() => {
  app.close();
});

describe('importConversations', () => {
  it('crea una nota por conversacion en la carpeta Importado', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT));

    expect(report.total).toBe(2);
    expect(report.imported).toHaveLength(2);
    expect(report.skipped).toHaveLength(0);

    const note = app.services.getNote(report.imported[0]!.id)!.note;
    expect(note.folder).toBe('Importado');
    expect(note.tags).toEqual(['import', 'sin-resumir']);
    expect(note.status).toBe('sin resumir');
    expect(note.source).toBe('import');
    expect(note.sourceConversationId).toBe('conv-1');
  });

  it('crea la carpeta Importado si no existia', () => {
    expect(app.services.listFolders().map((f) => f.name)).not.toContain('Importado');
    app.services.importConversations(parseClaudeExport(EXPORT));
    expect(app.services.listFolders().find((f) => f.name === 'Importado')?.noteCount).toBe(2);
  });

  it('usa la fecha de la conversacion, no la de hoy', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT));
    const note = app.services.getNote(report.imported[0]!.id)!.note;
    // 13:15 UTC del 4 de marzo son las 10:15 en Montevideo.
    expect(note.date).toBe('2026-03-04');
    expect(note.time).toBe('10:15');
  });

  it('guarda la transcripcion completa en un bloque plegable', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT));
    const body = app.services.getNote(report.imported[0]!.id)!.note.body;
    const notas = getSection(body, 'Notas adicionales')!;

    expect(notas).toContain('<details>');
    expect(notas).toContain('Transcripcion completa (2 mensajes)');
    expect(notas).toContain('Tengo un OOS en el lote AMX-2401.');
    expect(notas).toContain('Revisemos la calibración.');
  });

  it('la transcripcion no rompe las secciones de la plantilla', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT));
    const body = app.services.getNote(report.imported[0]!.id)!.note.body;

    expect(listSectionNames(body)).toEqual([
      'Contexto',
      'Decisiones',
      'Pendientes',
      'Referencias',
      'Notas adicionales',
      'Relacionado'
    ]);
    // El "## Análisis" del mensaje quedo como negrita, no como seccion.
    expect(body).toContain('**Análisis**');
  });

  it('no duplica al reimportar el mismo archivo', () => {
    app.services.importConversations(parseClaudeExport(EXPORT));
    const second = app.services.importConversations(parseClaudeExport(EXPORT));

    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(second.skipped[0]?.reason).toMatch(/Ya estaba importada/);
    expect(app.services.countNotes({})).toBe(2);
  });

  it('importa lo nuevo y saltea lo repetido en la misma pasada', () => {
    app.services.importConversations(parseClaudeExport([EXPORT[0]]));
    const report = app.services.importConversations(parseClaudeExport(EXPORT));

    expect(report.imported).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(app.services.countNotes({})).toBe(2);
  });

  it('avisa cuando una conversacion no trae id y se podria duplicar', () => {
    const report = app.services.importConversations(
      parseClaudeExport([{ name: 'Sin id', chat_messages: [{ sender: 'human', text: 'hola' }] }])
    );
    expect(report.imported).toHaveLength(1);
    expect(report.warnings.join(' ')).toMatch(/no traian id/);
  });

  it('arrastra los avisos del parser', () => {
    const report = app.services.importConversations(parseClaudeExport([EXPORT[0], 'basura', null]));
    expect(report.warnings.join(' ')).toMatch(/Se saltearon 2 entradas/);
  });

  it('dryRun cuenta sin escribir nada', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT), { dryRun: true });
    expect(report.imported).toHaveLength(2);
    expect(app.services.countNotes({})).toBe(0);
  });

  it('respeta una carpeta destino distinta', () => {
    const report = app.services.importConversations(parseClaudeExport(EXPORT), { folder: 'Archivo viejo' });
    expect(app.services.getNote(report.imported[0]!.id)!.note.folder).toBe('Archivo viejo');
  });

  it('las notas importadas se pueden buscar por su contenido', () => {
    app.services.importConversations(parseClaudeExport(EXPORT));
    const hits = app.services.searchNotes({ query: 'calibracion' });
    expect(hits.map((h) => h.title)).toContain('Análisis de OOS en amoxicilina');
  });

  it('un titulo repetido recibe sufijo en vez de fallar', () => {
    app.services.saveNote({
      title: 'Análisis de OOS en amoxicilina',
      folder: 'Calidad',
      tags: [],
      summary: 'Ya existía.',
      contexto: 'Nota previa.',
      decisiones: [],
      pendientes: [],
      referencias: [],
      relacionados: []
    });
    const report = app.services.importConversations(parseClaudeExport([EXPORT[0]]));
    expect(report.imported[0]?.title).toBe('Análisis de OOS en amoxicilina (2)');
  });
});
