import { getSection, parseClaudeExport } from '@bitacora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing.js';
import { isSummarizerEnabled, sourceTextFor, summarizeNote, type Resumen, type SummarizerClient } from './summarize.js';

let app: TestApp;

const EXPORT = [
  {
    uuid: 'conv-1',
    name: 'charla sobre el hplc',
    created_at: '2026-03-04T13:15:00Z',
    chat_messages: [
      { sender: 'human', text: 'El HPLC dio un OOS en el lote AMX-2401.' },
      { sender: 'assistant', text: 'Conviene revisar la calibración antes de re-analizar.' }
    ]
  }
];

const RESUMEN: Resumen = {
  titulo: 'OOS de valoración por calibración de HPLC',
  resumen: 'Investigación de un OOS atribuido a la calibración del cromatógrafo.',
  carpeta: 'Calidad',
  tags: ['Calidad', 'OOS'],
  contexto: 'El lote AMX-2401 dio fuera de especificación en valoración.',
  tipo_seccion: 'decisiones',
  decisiones: ['Re-analizar con el equipo de respaldo.'],
  pendientes: [{ accion: 'Verificar la calibración', responsable: 'Metrología', fecha: '30/05/2026' }],
  referencias: []
};

/** Doble del cliente: devuelve lo que le pasemos, sin tocar la red. */
function fakeClient(resumen: Resumen, inputTokens = 500): SummarizerClient {
  return {
    countInputTokens: async () => inputTokens,
    requestSummary: async () => resumen
  };
}

function importOne(): string {
  return app.services.importConversations(parseClaudeExport(EXPORT)).imported[0]!.id;
}

beforeEach(() => {
  app = createTestApp();
});

afterEach(() => {
  app.close();
});

describe('isSummarizerEnabled', () => {
  it('depende de que haya ANTHROPIC_API_KEY', () => {
    expect(isSummarizerEnabled({})).toBe(false);
    expect(isSummarizerEnabled({ ANTHROPIC_API_KEY: '' })).toBe(false);
    expect(isSummarizerEnabled({ ANTHROPIC_API_KEY: 'sk-ant-xxx' })).toBe(true);
  });
});

describe('sourceTextFor', () => {
  it('usa la transcripcion cuando la nota la tiene', () => {
    const note = app.services.getNote(importOne())!.note;
    expect(sourceTextFor(note)).toContain('El HPLC dio un OOS');
    expect(sourceTextFor(note)).toContain('<details>');
  });

  it('cae al cuerpo entero si no hay transcripcion', () => {
    const { note } = app.services.saveNote({
      title: 'Nota comun',
      folder: 'Calidad',
      tags: [],
      summary: 'x',
      contexto: 'Un contexto cualquiera.',
      decisiones: [],
      pendientes: [],
      referencias: [],
      relacionados: []
    });
    expect(sourceTextFor(note)).toContain('Un contexto cualquiera.');
  });
});

describe('summarizeNote', () => {
  it('exige la API key si no le inyectan un cliente', async () => {
    const id = importOne();
    await expect(summarizeNote({ db: app.db, config: app.config }, id, { env: {} })).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it('aplica el resumen sobre la nota y deja la transcripcion intacta', async () => {
    const id = importOne();
    const result = await summarizeNote({ db: app.db, config: app.config }, id, { client: fakeClient(RESUMEN) });

    expect(result.avisos).toEqual([]);
    const note = app.services.getNote(id)!.note;

    expect(note.title).toBe('OOS de valoración por calibración de HPLC');
    expect(note.folder).toBe('Calidad');
    expect(note.summary).toBe('Investigación de un OOS atribuido a la calibración del cromatógrafo.');
    expect(getSection(note.body, 'Contexto')).toBe('El lote AMX-2401 dio fuera de especificación en valoración.');
    expect(getSection(note.body, 'Decisiones')).toBe('- Re-analizar con el equipo de respaldo.');
    expect(getSection(note.body, 'Notas adicionales')).toContain('<details>');
  });

  it('pasa la nota a archivado y le saca el tag sin-resumir', async () => {
    const id = importOne();
    expect(app.services.getNote(id)!.note.tags).toEqual(['import', 'sin-resumir']);

    await summarizeNote({ db: app.db, config: app.config }, id, { client: fakeClient(RESUMEN) });
    const note = app.services.getNote(id)!.note;

    expect(note.status).toBe('archivado');
    expect(note.tags).toEqual(['import', 'calidad', 'oos']);
  });

  it('indexa los pendientes que salieron del resumen', async () => {
    const id = importOne();
    await summarizeNote({ db: app.db, config: app.config }, id, { client: fakeClient(RESUMEN) });

    const pending = app.services.listPending({ noteId: id });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      action: 'Verificar la calibración',
      owner: 'Metrología',
      dueDate: '2026-05-30'
    });
  });

  it('no muda la nota a una carpeta inventada y lo avisa', async () => {
    const id = importOne();
    const result = await summarizeNote({ db: app.db, config: app.config }, id, {
      client: fakeClient({ ...RESUMEN, carpeta: 'Carpeta Que No Existe' })
    });

    expect(result.avisos.join(' ')).toMatch(/no existe/);
    expect(app.services.getNote(id)!.note.folder).toBe('Importado');
  });

  it('descarta una fecha que no parsea en vez de guardarla torcida', async () => {
    const id = importOne();
    const result = await summarizeNote({ db: app.db, config: app.config }, id, {
      client: fakeClient({
        ...RESUMEN,
        pendientes: [{ accion: 'Revisar', responsable: null, fecha: 'la semana que viene' }]
      })
    });

    expect(result.avisos.join(' ')).toMatch(/Descarté la fecha/);
    const pending = app.services.listPending({ noteId: id })[0];
    expect(pending).toMatchObject({ action: 'Revisar', owner: null, dueDate: null });
  });

  it('usa Conclusiones cuando el resumen dice que no hubo decisiones', async () => {
    const id = importOne();
    await summarizeNote({ db: app.db, config: app.config }, id, {
      client: fakeClient({ ...RESUMEN, tipo_seccion: 'conclusiones' })
    });

    const body = app.services.getNote(id)!.note.body;
    expect(getSection(body, 'Conclusiones')).toBe('- Re-analizar con el equipo de respaldo.');
    expect(getSection(body, 'Decisiones')).toBeNull();
  });

  it('corta si la conversacion no entra en la ventana de contexto', async () => {
    const id = importOne();
    await expect(
      summarizeNote({ db: app.db, config: app.config }, id, { client: fakeClient(RESUMEN, 2_000_000) })
    ).rejects.toThrow(/demasiado larga/);
  });

  it('no deja la nota a medias si el modelo falla', async () => {
    const id = importOne();
    const before = app.services.getNote(id)!.note;

    await expect(
      summarizeNote({ db: app.db, config: app.config }, id, {
        client: {
          countInputTokens: async () => 500,
          requestSummary: async () => {
            throw new Error('la API se cayó');
          }
        }
      })
    ).rejects.toThrow(/la API se cayó/);

    const after = app.services.getNote(id)!.note;
    expect(after.title).toBe(before.title);
    expect(after.tags).toEqual(['import', 'sin-resumir']);
    expect(after.status).toBe('sin resumir');
  });
});
