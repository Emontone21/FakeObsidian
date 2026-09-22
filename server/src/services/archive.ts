import { unzip } from 'fflate';
import { BitacoraError } from './errors.js';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const TARGET = 'conversations.json';

function looksLikeZip(data: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => data[index] === byte);
}

function decode(data: Uint8Array): string {
  // El export puede venir con BOM; JSON.parse no lo tolera.
  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => (error ? reject(error) : resolve(files)));
  });
}

/**
 * Devuelve el texto de conversations.json, venga suelto o dentro del zip que
 * baja claude.ai. No asume la ruta exacta dentro del zip.
 */
export async function readConversationsJson(data: Uint8Array): Promise<{ text: string; source: string }> {
  if (data.length === 0) {
    throw new BitacoraError('INVALID_INPUT', 'El archivo llego vacio.');
  }

  if (!looksLikeZip(data)) {
    const text = decode(data).trimStart();
    if (!text.startsWith('[') && !text.startsWith('{')) {
      throw new BitacoraError(
        'INVALID_INPUT',
        'El archivo no es un zip ni un JSON. Subi el zip que baja claude.ai o el conversations.json de adentro.'
      );
    }
    return { text, source: 'conversations.json' };
  }

  let files: Record<string, Uint8Array>;
  try {
    files = await unzipAsync(data);
  } catch (error) {
    throw new BitacoraError('INVALID_INPUT', `No se pudo abrir el zip: ${(error as Error).message}`);
  }

  const names = Object.keys(files);
  // Primero el nombre exacto; si no, cualquier ruta que termine asi.
  const match =
    names.find((name) => name.toLowerCase() === TARGET) ??
    names.find((name) => name.toLowerCase().endsWith(`/${TARGET}`)) ??
    names.find((name) => name.toLowerCase().endsWith('.json'));

  if (!match) {
    throw new BitacoraError(
      'INVALID_INPUT',
      `El zip no contiene ${TARGET}. Archivos encontrados: ${names.slice(0, 8).join(', ') || 'ninguno'}.`
    );
  }

  return { text: decode(files[match]!), source: match };
}
