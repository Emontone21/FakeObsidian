import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseDateFlexible } from '@bitacora/shared';
import { z } from 'zod';
import { BitacoraError } from '../services/errors.js';
import type { Services } from '../services/index.js';
import {
  getNoteShape,
  graphShape,
  listPendingShape,
  saveNoteShape,
  searchNotesShape,
  updateNoteShape
} from './schemas.js';

export const SERVER_NAME = 'bitacora';
export const SERVER_VERSION = '0.1.0';

/** Lo primero que lee Claude al conectarse: explica para que sirve el vault. */
export const SERVER_INSTRUCTIONS = `Bitacora es la base de conocimiento personal del usuario: guarda resumenes estructurados de conversaciones con Claude, con contexto, decisiones, pendientes y referencias, enlazados entre si con [[wikilinks]] al estilo Obsidian.

Flujo recomendado para archivar una conversacion:
1. list_folders y list_tags para reusar la taxonomia que ya existe en vez de inventar una nueva.
2. search_notes con las palabras clave del tema, para encontrar notas relacionadas y pasarlas en "relacionados".
3. save_note con los campos estructurados. El servidor arma el markdown con la plantilla fija: vos no escribis markdown a mano.

Reglas de contenido:
- Espanol neutro (sin voseo) en el contenido archivado: es material de referencia profesional.
- Nunca inventes normas, capitulos de farmacopea ni numeros de SOP. Si no se cito nada concreto en la conversacion, manda "referencias" vacio.
- Anonimiza datos personales identificables (pacientes, documentos, historias clinicas) antes de enviarlos, y avisale al usuario que lo hiciste.
- El contexto de uso es industria farmaceutica: calidad, regulatorios, I+D y farmacovigilancia.

Las notas se borran unicamente desde la interfaz web, nunca por MCP.`;

const json = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
});

/** Traduce los errores de dominio a un mensaje accionable para el cliente MCP. */
function guard(run: () => CallToolResult): CallToolResult {
  try {
    return run();
  } catch (error) {
    const message =
      error instanceof BitacoraError
        ? error.message
        : `Error inesperado al operar sobre el vault: ${(error as Error).message}`;
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

function pendingInputs(items: { accion: string; responsable?: string; fecha?: string }[] | undefined) {
  return items?.map((p) => ({
    accion: p.accion,
    responsable: p.responsable ?? null,
    fecha: p.fecha ? parseDateFlexible(p.fecha) : null
  }));
}

function noteSummary(services: Services, id: string) {
  const detail = services.requireNoteDetail(id);
  return {
    id: detail.note.id,
    title: detail.note.title,
    folder: detail.note.folder,
    date: detail.note.date,
    tags: detail.note.tags,
    url: detail.url
  };
}

export function createMcpServer(services: Services): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    'list_folders',
    {
      title: 'Listar carpetas',
      description:
        'Devuelve las carpetas tematicas del vault con la cantidad de notas de cada una. Llamalo SIEMPRE antes de save_note: la idea es reusar una carpeta existente y no crear variantes parecidas (por ejemplo "Regulatorio" cuando ya existe "Regulatorios").',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    () => guard(() => json({ carpetas: services.listFolders() }))
  );

  server.registerTool(
    'list_tags',
    {
      title: 'Listar tags',
      description:
        'Devuelve los tags en uso con la cantidad de notas de cada uno, ordenados por uso. Llamalo antes de save_note para reusar tags existentes en vez de crear sinonimos. La convencion es minusculas, sin acentos y con guiones; el servidor normaliza lo que le mandes.',
      inputSchema: {
        prefix: z.string().optional().describe('Filtra los tags que empiezan con este texto.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ prefix }) => guard(() => json({ tags: services.listTags(prefix) }))
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Buscar notas',
      description:
        'Busqueda de texto completo sobre titulo, resumen y cuerpo, mas filtros por carpeta, tags y rango de fechas. Ignora acentos y admite coincidencia por prefijo. Usalo antes de save_note para encontrar notas relacionadas y pasar sus titulos en "relacionados": es lo que mantiene vivo el grafo. "score" es la relevancia relativa dentro de esta busqueda (100 = el mejor resultado).',
      inputSchema: searchNotesShape,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    (args) =>
      guard(() =>
        json({
          resultados: services.searchNotes({
            query: args.query ?? null,
            folder: args.folder ?? null,
            tags: args.tags ?? null,
            dateFrom: args.date_from ?? null,
            dateTo: args.date_to ?? null,
            limit: args.limit
          })
        })
      )
  );

  server.registerTool(
    'get_note',
    {
      title: 'Leer una nota',
      description:
        'Devuelve una nota completa en markdown (con su frontmatter), mas sus enlaces salientes, sus backlinks y sus pendientes. Se puede pedir por id o por titulo exacto.',
      inputSchema: getNoteShape,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ id, title }) =>
      guard(() => {
        const key = id ?? title;
        if (!key) {
          throw new BitacoraError('INVALID_INPUT', 'Pasa "id" o "title" para identificar la nota.');
        }
        const detail = services.requireNoteDetail(key);
        return json({
          id: detail.note.id,
          title: detail.note.title,
          folder: detail.note.folder,
          date: detail.note.date,
          time: detail.note.time,
          tags: detail.note.tags,
          status: detail.note.status,
          summary: detail.note.summary,
          url: detail.url,
          markdown: detail.markdown,
          outlinks: detail.outlinks.map((l) => ({
            titulo: l.targetTitle,
            id: l.note?.id ?? null,
            resuelto: l.note !== null
          })),
          backlinks: detail.backlinks,
          pendientes: detail.pending.map((p) => ({
            pending_id: p.id,
            accion: p.action,
            responsable: p.owner,
            fecha: p.dueDate,
            hecho: p.done
          }))
        });
      })
  );

  server.registerTool(
    'save_note',
    {
      title: 'Guardar una conversacion como nota',
      description:
        'Crea una nota nueva a partir de campos estructurados. El servidor arma el markdown con la plantilla fija (Contexto, Decisiones, Pendientes, Referencias, Notas adicionales, Relacionado), le pone fecha y hora en la zona horaria del usuario, normaliza los tags y convierte "relacionados" en [[wikilinks]].\n\nAntes de llamarlo: list_folders y list_tags para reusar la taxonomia, y search_notes para encontrar notas relacionadas. No escribas markdown a mano ni inventes referencias. Los titulos son unicos en el vault: si el titulo ya existe, el servidor le agrega " (2)" y te lo informa. Devuelve el id y la URL de la nota en la web.',
      inputSchema: saveNoteShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) =>
      guard(() => {
        const result = services.saveNote({
          title: args.title,
          folder: args.folder,
          tags: args.tags,
          summary: args.summary,
          contexto: args.contexto,
          decisiones: args.decisiones,
          pendientes: pendingInputs(args.pendientes) ?? [],
          referencias: args.referencias,
          notasAdicionales: args.notas_adicionales ?? null,
          relacionados: args.relacionados,
          tipoSeccion: args.tipo_seccion,
          sourceUrl: args.source_url ?? null,
          sourceConversationId: args.source_conversation_id ?? null
        });

        const avisos: string[] = [];
        if (result.titleAdjusted) {
          avisos.push(`Ya existia una nota con ese titulo, asi que se guardo como "${result.note.title}".`);
        }
        if (result.folderCreated) {
          avisos.push(`Se creo la carpeta "${result.note.folder}", que no existia.`);
        }
        if (result.unresolvedLinks.length > 0) {
          avisos.push(
            `Estos enlaces quedaron sin resolver porque todavia no existe la nota: ${result.unresolvedLinks.join(', ')}.`
          );
        }

        return json({
          id: result.note.id,
          title: result.note.title,
          folder: result.note.folder,
          tags: result.note.tags,
          date: result.note.date,
          time: result.note.time,
          url: result.url,
          avisos
        });
      })
  );

  server.registerTool(
    'update_note',
    {
      title: 'Actualizar una nota',
      description:
        'Modifica una nota existente. Podes mandar solo las secciones que cambian (cada campo REEMPLAZA esa seccion entera) o "body_markdown" para reescribir el cuerpo completo, pero no las dos cosas a la vez. Para SUMAR bullets sin pisar lo que ya estaba, usa append_to_note. Recalcula enlaces y pendientes, y si cambia el titulo reescribe los [[wikilinks]] que apuntaban a la nota.',
      inputSchema: updateNoteShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) =>
      guard(() => {
        const result = services.updateNote(args.id, {
          title: args.title,
          folder: args.folder,
          tags: args.tags,
          summary: args.summary,
          contexto: args.contexto,
          decisiones: args.decisiones,
          pendientes: pendingInputs(args.pendientes),
          referencias: args.referencias,
          notasAdicionales: args.notas_adicionales,
          relacionados: args.relacionados,
          tipoSeccion: args.tipo_seccion,
          status: args.status,
          bodyMarkdown: args.body_markdown
        });

        const avisos: string[] = [];
        if (result.titleAdjusted) avisos.push(`El titulo quedo como "${result.note.title}" para no chocar con otra nota.`);
        if (result.folderCreated) avisos.push(`Se creo la carpeta "${result.note.folder}".`);
        if (result.unresolvedLinks.length > 0) {
          avisos.push(`Enlaces sin resolver: ${result.unresolvedLinks.join(', ')}.`);
        }

        return json({
          id: result.note.id,
          title: result.note.title,
          folder: result.note.folder,
          tags: result.note.tags,
          url: result.url,
          avisos
        });
      })
  );

  server.registerTool(
    'append_to_note',
    {
      title: 'Agregar contenido a una seccion',
      description:
        'Suma markdown al final de una seccion que ya existe, sin tocar el resto de la nota. Es lo indicado para agregar decisiones o pendientes nuevos a una nota vieja. Manda las lineas ya formateadas: "- Texto de la decision" o "- [ ] Accion - Responsable - DD/MM/AAAA". Si la seccion no existe, el error te dice cuales hay.',
      inputSchema: {
        id: z.string().min(1).describe('Id (ULID) o titulo de la nota.'),
        section: z
          .string()
          .min(1)
          .describe('Nombre de la seccion: Contexto, Decisiones (o Conclusiones), Pendientes, Referencias, Notas adicionales o Relacionado.'),
        markdown: z.string().min(1).describe('Markdown a agregar, normalmente una o varias vinetas.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    ({ id, section, markdown }) =>
      guard(() => {
        const note = services.appendToNote(id, section, markdown);
        return json({ ...noteSummary(services, note.id), seccion: section });
      })
  );

  server.registerTool(
    'link_notes',
    {
      title: 'Enlazar dos notas',
      description:
        'Agrega un [[wikilink]] a la seccion "Relacionado" de la nota origen. Si la nota destino todavia no existe, queda como enlace sin resolver y se conecta sola cuando la crees. No duplica un enlace que ya estaba.',
      inputSchema: {
        from_id: z.string().min(1).describe('Id o titulo de la nota origen: es la que se modifica.'),
        to_id: z.string().optional().describe('Id de la nota destino.'),
        to_title: z.string().optional().describe('Titulo de la nota destino, si no tenes el id.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    ({ from_id, to_id, to_title }) =>
      guard(() => {
        const target = to_id ?? to_title;
        if (!target) {
          throw new BitacoraError('INVALID_INPUT', 'Pasa "to_id" o "to_title" para indicar la nota destino.');
        }
        const result = services.linkNotes(from_id, target);
        return json({
          id: result.from.id,
          title: result.from.title,
          enlazada_a: result.targetTitle,
          resuelto: result.resolved,
          ya_estaba: result.alreadyLinked,
          aviso: result.resolved
            ? null
            : `Todavia no existe una nota titulada "${result.targetTitle}": el enlace queda pendiente de resolver.`
        });
      })
  );

  server.registerTool(
    'list_pending',
    {
      title: 'Listar pendientes',
      description:
        'Devuelve los pendientes de todas las notas, con su nota de origen, responsable y fecha limite. Por defecto solo los no hechos. Cada item trae un "pending_id" que se usa en complete_pending.',
      inputSchema: listPendingShape,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    (args) =>
      guard(() =>
        json({
          pendientes: services
            .listPending({
              owner: args.owner ?? null,
              dueBefore: args.due_before ?? null,
              noteId: args.note_id ?? null,
              includeDone: args.include_done ?? false
            })
            .map((p) => ({
              pending_id: p.id,
              accion: p.action,
              responsable: p.owner,
              fecha: p.dueDate,
              hecho: p.done,
              nota: { id: p.noteId, title: p.noteTitle, folder: p.noteFolder }
            }))
        })
      )
  );

  server.registerTool(
    'complete_pending',
    {
      title: 'Marcar un pendiente como hecho',
      description:
        'Marca un pendiente como hecho reescribiendo la linea en el cuerpo de la nota ("- [ ]" pasa a "- [x]"). La nota es la fuente de verdad. El "pending_id" sale de list_pending o de get_note.',
      inputSchema: {
        pending_id: z.string().min(1).describe('Id del pendiente, tal como lo devuelve list_pending.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    ({ pending_id }) =>
      guard(() => {
        const result = services.setPendingDone(pending_id, true);
        return json({
          pending_id: result.pending.id,
          accion: result.pending.action,
          hecho: true,
          ya_estaba_hecho: !result.changed,
          nota: noteSummary(services, result.note.id)
        });
      })
  );

  server.registerTool(
    'get_graph_neighborhood',
    {
      title: 'Ver el entorno de una nota en el grafo',
      description:
        'Devuelve los nodos y las aristas alrededor de una nota, siguiendo los [[wikilinks]] en los dos sentidos. Sirve para entender con que se conecta un tema antes de escribir una nota nueva.',
      inputSchema: graphShape,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ id, depth, include_phantoms }) =>
      guard(() => {
        const note = services.requireNoteDetail(id);
        const graph = services.getNeighborhood(note.note.id, depth ?? 1, {
          includePhantoms: include_phantoms ?? false
        });
        return json({ centro: note.note.id, ...graph });
      })
  );

  server.registerTool(
    'list_recent_notes',
    {
      title: 'Listar notas recientes',
      description: 'Las ultimas notas modificadas, de la mas reciente a la mas vieja. Util para retomar donde quedaste.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Cuantas devolver. Por defecto 10.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ limit }) =>
      guard(() =>
        json({
          notas: services.listRecentNotes(limit ?? 10).map((n) => ({
            id: n.id,
            title: n.title,
            folder: n.folder,
            date: n.date,
            tags: n.tags,
            summary: n.summary
          }))
        })
      )
  );

  server.registerPrompt(
    'guardar-conversacion',
    {
      title: 'Guardar esta conversacion en Bitacora',
      description:
        'Instrucciones completas para archivar la conversacion actual como nota estructurada, reusando la taxonomia y los enlaces que ya existen en el vault.',
      argsSchema: {
        tema: z
          .string()
          .optional()
          .describe('Opcional: si la conversacion toco varios temas, cual archivar.')
      }
    },
    ({ tema }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Archiva ${tema ? `la parte de esta conversacion sobre "${tema}"` : 'esta conversacion'} en Bitacora siguiendo estos pasos:

1. Corre list_folders y list_tags. Reusa una carpeta y tags existentes; solo crea nuevos si ninguno encaja.
2. Corre search_notes con las palabras clave del tema. Lo que encuentres va en "relacionados": son los [[wikilinks]] que arman el grafo.
3. Llama a save_note con los campos estructurados. No escribas markdown a mano: la plantilla la renderiza el servidor.

Como llenar cada campo:
- title: 4 a 10 palabras, descriptivo, SIN la fecha adelante.
- summary: una o dos oraciones; es lo que se ve en las tarjetas y en el grafo.
- contexto: 2 a 5 oraciones que se entiendan sin haber visto la conversacion. Inclui producto, lote, area o norma si corresponde.
- decisiones: una decision o acuerdo por elemento. Si hubo analisis pero no decisiones cerradas, manda tipo_seccion: "conclusiones".
- pendientes: accion, responsable y fecha limite (DD/MM/AAAA), solo si se acordaron de verdad.
- referencias: SOLO lo que se cito explicitamente en la conversacion. Nunca inventes normas, capitulos de farmacopea ni numeros de SOP; si no hubo nada concreto, manda la lista vacia.
- notas_adicionales: razonamientos, alternativas descartadas, bloques de codigo, tablas o calculos. No los resumas, copialos textuales.

Antes de guardar:
- Escribi en espanol neutro, sin voseo: es material de referencia profesional.
- Anonimiza datos personales identificables (pacientes, documentos, historias clinicas) y avisame que lo hiciste.

Cuando termines, decime en que carpeta quedo, con que tags, y pasame la URL que devolvio save_note.`
          }
        }
      ]
    })
  );

  return server;
}
