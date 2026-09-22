/** Render de la transcripcion de una conversacion importada. */

import { formatDateForBody } from '../normalize.js';
import { codeFenceMask } from '../parse/fences.js';
import type { ImportedConversation, ImportedMessage, MessageSender } from './claude-export.js';

const SENDER_LABEL: Record<MessageSender, string> = {
  human: 'Vos',
  assistant: 'Claude',
  system: 'Sistema',
  unknown: 'Mensaje'
};

/**
 * Baja de nivel los encabezados del mensaje.
 *
 * Un "## Algo" escrito por Claude dentro de la transcripcion seria leido como
 * una seccion nueva de la nota y romperia update_note y append_to_note. Los
 * encabezados dentro de bloques de codigo no se tocan: el parser de secciones
 * ya los ignora.
 */
export function demoteHeadings(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const inCode = codeFenceMask(lines);

  return lines
    .map((line, index) => {
      if (inCode[index]) return line;
      const match = /^(\s{0,3})#{1,6}[ \t]+(.*)$/.exec(line);
      if (!match) return line;
      const content = match[2]!.replace(/\s*#*\s*$/, '').trim();
      return content ? `${match[1]}**${content}**` : match[1]!;
    })
    .join('\n');
}

function formatStamp(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${formatDateForBody(`${get('year')}-${get('month')}-${get('day')}`)} ${get('hour')}:${get('minute')}`;
}

function renderMessage(message: ImportedMessage, timeZone: string): string {
  const stamp = formatStamp(message.createdAt, timeZone);
  const header = stamp
    ? `**${SENDER_LABEL[message.sender]}** · ${stamp}`
    : `**${SENDER_LABEL[message.sender]}**`;

  const parts = [header];
  if (message.attachments.length > 0) {
    parts.push(`_Adjuntos: ${message.attachments.join(', ')}_`);
  }
  if (message.text.trim()) parts.push(demoteHeadings(message.text.trim()));

  return parts.join('\n\n');
}

/**
 * Transcripcion completa dentro de un bloque plegable.
 * Las lineas en blanco alrededor del contenido son necesarias para que el
 * markdown de adentro se siga interpretando dentro del <details>.
 */
export function renderTranscript(conversation: ImportedConversation, timeZone: string): string {
  if (conversation.messages.length === 0) {
    return '_La conversacion vino sin mensajes legibles en el export._';
  }

  const body = conversation.messages.map((m) => renderMessage(m, timeZone)).join('\n\n---\n\n');
  const count = conversation.messages.length;

  return [
    '<details>',
    `<summary>Transcripcion completa (${count} mensaje${count === 1 ? '' : 's'})</summary>`,
    '',
    body,
    '',
    '</details>'
  ].join('\n');
}

/** Resumen corto para la tarjeta, mientras la nota siga sin resumir. */
export function describeConversation(conversation: ImportedConversation): string {
  const count = conversation.messages.length;
  const first = conversation.messages.find((m) => m.sender === 'human' && m.text.trim());
  const preview = first ? first.text.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const head = `Conversacion importada de claude.ai (${count} mensaje${count === 1 ? '' : 's'}).`;
  return preview ? `${head} Empieza con: "${preview}${preview.length >= 120 ? '...' : ''}"` : head;
}
