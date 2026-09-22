/**
 * Por que las transacciones de escritura tienen que ser IMMEDIATE.
 *
 * El proceso MCP por stdio y el servidor web escriben la misma base al mismo
 * tiempo. Con transacciones deferred, la que lee antes de escribir falla al
 * instante con "database is locked" en vez de esperar su turno.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, writeTransaction, type Db } from './index.js';

const TIMEOUT_MS = 250;

let file: string;
let escritor: Db;
let segundo: Db;

/** Lee y despues escribe, igual que createNote (consulta el titulo, luego inserta). */
function leerYEscribir(db: Db, nombre: string): void {
  db.prepare('SELECT count(*) AS c FROM folders').get();
  db.prepare('INSERT INTO folders (name, position, created_at) VALUES (?, 0, ?)').run(nombre, 'ahora');
}

beforeEach(() => {
  // Hace falta un archivo real: dos conexiones no comparten una base :memory:.
  file = path.join(tmpdir(), `bitacora-lock-${randomUUID()}.db`);
  escritor = openDatabase(file);
  migrate(escritor);

  segundo = openDatabase(file);
  segundo.pragma(`busy_timeout = ${TIMEOUT_MS}`);

  // El primer proceso deja abierta una transaccion de escritura.
  escritor.exec('BEGIN IMMEDIATE');
  escritor.prepare('INSERT INTO folders (name, position, created_at) VALUES (?, 0, ?)').run('Tomada', 'ahora');
});

afterEach(() => {
  try {
    escritor.exec('ROLLBACK');
  } catch {
    // Ya estaba cerrada.
  }
  escritor.close();
  segundo.close();
  for (const sufijo of ['', '-wal', '-shm']) rmSync(`${file}${sufijo}`, { force: true });
});

describe('escrituras concurrentes sobre la misma base', () => {
  it('una transaccion deferred falla al instante, sin respetar busy_timeout', () => {
    const inicio = Date.now();
    expect(() => segundo.transaction(() => leerYEscribir(segundo, 'Deferred'))()).toThrow(/locked|busy/i);

    // Ni siquiera espero: es el upgrade de lectura a escritura, que SQLite
    // rechaza de una para no arriesgar un deadlock.
    expect(Date.now() - inicio).toBeLessThan(TIMEOUT_MS);
  });

  it('writeTransaction espera su turno antes de rendirse', () => {
    const inicio = Date.now();
    expect(() => writeTransaction(segundo, () => leerYEscribir(segundo, 'Immediate'))).toThrow(/locked|busy/i);

    // Lo que importa: agoto el busy_timeout esperando en vez de fallar al toque.
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(TIMEOUT_MS * 0.8);
  });

  it('cuando el otro proceso libera, la escritura entra', () => {
    escritor.exec('ROLLBACK');

    expect(() => writeTransaction(segundo, () => leerYEscribir(segundo, 'Despues'))).not.toThrow();
    expect(
      (segundo.prepare('SELECT count(*) AS c FROM folders WHERE name = ?').get('Despues') as { c: number }).c
    ).toBe(1);
  });

  it('leer nunca se bloquea, aunque haya una escritura abierta (WAL)', () => {
    expect(() => segundo.prepare('SELECT count(*) AS c FROM folders').get()).not.toThrow();
  });
});
