import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readConversationsJson } from './archive.js';

const JSON_TEXT = '[{"uuid":"c1","name":"Una conversación"}]';

describe('readConversationsJson', () => {
  it('acepta el JSON suelto', async () => {
    const result = await readConversationsJson(strToU8(JSON_TEXT));
    expect(result.text).toBe(JSON_TEXT);
  });

  it('saca el BOM que rompe JSON.parse', async () => {
    const result = await readConversationsJson(strToU8(`﻿${JSON_TEXT}`));
    expect(() => JSON.parse(result.text)).not.toThrow();
  });

  it('encuentra conversations.json dentro del zip', async () => {
    const zip = zipSync({ 'conversations.json': strToU8(JSON_TEXT), 'users.json': strToU8('[]') });
    const result = await readConversationsJson(zip);
    expect(result.source).toBe('conversations.json');
    expect(result.text).toBe(JSON_TEXT);
  });

  it('lo encuentra aunque este dentro de una carpeta', async () => {
    const zip = zipSync({ 'data-2026-09-22/conversations.json': strToU8(JSON_TEXT) });
    const result = await readConversationsJson(zip);
    expect(result.source).toBe('data-2026-09-22/conversations.json');
  });

  it('cae a cualquier .json si no hay uno con ese nombre', async () => {
    const zip = zipSync({ 'export/chats.json': strToU8(JSON_TEXT) });
    expect((await readConversationsJson(zip)).source).toBe('export/chats.json');
  });

  it('explica que hay adentro si el zip no trae ningun json', async () => {
    const zip = zipSync({ 'leeme.txt': strToU8('hola') });
    await expect(readConversationsJson(zip)).rejects.toThrow(/no contiene conversations.json.*leeme.txt/s);
  });

  it('rechaza un archivo que no es ni zip ni json', async () => {
    await expect(readConversationsJson(strToU8('esto es texto suelto'))).rejects.toThrow(/no es un zip ni un JSON/);
  });

  it('rechaza un archivo vacio', async () => {
    await expect(readConversationsJson(new Uint8Array(0))).rejects.toThrow(/llego vacio/);
  });
});
