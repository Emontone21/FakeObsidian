import { describe, expect, it } from 'vitest';
import { appendToSection, getSection, isSectionEmpty, listSectionNames, replaceSection } from './sections.js';

const BODY = `## Contexto

Investigación de OOS en el lote AMX-2401.

## Decisiones

- Re-analizar con HPLC backup.

## Pendientes

- [ ] Redactar CAPA — Calidad — 05/06/2026

## Referencias

—

## Notas adicionales

\`\`\`sql
-- esto NO es un encabezado
## tampoco esto
\`\`\`

## Relacionado

- [[Plan de validación de limpieza]]
`;

describe('splitSections', () => {
  it('lista las secciones en orden e ignora lo que esta dentro de un bloque de codigo', () => {
    expect(listSectionNames(BODY)).toEqual([
      'Contexto',
      'Decisiones',
      'Pendientes',
      'Referencias',
      'Notas adicionales',
      'Relacionado'
    ]);
  });
});

describe('getSection', () => {
  it('devuelve el contenido sin el encabezado ni blancos de borde', () => {
    expect(getSection(BODY, 'Decisiones')).toBe('- Re-analizar con HPLC backup.');
  });

  it('encuentra la seccion sin importar acentos ni mayusculas', () => {
    expect(getSection(BODY, 'NOTAS ADICIONALES')).toContain('-- esto NO es un encabezado');
  });

  it('devuelve null si la seccion no existe', () => {
    expect(getSection(BODY, 'Anexos')).toBeNull();
  });
});

describe('isSectionEmpty', () => {
  it('reconoce el marcador de vacio', () => {
    expect(isSectionEmpty(BODY, 'Referencias')).toBe(true);
    expect(isSectionEmpty(BODY, 'Decisiones')).toBe(false);
  });
});

describe('replaceSection', () => {
  it('reemplaza solo la seccion pedida', () => {
    const next = replaceSection(BODY, 'Referencias', '- Guía FDA OOS (2022)');
    expect(getSection(next, 'Referencias')).toBe('- Guía FDA OOS (2022)');
    expect(getSection(next, 'Decisiones')).toBe('- Re-analizar con HPLC backup.');
    expect(listSectionNames(next)).toHaveLength(6);
  });

  it('agrega la seccion al final si no existia', () => {
    const next = replaceSection(BODY, 'Anexos', '- Cromatograma');
    expect(listSectionNames(next)).toContain('Anexos');
    expect(getSection(next, 'Anexos')).toBe('- Cromatograma');
  });
});

describe('appendToSection', () => {
  it('suma bullets a una seccion con contenido', () => {
    const next = appendToSection(BODY, 'Decisiones', '- Iniciar CAPA formal.');
    expect(getSection(next, 'Decisiones')).toBe('- Re-analizar con HPLC backup.\n- Iniciar CAPA formal.');
  });

  it('pisa el marcador de vacio en vez de dejarlo', () => {
    const next = appendToSection(BODY, 'Referencias', '- SOP-QC-014');
    expect(getSection(next, 'Referencias')).toBe('- SOP-QC-014');
  });

  it('no toca las demas secciones', () => {
    const next = appendToSection(BODY, 'Pendientes', '- [ ] Revisar SOP — Metrología — 12/06/2026');
    expect(getSection(next, 'Notas adicionales')).toContain('## tampoco esto');
    expect(listSectionNames(next)).toHaveLength(6);
  });
});
