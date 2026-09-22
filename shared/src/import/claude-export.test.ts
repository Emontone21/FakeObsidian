import { describe, expect, it } from 'vitest';
import { extractMessageText, normalizeTimestamp, parseClaudeExport, parseClaudeExportText } from './claude-export.js';

/** Forma habitual del export de claude.ai. */
const EXPORT_ACTUAL = [
  {
    uuid: 'conv-1',
    name: 'Análisis de OOS en amoxicilina',
    created_at: '2026-03-04T13:15:00.000000Z',
    updated_at: '2026-03-04T14:02:00.000000Z',
    account: { uuid: 'acc-1' },
    chat_messages: [
      {
        uuid: 'msg-1',
        sender: 'human',
        created_at: '2026-03-04T13:15:00.000000Z',
        text: 'Tengo un OOS en valoración del lote AMX-2401.',
        content: [{ type: 'text', text: 'Tengo un OOS en valoración del lote AMX-2401.' }],
        attachments: [{ file_name: 'cromatograma.pdf' }],
        files: []
      },
      {
        uuid: 'msg-2',
        sender: 'assistant',
        created_at: '2026-03-04T13:16:00.000000Z',
        text: '',
        content: [{ type: 'text', text: 'Revisemos primero la calibración del HPLC.' }]
      }
    ]
  }
];

describe('parseClaudeExport: formato actual', () => {
  const result = parseClaudeExport(EXPORT_ACTUAL);

  it('lee la conversacion completa', () => {
    expect(result.conversations).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(result.conversations[0]).toMatchObject({
      id: 'conv-1',
      title: 'Análisis de OOS en amoxicilina',
      createdAt: '2026-03-04T13:15:00.000Z'
    });
  });

  it('prefiere los bloques de content sobre el text plano', () => {
    expect(result.conversations[0]?.messages[1]?.text).toBe('Revisemos primero la calibración del HPLC.');
  });

  it('normaliza el remitente y conserva los adjuntos', () => {
    expect(result.conversations[0]?.messages[0]).toMatchObject({
      sender: 'human',
      attachments: ['cromatograma.pdf']
    });
    expect(result.conversations[0]?.messages[1]?.sender).toBe('assistant');
  });
});

describe('parseClaudeExport: tolerancia a otras formas', () => {
  it('acepta la lista envuelta en un objeto', () => {
    for (const key of ['conversations', 'data', 'items', 'chats']) {
      const result = parseClaudeExport({ [key]: EXPORT_ACTUAL });
      expect(result.conversations, key).toHaveLength(1);
    }
  });

  it('acepta una sola conversacion suelta, sin lista', () => {
    expect(parseClaudeExport(EXPORT_ACTUAL[0]).conversations).toHaveLength(1);
  });

  it('acepta id, titulo y mensajes con nombres alternativos', () => {
    const result = parseClaudeExport([
      {
        id: 'conv-2',
        title: 'Otro formato',
        messages: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Buenas' }]
      }
    ]);
    expect(result.conversations[0]).toMatchObject({ id: 'conv-2', title: 'Otro formato' });
    expect(result.conversations[0]?.messages.map((m) => m.sender)).toEqual(['human', 'assistant']);
  });

  it('acepta content como lista de strings', () => {
    const result = parseClaudeExport([
      { uuid: 'c', chat_messages: [{ sender: 'human', parts: ['primera', 'segunda'] }] }
    ]);
    expect(result.conversations[0]?.messages[0]?.text).toBe('primera\n\nsegunda');
  });

  it('deja constancia de los bloques que no son texto', () => {
    const result = parseClaudeExport([
      {
        uuid: 'c',
        chat_messages: [
          { sender: 'assistant', content: [{ type: 'text', text: 'mirá' }, { type: 'image' }] }
        ]
      }
    ]);
    expect(result.conversations[0]?.messages[0]?.text).toBe('mirá\n\n_[bloque image]_');
  });

  it('deriva un titulo del primer mensaje si no viene nombre', () => {
    const result = parseClaudeExport([
      { uuid: 'c', chat_messages: [{ sender: 'human', text: 'Consulta sobre validación de limpieza' }] }
    ]);
    expect(result.conversations[0]?.title).toBe('Consulta sobre validación de limpieza');
  });

  it('recorta el titulo derivado si el mensaje es largo', () => {
    const result = parseClaudeExport([
      { uuid: 'c', chat_messages: [{ sender: 'human', text: 'a'.repeat(200) }] }
    ]);
    expect(result.conversations[0]?.title).toHaveLength(70);
    expect(result.conversations[0]?.title.endsWith('...')).toBe(true);
  });

  it('usa "Conversacion sin titulo" cuando no hay de donde sacarlo', () => {
    const result = parseClaudeExport([{ uuid: 'c', chat_messages: [] }]);
    expect(result.conversations[0]?.title).toBe('Conversacion sin titulo');
  });

  it('toma la fecha del primer mensaje si la conversacion no la trae', () => {
    const result = parseClaudeExport([
      { uuid: 'c', chat_messages: [{ sender: 'human', text: 'hola', created_at: '2026-01-05T10:00:00Z' }] }
    ]);
    expect(result.conversations[0]?.createdAt).toBe('2026-01-05T10:00:00.000Z');
  });
});

describe('parseClaudeExport: entradas rotas', () => {
  it('cuenta lo que no pudo interpretar en vez de fallar', () => {
    const result = parseClaudeExport([EXPORT_ACTUAL[0], null, 'basura', 42, {}]);
    expect(result.conversations).toHaveLength(1);
    expect(result.skipped).toBe(4);
    expect(result.warnings.join(' ')).toMatch(/Se saltearon 4 entradas/);
  });

  it('avisa cuando no encuentra ninguna lista de conversaciones', () => {
    const result = parseClaudeExport({ algo: 'raro' });
    expect(result.conversations).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/No se encontro una lista/);
  });

  it('avisa de conversaciones sin mensajes legibles', () => {
    const result = parseClaudeExport([{ uuid: 'vacia', name: 'Vacía', chat_messages: [] }]);
    expect(result.conversations).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/sin mensajes legibles/);
  });

  it('saltea mensajes sin texto ni adjuntos', () => {
    const result = parseClaudeExport([
      { uuid: 'c', chat_messages: [{ sender: 'human', text: 'hola' }, { sender: 'assistant', text: '' }] }
    ]);
    expect(result.conversations[0]?.messages).toHaveLength(1);
  });

  it('no explota con null, arrays vacios ni strings', () => {
    for (const input of [null, undefined, [], '', 0]) {
      expect(() => parseClaudeExport(input)).not.toThrow();
    }
  });

  it('da un error claro si el archivo no es JSON', () => {
    expect(() => parseClaudeExportText('{ esto no es json')).toThrow(/no es JSON valido/);
  });
});

describe('normalizeTimestamp', () => {
  it('acepta ISO, epoch en segundos y epoch en milisegundos', () => {
    expect(normalizeTimestamp('2026-03-04T13:15:00Z')).toBe('2026-03-04T13:15:00.000Z');
    expect(normalizeTimestamp(1772630100)).toBe('2026-03-04T13:15:00.000Z');
    expect(normalizeTimestamp(1772630100000)).toBe('2026-03-04T13:15:00.000Z');
  });

  it('devuelve null ante basura', () => {
    expect(normalizeTimestamp('no es fecha')).toBeNull();
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(Number.NaN)).toBeNull();
  });
});

describe('extractMessageText', () => {
  it('cae al campo plano cuando no hay bloques', () => {
    expect(extractMessageText({ text: 'plano' })).toBe('plano');
    expect(extractMessageText({ content: 'tambien plano' })).toBe('tambien plano');
  });

  it('devuelve vacio si no hay nada legible', () => {
    expect(extractMessageText({})).toBe('');
    expect(extractMessageText({ content: [] })).toBe('');
  });
});
