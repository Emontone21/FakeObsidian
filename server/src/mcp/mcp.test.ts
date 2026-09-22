import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseClaudeExport } from '@bitacora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing.js';
import { createMcpServer } from './server.js';

let app: TestApp;
let client: Client;

const NOTA_BASE = {
  title: 'OOS de valoracion lote AMX-2401',
  folder: 'Calidad',
  tags: ['Desviación', 'OOS'],
  summary: 'Resultado fuera de especificacion por calibracion de HPLC.',
  contexto: 'El lote AMX-2401 dio fuera de especificacion en valoracion durante el ensayo de liberacion.',
  decisiones: ['Re-analizar con el equipo de respaldo.'],
  pendientes: [{ accion: 'Redactar la CAPA', responsable: 'Calidad', fecha: '05/06/2026' }],
  referencias: ['Procedimiento interno de manejo de OOS'],
  relacionados: []
};

/** Llama un tool y devuelve el JSON que trae en el content de texto. */
async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const first = result.content[0];
  if (result.isError) throw new Error(first && 'text' in first ? String(first.text) : 'error sin detalle');
  if (!first || first.type !== 'text') throw new Error('el tool no devolvio texto');
  return JSON.parse(first.text) as T;
}

async function callRaw(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

beforeEach(async () => {
  app = createTestApp();
  const server = createMcpServer(app.services);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-bitacora', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  app.close();
});

describe('superficie del servidor MCP', () => {
  it('expone los doce tools acordados', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'append_to_note',
      'complete_pending',
      'get_graph_neighborhood',
      'get_note',
      'link_notes',
      'list_folders',
      'list_pending',
      'list_recent_notes',
      'list_tags',
      'save_note',
      'search_notes',
      'update_note'
    ]);
  });

  it('no expone ningun tool para borrar notas: eso es solo desde la web', async () => {
    const { tools } = await client.listTools();
    expect(tools.some((t) => /delete|borrar|remove/i.test(t.name))).toBe(false);
  });

  it('cada tool describe en espanol el flujo esperado', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} sin descripcion`).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(80);
    }
    const save = tools.find((t) => t.name === 'save_note')!;
    expect(save.description).toMatch(/list_folders/);
    expect(save.description).toMatch(/search_notes/);
  });

  it('marca como solo lectura los tools que no escriben', async () => {
    const { tools } = await client.listTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual([
      'get_graph_neighborhood',
      'get_note',
      'list_folders',
      'list_pending',
      'list_recent_notes',
      'list_tags',
      'search_notes'
    ]);
  });

  it('publica el prompt guardar-conversacion con las instrucciones de archivado', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['guardar-conversacion', 'resumir-importadas']);

    const prompt = await client.getPrompt({ name: 'guardar-conversacion', arguments: {} });
    const text = prompt.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
    expect(text).toMatch(/list_folders/);
    expect(text).toMatch(/search_notes/);
    expect(text).toMatch(/save_note/);
    expect(text).toMatch(/Nunca inventes normas/);
    expect(text).toMatch(/Anonimiza datos personales/);
  });
});

describe('resumir sin API key, desde el propio cliente MCP', () => {
  /** Lo que haria Claude Desktop al recibir el prompt: buscar, leer y actualizar. */
  async function importarUna() {
    const parsed = parseClaudeExport([
      {
        uuid: 'conv-x',
        name: 'charla suelta',
        created_at: '2026-03-04T13:15:00Z',
        chat_messages: [
          { sender: 'human', text: 'El HPLC dio un OOS en el lote AMX-2401.' },
          { sender: 'assistant', text: 'Conviene revisar la calibración antes de re-analizar.' }
        ]
      }
    ]);
    return app.services.importConversations(parsed).imported[0]!.id;
  }

  it('el prompt explica el flujo completo y aclara que no hace falta clave', async () => {
    const prompt = await client.getPrompt({ name: 'resumir-importadas', arguments: {} });
    const text = prompt.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');

    expect(text).toMatch(/search_notes/);
    expect(text).toMatch(/get_note/);
    expect(text).toMatch(/update_note/);
    expect(text).toMatch(/sin-resumir/);
    expect(text).toMatch(/NO toques notas_adicionales/);
    expect(text).toMatch(/Nunca inventes normas/i);

    const description = (await client.listPrompts()).prompts.find((p) => p.name === 'resumir-importadas');
    expect(description?.description).toMatch(/No necesita ninguna clave de API/);
  });

  it('search_notes encuentra las que faltan resumir', async () => {
    const id = await importarUna();
    const { resultados } = await call<{ resultados: { id: string; tags: string[] }[] }>('search_notes', {
      tags: ['sin-resumir']
    });

    expect(resultados.map((r) => r.id)).toEqual([id]);
    expect(resultados[0]!.tags).toEqual(['import', 'sin-resumir']);
  });

  it('get_note trae la transcripcion para poder leerla', async () => {
    const id = await importarUna();
    const note = await call<{ markdown: string }>('get_note', { id });

    expect(note.markdown).toContain('El HPLC dio un OOS en el lote AMX-2401.');
    expect(note.markdown).toContain('Transcripcion completa');
  });

  it('update_note completa la plantilla, saca el tag y archiva, sin tocar la transcripcion', async () => {
    const id = await importarUna();

    await call('update_note', {
      id,
      title: 'OOS de valoración por calibración de HPLC',
      folder: 'Calidad',
      tags: ['import', 'calidad', 'oos'],
      summary: 'Investigación de un OOS atribuido a la calibración del cromatógrafo.',
      contexto: 'El lote AMX-2401 dio fuera de especificación en valoración.',
      decisiones: ['Revisar la calibración antes de re-analizar.'],
      pendientes: [{ accion: 'Verificar la calibración', responsable: 'Metrología', fecha: '30/05/2026' }],
      referencias: [],
      status: 'archivado'
    });

    const note = await call<{ title: string; tags: string[]; status: string; markdown: string }>('get_note', { id });

    expect(note.title).toBe('OOS de valoración por calibración de HPLC');
    expect(note.tags).toEqual(['import', 'calidad', 'oos']);
    expect(note.status).toBe('archivado');
    expect(note.markdown).toContain('## Contexto\n\nEl lote AMX-2401 dio fuera de especificación');
    // La transcripcion sigue entera.
    expect(note.markdown).toContain('Transcripcion completa');
    expect(note.markdown).toContain('El HPLC dio un OOS en el lote AMX-2401.');

    // Y ya no aparece entre las que faltan resumir.
    const pendientes = await call<{ resultados: unknown[] }>('search_notes', { tags: ['sin-resumir'] });
    expect(pendientes.resultados).toHaveLength(0);
  });

  it('el pendiente que saco del resumen queda indexado', async () => {
    const id = await importarUna();
    await call('update_note', {
      id,
      pendientes: [{ accion: 'Verificar la calibración', responsable: 'Metrología', fecha: '30/05/2026' }]
    });

    const { pendientes } = await call<{ pendientes: { accion: string; fecha: string }[] }>('list_pending', {});
    expect(pendientes[0]).toMatchObject({ accion: 'Verificar la calibración', fecha: '2026-05-30' });
  });
});

describe('save_note', () => {
  it('guarda la nota y devuelve id, tags normalizados y URL', async () => {
    const result = await call<{ id: string; title: string; tags: string[]; url: string; avisos: string[] }>(
      'save_note',
      NOTA_BASE
    );

    expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.tags).toEqual(['claude', 'desviacion', 'oos']);
    expect(result.url).toBe(`${app.config.webBaseUrl}/nota/${result.id}`);
    expect(result.avisos).toEqual([]);
  });

  it('renderiza la plantilla completa: el cliente no escribe markdown', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    const note = await call<{ markdown: string }>('get_note', { id: saved.id });

    expect(note.markdown).toContain('## Contexto');
    expect(note.markdown).toContain('## Decisiones');
    expect(note.markdown).toContain('## Pendientes');
    expect(note.markdown).toContain('## Referencias');
    expect(note.markdown).toContain('## Notas adicionales');
    expect(note.markdown).toContain('## Relacionado');
    expect(note.markdown).toContain('fuente: Claude (conversación)');
    expect(note.markdown).toContain('- [ ] Redactar la CAPA — Calidad — 05/06/2026');
  });

  it('avisa cuando renombra por titulo repetido', async () => {
    await call('save_note', NOTA_BASE);
    const dup = await call<{ title: string; avisos: string[] }>('save_note', NOTA_BASE);

    expect(dup.title).toBe('OOS de valoracion lote AMX-2401 (2)');
    expect(dup.avisos.join(' ')).toMatch(/Ya existia una nota con ese titulo/);
  });

  it('avisa cuando crea una carpeta nueva y cuando un relacionado no resuelve', async () => {
    const result = await call<{ avisos: string[] }>('save_note', {
      ...NOTA_BASE,
      folder: 'Proyectos especiales',
      relacionados: ['Una nota que todavia no existe']
    });

    expect(result.avisos.join(' ')).toMatch(/Se creo la carpeta "Proyectos especiales"/);
    expect(result.avisos.join(' ')).toMatch(/sin resolver.*Una nota que todavia no existe/);
  });

  it('rechaza una fecha de pendiente con formato invalido en vez de guardarla mal', async () => {
    const result = await callRaw('save_note', {
      ...NOTA_BASE,
      pendientes: [{ accion: 'Revisar', fecha: 'la semana que viene' }]
    });

    expect(result.isError).toBe(true);
    const text = result.content[0] && 'text' in result.content[0] ? String(result.content[0].text) : '';
    expect(text).toMatch(/DD\/MM\/AAAA/);
    expect(app.services.listRecentNotes()).toHaveLength(0);
  });

  it('usa Conclusiones cuando la conversacion fue analisis sin decisiones', async () => {
    const saved = await call<{ id: string }>('save_note', { ...NOTA_BASE, tipo_seccion: 'conclusiones' });
    const note = await call<{ markdown: string }>('get_note', { id: saved.id });

    expect(note.markdown).toContain('## Conclusiones');
    expect(note.markdown).not.toContain('## Decisiones');
  });
});

describe('search_notes y get_note', () => {
  beforeEach(async () => {
    await call('save_note', NOTA_BASE);
    await call('save_note', {
      ...NOTA_BASE,
      title: 'Dossier de renovacion de amoxicilina',
      folder: 'Regulatorios',
      tags: ['regulatorios', 'dossier'],
      summary: 'Expediente de renovacion del registro sanitario.',
      contexto: 'Preparacion del expediente de renovacion quinquenal.',
      pendientes: [],
      referencias: []
    });
  });

  it('encuentra por texto ignorando acentos', async () => {
    const { resultados } = await call<{ resultados: { title: string; score: number }[] }>('search_notes', {
      query: 'valoracion'
    });

    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.title).toBe('OOS de valoracion lote AMX-2401');
    expect(resultados[0]!.score).toBe(100);
  });

  it('filtra por carpeta y por tag', async () => {
    const porCarpeta = await call<{ resultados: unknown[] }>('search_notes', { folder: 'Regulatorios' });
    expect(porCarpeta.resultados).toHaveLength(1);

    const porTag = await call<{ resultados: unknown[] }>('search_notes', { tags: ['dossier'] });
    expect(porTag.resultados).toHaveLength(1);
  });

  it('get_note acepta titulo ademas de id, y trae enlaces y pendientes', async () => {
    const note = await call<{
      id: string;
      title: string;
      pendientes: { pending_id: string; accion: string }[];
      outlinks: unknown[];
      backlinks: unknown[];
    }>('get_note', { title: 'oos de VALORACION lote amx-2401' });

    expect(note.title).toBe('OOS de valoracion lote AMX-2401');
    expect(note.pendientes[0]).toMatchObject({ accion: 'Redactar la CAPA', hecho: false });
    expect(note.outlinks).toEqual([]);
    expect(note.backlinks).toEqual([]);
  });

  it('get_note sin id ni titulo explica que falta', async () => {
    const result = await callRaw('get_note', {});
    expect(result.isError).toBe(true);
    const text = result.content[0] && 'text' in result.content[0] ? String(result.content[0].text) : '';
    expect(text).toMatch(/"id" o "title"/);
  });

  it('get_note de una nota inexistente devuelve un error entendible', async () => {
    const result = await callRaw('get_note', { title: 'No existe esta nota' });
    expect(result.isError).toBe(true);
    const text = result.content[0] && 'text' in result.content[0] ? String(result.content[0].text) : '';
    expect(text).toMatch(/No existe ninguna nota/);
  });
});

describe('edicion y enlaces', () => {
  it('append_to_note suma una decision sin pisar las anteriores', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    await call('append_to_note', { id: saved.id, section: 'Decisiones', markdown: '- Iniciar CAPA formal.' });

    const note = await call<{ markdown: string }>('get_note', { id: saved.id });
    expect(note.markdown).toContain('- Re-analizar con el equipo de respaldo.');
    expect(note.markdown).toContain('- Iniciar CAPA formal.');
  });

  it('append_to_note a una seccion inexistente lista las disponibles', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    const result = await callRaw('append_to_note', { id: saved.id, section: 'Anexos', markdown: '- algo' });

    expect(result.isError).toBe(true);
    const text = result.content[0] && 'text' in result.content[0] ? String(result.content[0].text) : '';
    expect(text).toMatch(/Secciones disponibles/);
  });

  it('link_notes enlaza, avisa si no resuelve y no duplica', async () => {
    const a = await call<{ id: string }>('save_note', NOTA_BASE);
    const b = await call<{ id: string }>('save_note', { ...NOTA_BASE, title: 'Nota destino' });

    const linked = await call<{ resuelto: boolean; ya_estaba: boolean }>('link_notes', {
      from_id: a.id,
      to_id: b.id
    });
    expect(linked).toMatchObject({ resuelto: true, ya_estaba: false });

    const again = await call<{ ya_estaba: boolean }>('link_notes', { from_id: a.id, to_title: 'Nota destino' });
    expect(again.ya_estaba).toBe(true);

    const phantom = await call<{ resuelto: boolean; aviso: string }>('link_notes', {
      from_id: a.id,
      to_title: 'Nota que no existe'
    });
    expect(phantom.resuelto).toBe(false);
    expect(phantom.aviso).toMatch(/pendiente de resolver/);
  });

  it('update_note reemplaza una seccion y recalcula los pendientes', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    await call('update_note', {
      id: saved.id,
      pendientes: [{ accion: 'Nueva tarea', responsable: 'Produccion', fecha: '30/09/2026' }]
    });

    const { pendientes } = await call<{ pendientes: { accion: string; fecha: string }[] }>('list_pending', {});
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ accion: 'Nueva tarea', fecha: '2026-09-30' });
  });

  it('update_note rechaza mezclar body_markdown con campos por seccion', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    const result = await callRaw('update_note', {
      id: saved.id,
      body_markdown: '## Contexto\n\nNuevo',
      contexto: 'Otro'
    });

    expect(result.isError).toBe(true);
  });
});

describe('pendientes por MCP', () => {
  it('complete_pending marca el checkbox en el cuerpo de la nota', async () => {
    const saved = await call<{ id: string }>('save_note', NOTA_BASE);
    const { pendientes } = await call<{ pendientes: { pending_id: string }[] }>('list_pending', {});

    const done = await call<{ hecho: boolean; ya_estaba_hecho: boolean }>('complete_pending', {
      pending_id: pendientes[0]!.pending_id
    });
    expect(done).toMatchObject({ hecho: true, ya_estaba_hecho: false });

    const note = await call<{ markdown: string }>('get_note', { id: saved.id });
    expect(note.markdown).toContain('- [x] Redactar la CAPA — Calidad — 05/06/2026');

    expect((await call<{ pendientes: unknown[] }>('list_pending', {})).pendientes).toHaveLength(0);
    expect(
      (await call<{ pendientes: unknown[] }>('list_pending', { include_done: true })).pendientes
    ).toHaveLength(1);
  });

  it('completar dos veces avisa que ya estaba hecho en vez de fallar', async () => {
    await call('save_note', NOTA_BASE);
    const { pendientes } = await call<{ pendientes: { pending_id: string }[] }>('list_pending', {});
    await call('complete_pending', { pending_id: pendientes[0]!.pending_id });

    const again = await call<{ ya_estaba_hecho: boolean }>('complete_pending', {
      pending_id: pendientes[0]!.pending_id
    });
    expect(again.ya_estaba_hecho).toBe(true);
  });
});

describe('taxonomia y grafo', () => {
  it('list_folders devuelve la taxonomia inicial con conteos', async () => {
    const { carpetas } = await call<{ carpetas: { name: string; noteCount: number }[] }>('list_folders');
    expect(carpetas.map((c) => c.name)).toEqual([
      'I+D',
      'Regulatorios',
      'Calidad',
      'Farmacovigilancia',
      'Produccion',
      'Comercial',
      'Marketing',
      'TI',
      'General'
    ]);
    expect(carpetas.every((c) => c.noteCount === 0)).toBe(true);
  });

  it('list_tags ordena por uso y filtra por prefijo', async () => {
    await call('save_note', NOTA_BASE);
    await call('save_note', { ...NOTA_BASE, title: 'Otra nota', tags: ['oos'] });

    const { tags } = await call<{ tags: { name: string; noteCount: number }[] }>('list_tags');
    expect(tags[0]).toMatchObject({ name: 'claude', noteCount: 2 });

    const filtrados = await call<{ tags: { name: string }[] }>('list_tags', { prefix: 'des' });
    expect(filtrados.tags.map((t) => t.name)).toEqual(['desviacion']);
  });

  it('get_graph_neighborhood devuelve nodos y aristas alrededor de la nota', async () => {
    const a = await call<{ id: string }>('save_note', NOTA_BASE);
    await call('save_note', { ...NOTA_BASE, title: 'Nota vecina', relacionados: [NOTA_BASE.title] });

    const graph = await call<{ centro: string; nodes: unknown[]; edges: unknown[] }>('get_graph_neighborhood', {
      id: a.id
    });
    expect(graph.centro).toBe(a.id);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it('list_recent_notes devuelve las ultimas modificadas primero', async () => {
    await call('save_note', NOTA_BASE);
    await call('save_note', { ...NOTA_BASE, title: 'La mas nueva' });

    const { notas } = await call<{ notas: { title: string }[] }>('list_recent_notes', { limit: 5 });
    expect(notas[0]!.title).toBe('La mas nueva');
  });
});
