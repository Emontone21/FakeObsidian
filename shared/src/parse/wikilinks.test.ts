import { describe, expect, it } from 'vitest';
import { parseWikilinks, toWikilink, uniqueWikilinks } from './wikilinks.js';

describe('parseWikilinks', () => {
  it('extrae enlaces simples y con alias', () => {
    const links = parseWikilinks('Ver [[Plan de validación]] y [[Desviación DV-014|la desviación]].');
    expect(links.map((l) => l.target)).toEqual(['Plan de validación', 'Desviación DV-014']);
    expect(links[1]?.alias).toBe('la desviación');
    expect(links[0]?.alias).toBeNull();
  });

  it('normaliza la clave para resolver sin acentos ni mayusculas', () => {
    expect(parseWikilinks('[[Desviación DE Calidad]]')[0]?.targetKey).toBe('desviacion de calidad');
  });

  it('marca los embeds', () => {
    const links = parseWikilinks('![[Cromatograma]]');
    expect(links[0]?.embed).toBe(true);
  });

  it('ignora lo que esta dentro de un bloque de codigo', () => {
    const body = ['Antes [[Nota A]]', '```md', '[[Nota Falsa]]', '```', 'Después [[Nota B]]'].join('\n');
    expect(parseWikilinks(body).map((l) => l.target)).toEqual(['Nota A', 'Nota B']);
  });

  it('ignora lo que esta dentro de codigo en linea', () => {
    expect(parseWikilinks('escribí `[[Nota Falsa]]` para enlazar a [[Nota Real]]').map((l) => l.target)).toEqual([
      'Nota Real'
    ]);
  });

  it('ignora corchetes vacios y enlaces markdown normales', () => {
    expect(parseWikilinks('[[]] y [texto](https://ejemplo.com)')).toHaveLength(0);
  });

  it('registra la linea de cada enlace', () => {
    expect(parseWikilinks('uno\n[[Dos]]')[0]?.line).toBe(1);
  });
});

describe('uniqueWikilinks', () => {
  it('deduplica por clave normalizada', () => {
    const links = uniqueWikilinks('[[Nota A]] [[nota a]] [[Nota B]]');
    expect(links.map((l) => l.target)).toEqual(['Nota A', 'Nota B']);
  });
});

describe('toWikilink', () => {
  it('envuelve el titulo y saca los caracteres que romperian el enlace', () => {
    expect(toWikilink('Plan de validación')).toBe('[[Plan de validación]]');
    expect(toWikilink('Raro [|] título')).toBe('[[Raro  título]]');
  });
});
