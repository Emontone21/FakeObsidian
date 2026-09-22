import { describe, expect, it } from 'vitest';
import { listSectionNames, replaceSection } from '../parse/sections.js';
import type { ImportedConversation } from './claude-export.js';
import { demoteHeadings, describeConversation, renderTranscript } from './transcript.js';

const CONVERSACION: ImportedConversation = {
  id: 'conv-1',
  title: 'Análisis de OOS',
  createdAt: '2026-03-04T13:15:00.000Z',
  updatedAt: null,
  messages: [
    {
      sender: 'human',
      text: 'Tengo un OOS en el lote AMX-2401.',
      createdAt: '2026-03-04T13:15:00.000Z',
      attachments: ['cromatograma.pdf']
    },
    {
      sender: 'assistant',
      text: '## Análisis\n\nRevisemos la calibración.',
      createdAt: '2026-03-04T13:16:00.000Z',
      attachments: []
    }
  ]
};

describe('demoteHeadings', () => {
  it('convierte encabezados en negrita para que no parezcan secciones', () => {
    expect(demoteHeadings('## Análisis')).toBe('**Análisis**');
    expect(demoteHeadings('#### Sub nivel')).toBe('**Sub nivel**');
    expect(demoteHeadings('# Título con cierre ###')).toBe('**Título con cierre**');
  });

  it('no toca el texto normal ni los numerales sin espacio', () => {
    expect(demoteHeadings('esto no es #encabezado')).toBe('esto no es #encabezado');
    expect(demoteHeadings('#hashtag')).toBe('#hashtag');
  });

  it('respeta los numerales dentro de un bloque de codigo', () => {
    const code = ['```bash', '# esto es un comentario', '## tambien', '```'].join('\n');
    expect(demoteHeadings(code)).toBe(code);
  });
});

describe('renderTranscript', () => {
  const transcript = renderTranscript(CONVERSACION, 'America/Montevideo');

  it('envuelve todo en un bloque plegable', () => {
    expect(transcript.startsWith('<details>')).toBe(true);
    expect(transcript).toContain('<summary>Transcripcion completa (2 mensajes)</summary>');
    expect(transcript.endsWith('</details>')).toBe(true);
  });

  it('identifica a cada interlocutor con fecha en la zona del usuario', () => {
    expect(transcript).toContain('**Vos** · 04/03/2026 10:15');
    expect(transcript).toContain('**Claude** · 04/03/2026 10:16');
  });

  it('lista los adjuntos', () => {
    expect(transcript).toContain('_Adjuntos: cromatograma.pdf_');
  });

  it('no deja encabezados que rompan las secciones de la nota', () => {
    const body = replaceSection('## Contexto\n\n—\n\n## Notas adicionales\n\n—\n', 'Notas adicionales', transcript);
    expect(listSectionNames(body)).toEqual(['Contexto', 'Notas adicionales']);
    expect(body).toContain('**Análisis**');
  });

  it('avisa cuando la conversacion vino vacia', () => {
    expect(renderTranscript({ ...CONVERSACION, messages: [] }, 'America/Montevideo')).toMatch(
      /sin mensajes legibles/
    );
  });
});

describe('describeConversation', () => {
  it('resume con la cantidad de mensajes y el arranque', () => {
    const summary = describeConversation(CONVERSACION);
    expect(summary).toContain('2 mensajes');
    expect(summary).toContain('Tengo un OOS en el lote AMX-2401.');
  });

  it('funciona sin mensajes', () => {
    expect(describeConversation({ ...CONVERSACION, messages: [] })).toContain('0 mensajes');
  });
});
