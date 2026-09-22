import { parseDateFlexible } from '@bitacora/shared';
import { z } from 'zod';

export const fechaSchema = z
  .string()
  .refine((value) => parseDateFlexible(value) !== null, {
    message: 'Fecha invalida. Usa DD/MM/AAAA (o AAAA-MM-DD).'
  });

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.');

export const pendienteSchema = z.object({
  accion: z.string().min(1).describe('Que hay que hacer, en infinitivo. Ej: "Re-analizar el lote AMX-2401".'),
  responsable: z
    .string()
    .optional()
    .describe('Area o persona a cargo, tal como se menciono en la conversacion. Omitir si no se dijo.'),
  fecha: fechaSchema.optional().describe('Fecha limite en DD/MM/AAAA. Omitir si no se acordo una.')
});

/** Campos de contenido de la nota, compartidos por save_note y update_note. */
export const contentShape = {
  folder: z
    .string()
    .min(1)
    .describe(
      'Carpeta tematica. Llama antes a list_folders y reusa una existente; solo crea una nueva si ninguna encaja.'
    ),
  tags: z
    .array(z.string())
    .describe(
      'Tags tematicos. El servidor los normaliza (minusculas, sin acentos, con guiones). Al crear una nota agrega "claude" al principio; al actualizarla, la lista que mandes reemplaza a la anterior tal cual. Llama antes a list_tags para reusar los que ya existen.'
    ),
  summary: z
    .string()
    .min(1)
    .describe('Una o dos oraciones que resumen la nota. Se muestra en las tarjetas y en los tooltips del grafo.'),
  contexto: z
    .string()
    .min(1)
    .describe(
      'Dos a cinco oraciones que expliquen el problema o la pregunta inicial. Tiene que entenderse sin haber visto la conversacion: inclui producto, lote, area o norma si corresponde.'
    ),
  decisiones: z
    .array(z.string())
    .describe('Una decision, acuerdo o conclusion por elemento, sin la vineta inicial.'),
  pendientes: z.array(pendienteSchema).describe('Acciones a futuro acordadas en la conversacion.'),
  referencias: z
    .array(z.string())
    .describe(
      'Documentos, normas, guias o links mencionados EN LA CONVERSACION. Nunca inventes normas, capitulos de farmacopea ni numeros de SOP: si no se cito nada concreto, manda la lista vacia.'
    ),
  notas_adicionales: z
    .string()
    .optional()
    .describe(
      'Opcional. Detalles que no entran en las otras secciones: razonamientos, alternativas descartadas, bloques de codigo, tablas o calculos. No resumas el codigo ni las tablas, copialos textuales.'
    ),
  relacionados: z
    .array(z.string())
    .describe(
      'Titulos (o ids) de otras notas del vault con las que se conecta. Corre search_notes antes de guardar y pasa aca lo que encuentres: esto es lo que arma el grafo.'
    ),
  tipo_seccion: z
    .enum(['decisiones', 'conclusiones'])
    .optional()
    .describe(
      'Como se llama la seccion de cierre. Usa "conclusiones" cuando hubo analisis pero no decisiones cerradas. Por defecto "decisiones".'
    )
};

export const saveNoteShape = {
  title: z
    .string()
    .min(1)
    .describe(
      'Titulo descriptivo de 4 a 10 palabras, SIN la fecha adelante. Los titulos son unicos en el vault: si ya existe, el servidor le agrega " (2)".'
    ),
  ...contentShape,
  source_url: z.string().optional().describe('URL de la conversacion de origen, si la tenes.'),
  source_conversation_id: z
    .string()
    .optional()
    .describe('Id de la conversacion de origen, si lo tenes. Evita duplicados al reimportar.')
};

export const updateNoteShape = {
  id: z.string().min(1).describe('Id (ULID) o titulo exacto de la nota a modificar.'),
  title: z.string().min(1).optional().describe('Titulo nuevo. Al renombrar, los [[wikilinks]] que la apuntaban se reescriben solos.'),
  folder: contentShape.folder.optional(),
  tags: contentShape.tags.optional(),
  summary: contentShape.summary.optional(),
  contexto: contentShape.contexto.optional(),
  decisiones: contentShape.decisiones.optional(),
  pendientes: contentShape.pendientes.optional(),
  referencias: contentShape.referencias.optional(),
  notas_adicionales: contentShape.notas_adicionales,
  relacionados: contentShape.relacionados.optional(),
  tipo_seccion: contentShape.tipo_seccion,
  status: z.string().optional().describe('Estado de la nota. Por defecto "archivado".'),
  body_markdown: z
    .string()
    .optional()
    .describe(
      'Reemplaza el cuerpo entero de la nota. Excluyente con los campos por seccion. Arranca en "## Contexto": no incluyas frontmatter ni el titulo H1, los genera el servidor.'
    )
};

export const searchNotesShape = {
  query: z
    .string()
    .optional()
    .describe('Texto libre. Busca en titulo, resumen y cuerpo, ignorando acentos y con coincidencia por prefijo.'),
  folder: z.string().optional().describe('Limita a una carpeta.'),
  tags: z.array(z.string()).optional().describe('La nota tiene que tener TODOS estos tags.'),
  date_from: isoDateSchema.optional().describe('Desde esta fecha, inclusive (AAAA-MM-DD).'),
  date_to: isoDateSchema.optional().describe('Hasta esta fecha, inclusive (AAAA-MM-DD).'),
  limit: z.number().int().min(1).max(100).optional().describe('Cantidad maxima de resultados. Por defecto 20.')
};

export const getNoteShape = {
  id: z.string().optional().describe('Id (ULID) de la nota.'),
  title: z.string().optional().describe('Titulo exacto de la nota. Se ignoran acentos y mayusculas.')
};

export const listPendingShape = {
  owner: z.string().optional().describe('Filtra por responsable (coincidencia parcial, sin distinguir mayusculas).'),
  due_before: isoDateSchema.optional().describe('Solo los que vencen en esta fecha o antes (AAAA-MM-DD).'),
  note_id: z.string().optional().describe('Solo los pendientes de una nota.'),
  include_done: z.boolean().optional().describe('Incluir los ya hechos. Por defecto false.')
};

export const graphShape = {
  id: z.string().min(1).describe('Id (ULID) o titulo de la nota que va en el centro.'),
  depth: z.number().int().min(1).max(4).optional().describe('Saltos desde la nota central. Por defecto 1.'),
  include_phantoms: z
    .boolean()
    .optional()
    .describe('Incluir como nodos los [[enlaces]] que todavia no corresponden a ninguna nota.')
};
