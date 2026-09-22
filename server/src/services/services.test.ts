import { getSection, listSectionNames, parsePendingItems } from '@bitacora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, BASE_NOTE, type TestApp } from '../testing.js';

let app: TestApp;

beforeEach(() => {
  app = createTestApp();
});

afterEach(() => {
  app.close();
});

describe('saveNote', () => {
  it('guarda la nota con la plantilla y devuelve la URL de la web', () => {
    const result = app.services.saveNote({ ...BASE_NOTE, title: 'OOS lote AMX-2401' });

    expect(result.note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.url).toBe(`${app.config.webBaseUrl}/nota/${result.note.id}`);
    expect(listSectionNames(result.note.body)).toEqual([
      'Contexto',
      'Decisiones',
      'Pendientes',
      'Referencias',
      'Notas adicionales',
      'Relacionado'
    ]);
    expect(result.note.status).toBe('archivado');
    expect(result.note.source).toBe('claude');
  });

  it('pone claude primero y normaliza los tags', () => {
    const { note } = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota con tags',
      tags: ['Desviación', 'BATCH RECORD', 'desviacion']
    });
    expect(note.tags).toEqual(['claude', 'desviacion', 'batch-record']);
  });

  it('sella fecha y hora con la zona horaria configurada', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota fechada' });
    expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(note.time).toMatch(/^\d{2}:\d{2}$/);
    expect(note.createdAt).toContain('-03:00');
  });

  it('agrega sufijo cuando el titulo ya existe', () => {
    app.services.saveNote({ ...BASE_NOTE, title: 'Informe mensual' });
    const dup = app.services.saveNote({ ...BASE_NOTE, title: 'Informe mensual' });
    const dup3 = app.services.saveNote({ ...BASE_NOTE, title: 'informe MENSUAL' });

    expect(dup.note.title).toBe('Informe mensual (2)');
    expect(dup.titleAdjusted).toBe(true);
    expect(dup3.note.title).toBe('informe MENSUAL (3)');
  });

  it('crea la carpeta si no existia y lo informa', () => {
    const result = app.services.saveNote({ ...BASE_NOTE, title: 'Nota nueva', folder: 'Proyectos' });
    expect(result.folderCreated).toBe(true);
    expect(app.services.listFolders().map((f) => f.name)).toContain('Proyectos');

    const second = app.services.saveNote({ ...BASE_NOTE, title: 'Otra nota', folder: 'Proyectos' });
    expect(second.folderCreated).toBe(false);
  });

  it('convierte relacionados en wikilinks y avisa cuales no resuelven', () => {
    const target = app.services.saveNote({ ...BASE_NOTE, title: 'Plan de validacion' });
    const result = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Desviacion DV-014',
      relacionados: ['Plan de validacion', 'Nota que no existe']
    });

    expect(getSection(result.note.body, 'Relacionado')).toBe(
      '- [[Plan de validacion]]\n- [[Nota que no existe]]'
    );
    expect(result.unresolvedLinks).toEqual(['Nota que no existe']);

    const detail = app.services.requireNoteDetail(result.note.id);
    expect(detail.outlinks.find((l) => l.targetTitle === 'Plan de validacion')?.note?.id).toBe(target.note.id);
    expect(detail.outlinks.find((l) => l.targetTitle === 'Nota que no existe')?.note).toBeNull();
  });

  it('extrae los pendientes del body al guardar', () => {
    const { note } = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota con pendientes',
      pendientes: [
        { accion: 'Re-analizar el lote', responsable: 'Control de Calidad', fecha: '30/05/2026' },
        { accion: 'Cerrar CAPA' }
      ]
    });

    const pending = app.services.listPending({ noteId: note.id });
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({
      action: 'Re-analizar el lote',
      owner: 'Control de Calidad',
      dueDate: '2026-05-30',
      done: false,
      noteTitle: 'Nota con pendientes'
    });
  });
});

describe('enlaces', () => {
  it('una nota nueva adopta los enlaces fantasma que ya la apuntaban', () => {
    const source = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota que enlaza',
      relacionados: ['Nota futura']
    });
    expect(source.unresolvedLinks).toEqual(['Nota futura']);

    const future = app.services.saveNote({ ...BASE_NOTE, title: 'Nota futura' });
    const detail = app.services.requireNoteDetail(source.note.id);

    expect(detail.outlinks[0]?.note?.id).toBe(future.note.id);
    expect(app.services.requireNoteDetail(future.note.id).backlinks.map((b) => b.id)).toEqual([source.note.id]);
  });

  it('link_notes agrega el wikilink en Relacionado sin duplicar', () => {
    const a = app.services.saveNote({ ...BASE_NOTE, title: 'Nota A' });
    const b = app.services.saveNote({ ...BASE_NOTE, title: 'Nota B' });

    const first = app.services.linkNotes(a.note.id, b.note.id);
    expect(first.alreadyLinked).toBe(false);
    expect(first.resolved).toBe(true);
    expect(getSection(first.from.body, 'Relacionado')).toBe('- [[Nota B]]');

    const second = app.services.linkNotes(a.note.id, 'Nota B');
    expect(second.alreadyLinked).toBe(true);
    expect(app.services.requireNoteDetail(a.note.id).outlinks).toHaveLength(1);
  });

  it('borrar una nota deja sus backlinks sin resolver en vez de perderlos', () => {
    const target = app.services.saveNote({ ...BASE_NOTE, title: 'Nota destino' });
    const source = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota origen',
      relacionados: ['Nota destino']
    });

    app.services.deleteNote(target.note.id);
    const detail = app.services.requireNoteDetail(source.note.id);

    expect(detail.outlinks).toHaveLength(1);
    expect(detail.outlinks[0]).toMatchObject({ targetTitle: 'Nota destino', note: null });
  });
});

describe('updateNote', () => {
  it('reemplaza solo la seccion pedida', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota editable' });
    const updated = app.services.updateNote(note.id, { referencias: ['Guia FDA OOS (2022)'] });

    expect(getSection(updated.note.body, 'Referencias')).toBe('- Guia FDA OOS (2022)');
    expect(getSection(updated.note.body, 'Contexto')).toBe('Contexto de prueba.');
    expect(updated.note.updatedAt >= note.updatedAt).toBe(true);
  });

  it('renombra Decisiones a Conclusiones conservando el contenido', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota analitica' });
    const updated = app.services.updateNote(note.id, { tipoSeccion: 'conclusiones' });

    expect(listSectionNames(updated.note.body)).toContain('Conclusiones');
    expect(listSectionNames(updated.note.body)).not.toContain('Decisiones');
    expect(getSection(updated.note.body, 'Conclusiones')).toBe('- Una decision.');
  });

  it('renombrar una nota reescribe los wikilinks que la apuntaban', () => {
    const target = app.services.saveNote({ ...BASE_NOTE, title: 'Titulo viejo' });
    const source = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota que enlaza',
      relacionados: ['Titulo viejo']
    });

    app.services.updateNote(target.note.id, { title: 'Titulo nuevo' });
    const detail = app.services.requireNoteDetail(source.note.id);

    expect(getSection(detail.note.body, 'Relacionado')).toBe('- [[Titulo nuevo]]');
    expect(detail.outlinks[0]?.note?.id).toBe(target.note.id);
  });

  it('rechaza mezclar body_markdown con campos por seccion', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota mixta' });
    expect(() =>
      app.services.updateNote(note.id, { bodyMarkdown: '## Contexto\n\nHola', contexto: 'Otro' })
    ).toThrow(/body_markdown/);
  });

  it('reemplaza el body entero con body_markdown', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota reescrita' });
    const updated = app.services.updateNote(note.id, {
      bodyMarkdown: '## Contexto\n\nTodo nuevo.\n\n## Pendientes\n\n- [ ] Tarea nueva — Calidad'
    });

    expect(listSectionNames(updated.note.body)).toEqual(['Contexto', 'Pendientes']);
    expect(app.services.listPending({ noteId: note.id })[0]?.action).toBe('Tarea nueva');
  });
});

describe('appendToNote', () => {
  it('suma bullets a una seccion existente', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota que crece' });
    const updated = app.services.appendToNote(note.id, 'Decisiones', '- Segunda decision.');

    expect(getSection(updated.body, 'Decisiones')).toBe('- Una decision.\n- Segunda decision.');
  });

  it('indexa los pendientes agregados', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota con pendiente nuevo' });
    app.services.appendToNote(note.id, 'Pendientes', '- [ ] Revisar SOP — Metrologia — 12/06/2026');

    const pending = app.services.listPending({ noteId: note.id });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ action: 'Revisar SOP', owner: 'Metrologia', dueDate: '2026-06-12' });
  });

  it('avisa que la seccion no existe y cuales hay', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota sin anexos' });
    expect(() => app.services.appendToNote(note.id, 'Anexos', '- algo')).toThrow(/Secciones disponibles/);
  });
});

describe('pendientes', () => {
  it('completar reescribe la linea en el body: la nota es la fuente de verdad', () => {
    const { note } = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota con tarea',
      pendientes: [{ accion: 'Cerrar CAPA', responsable: 'Calidad', fecha: '05/06/2026' }]
    });

    const pendingId = app.services.listPending({ noteId: note.id })[0]!.id;
    const result = app.services.setPendingDone(pendingId, true);

    expect(result.changed).toBe(true);
    expect(result.note.body).toContain('- [x] Cerrar CAPA — Calidad — 05/06/2026');
    expect(parsePendingItems(result.note.body)[0]?.done).toBe(true);
    expect(app.services.listPending({ noteId: note.id })).toHaveLength(0);
    expect(app.services.listPending({ noteId: note.id, includeDone: true })).toHaveLength(1);
  });

  it('mantiene el id del pendiente despues de editar la nota', () => {
    const { note } = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota estable',
      pendientes: [{ accion: 'Tarea estable', responsable: 'Calidad' }]
    });
    const before = app.services.listPending({ noteId: note.id })[0]!.id;

    app.services.updateNote(note.id, { contexto: 'Contexto cambiado.' });
    const after = app.services.listPending({ noteId: note.id })[0]!.id;

    expect(after).toBe(before);
  });

  it('get_note devuelve los pendientes en el orden del cuerpo, no en el del tablero', () => {
    const { note } = app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota con pendientes ordenados',
      pendientes: [
        // El primero ya hecho y con fecha lejana: el tablero lo pondria ultimo.
        { accion: 'Primero del cuerpo', fecha: '30/12/2026', hecho: true },
        { accion: 'Segundo del cuerpo', fecha: '01/01/2026' }
      ]
    });

    const detail = app.services.requireNoteDetail(note.id);
    expect(detail.pending.map((p) => p.action)).toEqual(['Primero del cuerpo', 'Segundo del cuerpo']);
    // El tablero si los ordena por estado y vencimiento.
    expect(app.services.listPending({ includeDone: true }).map((p) => p.action)).toEqual([
      'Segundo del cuerpo',
      'Primero del cuerpo'
    ]);
  });

  it('filtra por responsable y por fecha limite', () => {
    app.services.saveNote({
      ...BASE_NOTE,
      title: 'Nota de pendientes varios',
      pendientes: [
        { accion: 'Tarea temprana', responsable: 'Calidad', fecha: '01/06/2026' },
        { accion: 'Tarea tardia', responsable: 'Produccion', fecha: '30/09/2026' }
      ]
    });

    expect(app.services.listPending({ owner: 'calidad' }).map((p) => p.action)).toEqual(['Tarea temprana']);
    expect(app.services.listPending({ dueBefore: '2026-06-30' }).map((p) => p.action)).toEqual(['Tarea temprana']);
  });
});

describe('busqueda', () => {
  beforeEach(() => {
    app.services.saveNote({
      ...BASE_NOTE,
      title: 'Desviación de temperatura en cámara',
      tags: ['calidad', 'desviacion'],
      summary: 'Excursión térmica en la cámara de estabilidad.',
      contexto: 'Se registró una excursión de temperatura durante el fin de semana.'
    });
    app.services.saveNote({
      ...BASE_NOTE,
      title: 'Dossier de registro ANMAT',
      folder: 'Regulatorios',
      tags: ['regulatorios', 'anmat'],
      summary: 'Armado del dossier para ANMAT.',
      contexto: 'Preparación del expediente de registro sanitario.'
    });
  });

  it('encuentra sin importar los acentos', () => {
    expect(app.services.searchNotes({ query: 'desviacion' }).map((h) => h.title)).toEqual([
      'Desviación de temperatura en cámara'
    ]);
    expect(app.services.searchNotes({ query: 'DESVIACIÓN' })).toHaveLength(1);
  });

  it('busca por prefijo', () => {
    expect(app.services.searchNotes({ query: 'excurs' })).toHaveLength(1);
  });

  it('filtra por carpeta y por tag', () => {
    expect(app.services.searchNotes({ folder: 'Regulatorios' }).map((h) => h.title)).toEqual([
      'Dossier de registro ANMAT'
    ]);
    expect(app.services.searchNotes({ tags: ['anmat'] })).toHaveLength(1);
    expect(app.services.searchNotes({ tags: ['anmat', 'calidad'] })).toHaveLength(0);
  });

  it('sin consulta devuelve las notas mas recientes', () => {
    expect(app.services.searchNotes({})).toHaveLength(2);
  });

  it('no se rompe con signos raros en la consulta', () => {
    expect(() => app.services.searchNotes({ query: 'AND OR "(' })).not.toThrow();
  });

  it('devuelve tags, fragmento y relevancia relativa en cada resultado', () => {
    const hit = app.services.searchNotes({ query: 'dossier' })[0]!;
    expect(hit.tags).toEqual(['claude', 'regulatorios', 'anmat']);
    expect(hit.score).toBe(100);
    expect(hit.snippet).toBeTruthy();
  });

  it('ordena por relevancia y escala el puntaje contra el mejor resultado', () => {
    const hits = app.services.searchNotes({ query: 'de' });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]?.score).toBe(100);
    expect(hits[1]!.score).toBeLessThanOrEqual(hits[0]!.score);
  });
});

describe('grafo', () => {
  it('devuelve la vecindad con la profundidad pedida', () => {
    const a = app.services.saveNote({ ...BASE_NOTE, title: 'Nodo A' });
    const b = app.services.saveNote({ ...BASE_NOTE, title: 'Nodo B', relacionados: ['Nodo A'] });
    const c = app.services.saveNote({ ...BASE_NOTE, title: 'Nodo C', relacionados: ['Nodo B'] });

    const depth1 = app.services.getNeighborhood(a.note.id, 1);
    expect(depth1.nodes.map((n) => n.id).sort()).toEqual([a.note.id, b.note.id].sort());
    expect(depth1.edges).toEqual([{ source: b.note.id, target: a.note.id, kind: 'wikilink' }]);

    const depth2 = app.services.getNeighborhood(a.note.id, 2);
    expect(depth2.nodes).toHaveLength(3);
    expect(depth2.nodes.find((n) => n.id === c.note.id)).toBeDefined();
  });

  it('puede incluir los enlaces sin resolver como nodos fantasma', () => {
    const a = app.services.saveNote({ ...BASE_NOTE, title: 'Nodo con fantasma', relacionados: ['Nota inexistente'] });

    expect(app.services.getNeighborhood(a.note.id, 1).nodes).toHaveLength(1);
    const withPhantoms = app.services.getNeighborhood(a.note.id, 1, { includePhantoms: true });
    expect(withPhantoms.nodes.find((n) => n.phantom)?.title).toBe('Nota inexistente');
  });

  it('el grafo global puede sumar los tags como nodos', () => {
    app.services.saveNote({ ...BASE_NOTE, title: 'Nota con tag', tags: ['gmp'] });
    const graph = app.services.getFullGraph({ includeTags: true });

    expect(graph.nodes.find((n) => n.title === '#gmp')).toBeDefined();
    expect(graph.edges.some((e) => e.kind === 'tag')).toBe(true);
  });
});

describe('exportacion', () => {
  it('produce un .md valido para Obsidian', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota exportable', tags: ['gmp'] });
    const [file] = app.services.exportVault();

    expect(file?.path).toBe(`Calidad/${note.date} - Nota exportable.md`);
    expect(file?.content.startsWith('---\n')).toBe(true);
    expect(file?.content).toContain('tags: [claude, gmp]');
    expect(file?.content).toContain('# Nota exportable');
    expect(file?.content).toContain('## Contexto');
  });
});

describe('carpetas y tags', () => {
  it('renombrar una carpeta mueve sus notas', () => {
    const { note } = app.services.saveNote({ ...BASE_NOTE, title: 'Nota a mover', folder: 'Calidad' });
    app.services.renameFolder('Calidad', 'Calidad y GMP');

    expect(app.services.getNote(note.id)?.note.folder).toBe('Calidad y GMP');
  });

  it('renombrar a una carpeta existente fusiona', () => {
    app.services.saveNote({ ...BASE_NOTE, title: 'Nota TI', folder: 'TI' });
    app.services.renameFolder('TI', 'General');

    expect(app.services.listFolders().map((f) => f.name)).not.toContain('TI');
    expect(app.services.listFolders().find((f) => f.name === 'General')?.noteCount).toBe(1);
  });

  it('renombrar un tag existente lo fusiona sin duplicar notas', () => {
    app.services.saveNote({ ...BASE_NOTE, title: 'Nota uno', tags: ['desvio'] });
    app.services.saveNote({ ...BASE_NOTE, title: 'Nota dos', tags: ['desviacion'] });
    app.services.renameTag('desvio', 'desviacion');

    const tags = app.services.listTags();
    expect(tags.find((t) => t.name === 'desvio')).toBeUndefined();
    expect(tags.find((t) => t.name === 'desviacion')?.noteCount).toBe(2);
  });

  it('list_folders cuenta las notas de cada carpeta', () => {
    app.services.saveNote({ ...BASE_NOTE, title: 'Una', folder: 'Calidad' });
    app.services.saveNote({ ...BASE_NOTE, title: 'Dos', folder: 'Calidad' });

    expect(app.services.listFolders().find((f) => f.name === 'Calidad')?.noteCount).toBe(2);
    expect(app.services.listFolders().find((f) => f.name === 'TI')?.noteCount).toBe(0);
  });
});
