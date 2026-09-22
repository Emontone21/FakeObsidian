/**
 * Genera la plantilla estructurada de una nota a partir de su transcripcion.
 * Solo se habilita si hay ANTHROPIC_API_KEY en el entorno: sin eso, la
 * importacion sigue funcionando y las notas quedan con el tag "sin-resumir".
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getSection, normalizeTag, parseDateFlexible, type Note } from '@bitacora/shared';
import { z } from 'zod';
import { BitacoraError, notFound } from './errors.js';
import { listFolders } from './folders.js';
import { requireNote, updateNote, type Ctx } from './notes.js';
import { listTags } from './tags.js';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 16000;
/** Margen contra la ventana de contexto de 1M: mejor avisar que truncar. */
const MAX_INPUT_TOKENS = 900_000;

const IMPORT_TAG = 'import';
const UNSUMMARIZED_TAG = 'sin-resumir';

const ResumenSchema = z.object({
  titulo: z
    .string()
    .describe('Titulo descriptivo de 4 a 10 palabras, sin la fecha adelante.'),
  resumen: z.string().describe('Una o dos oraciones. Se muestra en las tarjetas y en el grafo.'),
  carpeta: z.string().describe('Una de las carpetas existentes que se listan abajo.'),
  tags: z.array(z.string()).describe('Entre uno y cuatro tags tematicos, en minusculas y sin acentos.'),
  contexto: z
    .string()
    .describe('Dos a cinco oraciones que se entiendan sin haber visto la conversacion.'),
  tipo_seccion: z
    .enum(['decisiones', 'conclusiones'])
    .describe('"conclusiones" si hubo analisis pero ninguna decision cerrada.'),
  decisiones: z.array(z.string()).describe('Una decision, acuerdo o conclusion por elemento.'),
  pendientes: z
    .array(
      z.object({
        accion: z.string(),
        responsable: z.string().nullable(),
        fecha: z.string().nullable().describe('DD/MM/AAAA, o null si no se acordo una.')
      })
    )
    .describe('Solo las acciones que se acordaron de verdad.'),
  referencias: z
    .array(z.string())
    .describe('Solo lo citado explicitamente en la conversacion. Vacio si no se cito nada.')
});

export type Resumen = z.infer<typeof ResumenSchema>;

const SYSTEM_PROMPT = `Sos un archivista que convierte conversaciones con Claude en notas estructuradas para una base de conocimiento personal de la industria farmaceutica (calidad, regulatorios, I+D y farmacovigilancia).

Reglas que no se negocian:
- Escribi en espanol neutro, sin voseo: es material de referencia profesional.
- NUNCA inventes normas, capitulos de farmacopea, guias ni numeros de SOP. Si en la conversacion no se cito nada concreto, devolve "referencias" vacio.
- Anonimiza datos personales identificables (pacientes, documentos de identidad, historias clinicas) sustituyendolos por [ANONIMIZADO].
- No agregues informacion que no este en la conversacion. Si algo no se dijo, la lista va vacia.
- En "pendientes" van solo acciones que se acordaron explicitamente, con su responsable y fecha si se mencionaron.`;

export function isSummarizerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Texto de origen: la transcripcion si la hay, si no el cuerpo entero. */
export function sourceTextFor(note: Note): string {
  const notas = getSection(note.body, 'Notas adicionales');
  if (notas && notas.trim() && notas.trim() !== '—') return notas;
  return note.body;
}

function buildPrompt(note: Note, source: string, folders: string[], tags: string[]): string {
  return [
    `Convertí esta conversación en una nota estructurada.`,
    '',
    `Título actual de la nota: ${note.title}`,
    `Fecha de la conversación: ${note.date}`,
    '',
    `Carpetas que ya existen en el vault (elegí una de estas, la que mejor encaje):`,
    folders.map((f) => `- ${f}`).join('\n'),
    '',
    tags.length > 0
      ? `Tags que ya se usan en el vault (reusá los que encajen antes de crear nuevos):\n${tags.join(', ')}`
      : 'Todavía no hay tags en el vault.',
    '',
    '--- CONVERSACIÓN ---',
    source
  ].join('\n');
}

/** Lo unico que summarizeNote necesita del SDK; los tests inyectan un doble. */
export interface SummarizerClient {
  countInputTokens(system: string, prompt: string): Promise<number>;
  requestSummary(system: string, prompt: string): Promise<Resumen>;
}

function anthropicClient(apiKey: string): SummarizerClient {
  const client = new Anthropic({ apiKey });

  return {
    async countInputTokens(system, prompt) {
      const count = await client.messages.countTokens({
        model: MODEL,
        system,
        messages: [{ role: 'user', content: prompt }]
      });
      return count.input_tokens;
    },

    async requestSummary(system, prompt) {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: zodOutputFormat(ResumenSchema) }
      });

      if (response.stop_reason === 'refusal') {
        throw new BitacoraError(
          'CONFLICT',
          'El modelo no quiso procesar esta conversacion. Revisa el contenido o resumila a mano.'
        );
      }
      if (!response.parsed_output) {
        throw new BitacoraError('CONFLICT', 'El modelo no devolvio un resumen con el formato esperado.');
      }
      return response.parsed_output;
    }
  };
}

export interface SummarizeResult {
  noteId: string;
  title: string;
  /** Cambios que se aplicaron efectivamente sobre la nota. */
  resumen: Resumen;
  avisos: string[];
}

/**
 * Pide el resumen estructurado y lo aplica sobre la nota.
 * Deja la nota en estado "archivado" y le saca el tag "sin-resumir".
 */
export async function summarizeNote(
  ctx: Ctx,
  idOrTitle: string,
  options: { env?: NodeJS.ProcessEnv; client?: SummarizerClient } = {}
): Promise<SummarizeResult> {
  const env = options.env ?? process.env;
  if (!options.client && !isSummarizerEnabled(env)) {
    throw new BitacoraError(
      'INVALID_INPUT',
      'Falta ANTHROPIC_API_KEY en el .env: sin eso no se puede generar el resumen.'
    );
  }

  const note = requireNote(ctx.db, idOrTitle);
  const source = sourceTextFor(note);
  if (!source.trim()) throw notFound(`La nota "${note.title}" no tiene contenido para resumir.`);

  const folders = listFolders(ctx.db).map((f) => f.name);
  const tags = listTags(ctx.db)
    .slice(0, 60)
    .map((t) => t.name);
  const prompt = buildPrompt(note, source, folders, tags);

  const client = options.client ?? anthropicClient(env.ANTHROPIC_API_KEY!);

  const inputTokens = await client.countInputTokens(SYSTEM_PROMPT, prompt);
  if (inputTokens > MAX_INPUT_TOKENS) {
    throw new BitacoraError(
      'INVALID_INPUT',
      `La conversación es demasiado larga para resumirla de una (${inputTokens} tokens). ` +
        'Partila en varias notas o resumí las secciones a mano.'
    );
  }

  const resumen = await client.requestSummary(SYSTEM_PROMPT, prompt);

  const avisos: string[] = [];

  // La carpeta tiene que ser una de las que ya existen; si no, se queda donde esta.
  let carpeta = resumen.carpeta.trim();
  if (!folders.includes(carpeta)) {
    avisos.push(`Sugirió la carpeta "${carpeta}", que no existe: la nota quedó en "${note.folder}".`);
    carpeta = note.folder;
  }

  // Las fechas que no parsean se descartan en vez de guardarse torcidas.
  const pendientes = resumen.pendientes.map((p) => {
    const fecha = p.fecha ? parseDateFlexible(p.fecha) : null;
    if (p.fecha && !fecha) avisos.push(`Descarté la fecha "${p.fecha}" de "${p.accion}": no es una fecha válida.`);
    return { accion: p.accion, responsable: p.responsable, fecha };
  });

  // Se conserva "import" para saber de dónde salió y se saca "sin-resumir".
  const nuevosTags = [
    ...(note.tags.includes(IMPORT_TAG) ? [IMPORT_TAG] : []),
    ...resumen.tags.map(normalizeTag).filter(Boolean)
  ].filter((tag) => tag !== UNSUMMARIZED_TAG);

  // updateNote reescribe solo las secciones pedidas: la transcripcion queda intacta.
  const updated = updateNote(ctx, note.id, {
    title: resumen.titulo.trim() || note.title,
    folder: carpeta,
    tags: nuevosTags,
    summary: resumen.resumen,
    contexto: resumen.contexto,
    tipoSeccion: resumen.tipo_seccion,
    decisiones: resumen.decisiones,
    pendientes,
    referencias: resumen.referencias,
    status: 'archivado'
  });

  return { noteId: updated.note.id, title: updated.note.title, resumen, avisos };
}
