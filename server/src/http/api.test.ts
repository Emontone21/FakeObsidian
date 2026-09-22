import { strToU8, zipSync } from 'fflate';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices } from '../services/index.js';
import { createTestApp, BASE_NOTE, type TestApp } from '../testing.js';
import { createHttpApp } from './app.js';

let test: TestApp;
let server: Server;
let base: string;
let cookie = '';

/** Cliente minimo que arrastra la cookie de sesion entre llamadas. */
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const pair = raw.split(';')[0]!;
    if (pair.startsWith('bitacora_session=')) cookie = pair.endsWith('=') ? '' : pair;
  }
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await api(path, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) });

const EXPORT_CLAUDE = [
  {
    uuid: 'conv-1',
    name: 'Consulta sobre OOS',
    created_at: '2026-03-04T13:15:00Z',
    chat_messages: [{ sender: 'human', text: 'Tengo un OOS en el lote AMX-2401.' }]
  },
  {
    uuid: 'conv-2',
    name: 'Consulta regulatoria',
    created_at: '2026-04-08T10:00:00Z',
    chat_messages: [{ sender: 'human', text: '¿Qué pide MSP para la renovación?' }]
  }
];

beforeEach(async () => {
  cookie = '';
  test = createTestApp();
  // createTestApp usa :memory:, pero el servicio se construye contra la misma conexion.
  const app = {
    config: test.config,
    db: test.db,
    services: createServices(test.db, test.config),
    close: test.close
  };
  server = createHttpApp(app).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  test.close();
});

async function login(password = 'contrasena-larga'): Promise<void> {
  await post('/api/auth/setup', { password });
}

describe('autenticacion', () => {
  it('arranca pidiendo que definas una contrasena', async () => {
    const session = await json<{ authenticated: boolean; needsSetup: boolean }>('/api/auth/session');
    expect(session).toEqual({ authenticated: false, needsSetup: true });
  });

  it('todo lo que no sea auth exige sesion', async () => {
    for (const path of ['/api/notes', '/api/folders', '/api/tags', '/api/pending', '/api/graph', '/api/status']) {
      expect((await api(path)).status, path).toBe(401);
    }
  });

  it('el alta de contrasena deja la sesion abierta', async () => {
    await login();
    const session = await json<{ authenticated: boolean; needsSetup: boolean }>('/api/auth/session');
    expect(session).toEqual({ authenticated: true, needsSetup: false });
    expect((await api('/api/folders')).status).toBe(200);
  });

  it('rechaza una contrasena corta', async () => {
    const response = await post('/api/auth/setup', { password: 'corta' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/al menos 8 caracteres/);
  });

  it('no permite rehacer el alta una vez configurada', async () => {
    await login();
    expect((await post('/api/auth/setup', { password: 'otra-contrasena' })).status).toBe(409);
  });

  it('login y logout', async () => {
    await login('mi-contrasena-secreta');
    await post('/api/auth/logout', {});
    expect((await api('/api/folders')).status).toBe(401);

    expect((await post('/api/auth/login', { password: 'equivocada' })).status).toBe(400);
    expect((await post('/api/auth/login', { password: 'mi-contrasena-secreta' })).status).toBe(200);
    expect((await api('/api/folders')).status).toBe(200);
  });

  it('frena la fuerza bruta despues de varios intentos', async () => {
    await login('mi-contrasena-secreta');
    await post('/api/auth/logout', {});

    for (let i = 0; i < 5; i++) await post('/api/auth/login', { password: 'no' });
    const blocked = await post('/api/auth/login', { password: 'mi-contrasena-secreta' });

    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/Demasiados intentos/);
  });

  it('cambiar la contrasena corta todas las sesiones', async () => {
    await login('contrasena-vieja');
    expect((await post('/api/auth/password', { current: 'contrasena-vieja', next: 'contrasena-nueva' })).status).toBe(200);
    expect((await api('/api/folders')).status).toBe(401);
    expect((await post('/api/auth/login', { password: 'contrasena-nueva' })).status).toBe(200);
  });

  it('rechaza un Host que no sea el loopback', async () => {
    // fetch no deja setear Host (es un header prohibido), asi que vamos con http crudo.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          path: '/api/auth/session',
          headers: { host: 'bitacora.ejemplo.com' }
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        }
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(421);
  });
});

describe('API con sesion', () => {
  beforeEach(async () => {
    await login();
  });

  it('lista carpetas y tags', async () => {
    const { carpetas } = await json<{ carpetas: { name: string }[] }>('/api/folders');
    expect(carpetas).toHaveLength(9);
    expect((await json<{ tags: unknown[] }>('/api/tags')).tags).toEqual([]);
  });

  it('crea, lee, edita y borra una nota', async () => {
    const created = await json<{ note: { id: string; title: string } }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ ...BASE_NOTE, title: 'Nota desde la web', tags: ['calidad'] })
    });
    expect(created.note.title).toBe('Nota desde la web');

    const detail = await json<{ note: { title: string; source: string }; markdown: string }>(
      `/api/notes/${created.note.id}`
    );
    expect(detail.note.source).toBe('manual');
    expect(detail.markdown).toContain('# Nota desde la web');

    await json(`/api/notes/${created.note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nota renombrada', tags: ['calidad', 'gmp'] })
    });
    const renamed = await json<{ note: { title: string; tags: string[] } }>(`/api/notes/${created.note.id}`);
    expect(renamed.note.title).toBe('Nota renombrada');
    expect(renamed.note.tags).toEqual(['calidad', 'gmp']);

    const deleted = await json<{ deleted: string }>(`/api/notes/${created.note.id}`, { method: 'DELETE' });
    expect(deleted.deleted).toBe('Nota renombrada');
    expect((await api(`/api/notes/${created.note.id}`)).status).toBe(404);
  });

  it('busca, filtra, ordena y devuelve el total', async () => {
    test.services.saveNote({ ...BASE_NOTE, title: 'Alfa desviacion', folder: 'Calidad' });
    test.services.saveNote({ ...BASE_NOTE, title: 'Beta dossier', folder: 'Regulatorios' });
    test.services.saveNote({ ...BASE_NOTE, title: 'Gamma dossier', folder: 'Regulatorios' });

    const all = await json<{ resultados: unknown[]; total: number }>('/api/notes');
    expect(all.total).toBe(3);

    const byFolder = await json<{ total: number }>('/api/notes?folder=Regulatorios');
    expect(byFolder.total).toBe(2);

    const byQuery = await json<{ resultados: { title: string }[] }>('/api/notes?query=dossier');
    expect(byQuery.resultados.map((r) => r.title).sort()).toEqual(['Beta dossier', 'Gamma dossier']);

    const byTitle = await json<{ resultados: { title: string }[] }>('/api/notes?sort=titulo');
    expect(byTitle.resultados.map((r) => r.title)).toEqual(['Alfa desviacion', 'Beta dossier', 'Gamma dossier']);

    const limited = await json<{ resultados: unknown[]; total: number }>('/api/notes?limit=1');
    expect(limited.resultados).toHaveLength(1);
    expect(limited.total).toBe(3);
  });

  it('marca un pendiente desde la web y lo escribe en la nota', async () => {
    const { note } = test.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota con tarea',
      pendientes: [{ accion: 'Cerrar CAPA', responsable: 'Calidad' }]
    });
    const { pendientes } = await json<{ pendientes: { id: string }[] }>('/api/pending');
    expect(pendientes).toHaveLength(1);

    await json(`/api/pending/${pendientes[0]!.id}/done`, { method: 'POST', body: JSON.stringify({ done: true }) });

    const detail = await json<{ markdown: string }>(`/api/notes/${note.id}`);
    expect(detail.markdown).toContain('- [x] Cerrar CAPA — Calidad');
    expect((await json<{ pendientes: unknown[] }>('/api/pending')).pendientes).toHaveLength(0);
  });

  it('renombra carpetas y fusiona tags', async () => {
    test.services.saveNote({ ...BASE_NOTE, title: 'Nota de calidad', folder: 'Calidad', tags: ['desvio'] });

    await json('/api/folders/Calidad', { method: 'PATCH', body: JSON.stringify({ name: 'Calidad y GMP' }) });
    expect((await json<{ resultados: unknown[] }>('/api/notes?folder=Calidad%20y%20GMP')).resultados).toHaveLength(1);

    await json('/api/tags/desvio', { method: 'PATCH', body: JSON.stringify({ name: 'desviacion' }) });
    const { tags } = await json<{ tags: { name: string }[] }>('/api/tags');
    expect(tags.map((t) => t.name)).toContain('desviacion');
    expect(tags.map((t) => t.name)).not.toContain('desvio');
  });

  it('devuelve el grafo global y el local', async () => {
    const a = test.services.saveNote({ ...BASE_NOTE, title: 'Nodo A' });
    test.services.saveNote({ ...BASE_NOTE, title: 'Nodo B', relacionados: ['Nodo A'] });

    const full = await json<{ nodes: unknown[]; edges: unknown[] }>('/api/graph');
    expect(full.nodes).toHaveLength(2);
    expect(full.edges).toHaveLength(1);

    const local = await json<{ nodes: unknown[] }>(`/api/graph/${a.note.id}?depth=1`);
    expect(local.nodes).toHaveLength(2);

    const withTags = await json<{ nodes: { id: string }[] }>('/api/graph?include_tags=true');
    expect(withTags.nodes.some((n) => n.id.startsWith('tag:'))).toBe(true);
  });

  it('exporta el vault como zip descargable', async () => {
    test.services.saveNote({ ...BASE_NOTE, title: 'Nota exportable' });
    const response = await api('/api/export/vault.zip');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/bitacora-vault-.*\.zip/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Firma de un archivo ZIP: "PK\x03\x04".
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('el estado resume el vault', async () => {
    test.services.saveNote({ ...BASE_NOTE, title: 'Una nota', relacionados: ['Inexistente'] });
    const status = await json<Record<string, unknown>>('/api/status');

    expect(status).toMatchObject({ notas: 1, carpetas: 9, enlacesSinResolver: 1 });
    expect(status.conectorRemoto).toMatchObject({ habilitado: false });
  });

  it('importa el zip del export de claude.ai', async () => {
    const zip = zipSync({ 'data/conversations.json': strToU8(JSON.stringify(EXPORT_CLAUDE)) });
    const response = await api('/api/import', {
      method: 'POST',
      body: Buffer.from(zip),
      headers: { 'content-type': 'application/octet-stream' }
    });

    expect(response.status).toBe(200);
    const report = (await response.json()) as { total: number; imported: unknown[]; archivo: string };
    expect(report).toMatchObject({ total: 2, archivo: 'data/conversations.json' });
    expect(report.imported).toHaveLength(2);

    const { resultados } = await json<{ resultados: { folder: string }[] }>('/api/notes?folder=Importado');
    expect(resultados).toHaveLength(2);
  });

  it('acepta el conversations.json suelto', async () => {
    const response = await api('/api/import', {
      method: 'POST',
      body: Buffer.from(JSON.stringify(EXPORT_CLAUDE)),
      headers: { 'content-type': 'application/octet-stream' }
    });
    expect(response.status).toBe(200);
    expect((await response.json()).imported).toHaveLength(2);
  });

  it('dry_run no escribe nada', async () => {
    const response = await api('/api/import?dry_run=true', {
      method: 'POST',
      body: Buffer.from(JSON.stringify(EXPORT_CLAUDE)),
      headers: { 'content-type': 'application/octet-stream' }
    });

    expect((await response.json())).toMatchObject({ dryRun: true, total: 2 });
    expect((await json<{ total: number }>('/api/notes')).total).toBe(0);
  });

  it('reimportar no duplica', async () => {
    const body = Buffer.from(JSON.stringify(EXPORT_CLAUDE));
    const headers = { 'content-type': 'application/octet-stream' };
    await api('/api/import', { method: 'POST', body, headers });
    const again = await api('/api/import', { method: 'POST', body, headers });

    expect((await again.json()).skipped).toHaveLength(2);
    expect((await json<{ total: number }>('/api/notes')).total).toBe(2);
  });

  it('explica el problema si el archivo no sirve', async () => {
    const response = await api('/api/import', {
      method: 'POST',
      body: Buffer.from('esto no es ni zip ni json'),
      headers: { 'content-type': 'application/octet-stream' }
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no es un zip ni un JSON/);
  });

  it('rechaza un import vacio', async () => {
    const response = await api('/api/import', {
      method: 'POST',
      body: Buffer.from(''),
      headers: { 'content-type': 'application/octet-stream' }
    });
    expect(response.status).toBe(400);
  });

  it('avisa que el resumidor esta apagado sin ANTHROPIC_API_KEY', async () => {
    const status = await json<{ resumidor: { habilitado: boolean; estado: string } }>('/api/status');
    expect(status.resumidor.habilitado).toBe(false);
    expect(status.resumidor.estado).toMatch(/sin-resumir/);
  });

  it('un id inexistente devuelve 404 con mensaje entendible', async () => {
    const response = await api('/api/notes/no-existe');
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/No existe ninguna nota/);
  });
});
