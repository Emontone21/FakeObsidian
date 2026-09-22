/**
 * Parser del export de claude.ai (conversations.json).
 *
 * El formato cambio varias veces entre versiones del export, asi que este
 * parser no asume una sola forma: acepta las variantes conocidas de cada campo
 * y descarta lo que no entiende en vez de fallar. Todo lo que no pudo leer
 * queda anotado en `warnings`.
 */

export type MessageSender = 'human' | 'assistant' | 'system' | 'unknown';

export interface ImportedMessage {
  sender: MessageSender;
  text: string;
  /** ISO-8601 si se pudo leer. */
  createdAt: string | null;
  attachments: string[];
}

export interface ImportedConversation {
  /** Id de la conversacion: es la clave para no duplicar al reimportar. */
  id: string | null;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: ImportedMessage[];
}

export interface ParseResult {
  conversations: ImportedConversation[];
  /** Entradas que no se pudieron interpretar como conversacion. */
  skipped: number;
  warnings: string[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primer campo presente que sea un string no vacio. */
function pickString(source: Json, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function pickArray(source: Json, keys: readonly string[]): unknown[] | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

const ID_KEYS = ['uuid', 'id', 'conversation_id', 'conversationId'] as const;
const TITLE_KEYS = ['name', 'title', 'summary', 'conversation_name'] as const;
const CREATED_KEYS = ['created_at', 'createdAt', 'create_time', 'created'] as const;
const UPDATED_KEYS = ['updated_at', 'updatedAt', 'update_time', 'updated'] as const;
const MESSAGE_KEYS = ['chat_messages', 'messages', 'conversation', 'chatMessages'] as const;
const SENDER_KEYS = ['sender', 'role', 'author', 'from'] as const;
const TEXT_KEYS = ['text', 'content', 'message', 'body'] as const;
const ATTACHMENT_KEYS = ['attachments', 'files'] as const;
const FILE_NAME_KEYS = ['file_name', 'fileName', 'name', 'title'] as const;

/**
 * Normaliza una fecha a ISO-8601.
 * Acepta strings ISO y epochs numericos, en segundos o en milisegundos.
 */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Un epoch en segundos de una fecha razonable entra en 10 digitos.
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value.trim());
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function pickTimestamp(source: Json, keys: readonly string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeTimestamp(source[key]);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeSender(raw: string | null): MessageSender {
  if (!raw) return 'unknown';
  const value = raw.toLowerCase();
  if (value === 'human' || value === 'user' || value === 'you') return 'human';
  if (value === 'assistant' || value === 'ai' || value === 'claude' || value === 'model') return 'assistant';
  if (value === 'system') return 'system';
  return 'unknown';
}

/**
 * Extrae el texto de un mensaje.
 * Puede venir plano en `text`, o como lista de bloques en `content`
 * (cada uno con su propio `text`), que es la forma mas reciente.
 */
export function extractMessageText(message: Json): string {
  const blocks = pickArray(message, ['content', 'parts']);
  if (blocks) {
    const parts: string[] = [];
    for (const block of blocks) {
      if (typeof block === 'string') {
        if (block.trim()) parts.push(block.trim());
        continue;
      }
      if (!isObject(block)) continue;

      const type = typeof block.type === 'string' ? block.type : null;
      const text = pickString(block, ['text', 'content', 'input_text']);
      if (text) {
        parts.push(text);
        continue;
      }
      // Bloques sin texto (imagenes, uso de herramientas) se dejan senalados.
      if (type && type !== 'text') parts.push(`_[bloque ${type}]_`);
    }
    if (parts.length > 0) return parts.join('\n\n');
  }

  const direct = pickString(message, TEXT_KEYS);
  return direct ?? '';
}

function extractAttachments(message: Json): string[] {
  const names: string[] = [];
  for (const key of ATTACHMENT_KEYS) {
    const list = message[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === 'string') {
        names.push(item);
        continue;
      }
      if (!isObject(item)) continue;
      const name = pickString(item, FILE_NAME_KEYS);
      if (name) names.push(name);
    }
  }
  return names;
}

function parseMessage(raw: unknown): ImportedMessage | null {
  if (!isObject(raw)) return null;
  const text = extractMessageText(raw);
  const attachments = extractAttachments(raw);
  // Un mensaje sin texto ni adjuntos no aporta nada a la transcripcion.
  if (!text && attachments.length === 0) return null;

  return {
    sender: normalizeSender(pickString(raw, SENDER_KEYS)),
    text,
    createdAt: pickTimestamp(raw, CREATED_KEYS),
    attachments
  };
}

/** Titulo de respaldo cuando la conversacion no trae nombre. */
function deriveTitle(messages: readonly ImportedMessage[]): string {
  const first = messages.find((m) => m.sender === 'human' && m.text.trim());
  if (!first) return 'Conversacion sin titulo';
  const line = first.text.replace(/\s+/g, ' ').trim();
  return line.length > 70 ? `${line.slice(0, 67)}...` : line;
}

function parseConversation(raw: unknown): ImportedConversation | null {
  if (!isObject(raw)) return null;

  const rawMessages = pickArray(raw, MESSAGE_KEYS) ?? [];
  const messages = rawMessages
    .map(parseMessage)
    .filter((message): message is ImportedMessage => message !== null);

  const id = pickString(raw, ID_KEYS);
  const title = pickString(raw, TITLE_KEYS) ?? deriveTitle(messages);

  // Sin id y sin mensajes no hay nada que importar ni con que deduplicar.
  if (!id && messages.length === 0) return null;

  return {
    id,
    title,
    createdAt: pickTimestamp(raw, CREATED_KEYS) ?? messages[0]?.createdAt ?? null,
    updatedAt: pickTimestamp(raw, UPDATED_KEYS),
    messages
  };
}

/** Encuentra la lista de conversaciones dentro de las envolturas conocidas. */
function findConversationList(raw: unknown): { list: unknown[]; warning: string | null } {
  if (Array.isArray(raw)) return { list: raw, warning: null };

  if (isObject(raw)) {
    const nested = pickArray(raw, ['conversations', 'data', 'items', 'results', 'chats']);
    if (nested) return { list: nested, warning: null };
    // Un unico objeto suelto tambien vale: es una sola conversacion.
    if (pickArray(raw, MESSAGE_KEYS) || pickString(raw, ID_KEYS)) {
      return { list: [raw], warning: null };
    }
  }

  return {
    list: [],
    warning: 'No se encontro una lista de conversaciones en el archivo.'
  };
}

export function parseClaudeExport(raw: unknown): ParseResult {
  const warnings: string[] = [];
  const { list, warning } = findConversationList(raw);
  if (warning) warnings.push(warning);

  const conversations: ImportedConversation[] = [];
  let skipped = 0;

  for (const entry of list) {
    const conversation = parseConversation(entry);
    if (conversation) conversations.push(conversation);
    else skipped += 1;
  }

  if (skipped > 0) {
    warnings.push(`Se saltearon ${skipped} entradas que no parecian conversaciones.`);
  }

  const sinMensajes = conversations.filter((c) => c.messages.length === 0).length;
  if (sinMensajes > 0) {
    warnings.push(`${sinMensajes} conversaciones vinieron sin mensajes legibles.`);
  }

  return { conversations, skipped, warnings };
}

/** Parsea el texto crudo del archivo, con un error claro si no es JSON valido. */
export function parseClaudeExportText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`El archivo no es JSON valido: ${(error as Error).message}`);
  }
  return parseClaudeExport(data);
}
