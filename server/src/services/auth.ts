import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeTransaction, type Db } from '../db/index.js';
import { BitacoraError } from './errors.js';

const PASSWORD_KEY = 'password_hash';
const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;

/** Formato guardado: scrypt:<salt hex>:<hash hex>. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

/** true cuando todavia no hay contrasena: la web muestra la pantalla de alta. */
export function needsSetup(db: Db): boolean {
  return getSetting(db, PASSWORD_KEY) === null;
}

/**
 * Siembra la contrasena desde BITACORA_PASSWORD la primera vez.
 * Si ya hay una guardada no la pisa: cambiarla es desde Ajustes.
 */
export function seedPasswordFromEnv(db: Db, password: string | undefined): boolean {
  if (!password || !needsSetup(db)) return false;
  setSetting(db, PASSWORD_KEY, hashPassword(password));
  return true;
}

export function setPassword(db: Db, password: string): void {
  if (password.length < 8) {
    throw new BitacoraError('INVALID_INPUT', 'La contrasena tiene que tener al menos 8 caracteres.');
  }
  setSetting(db, PASSWORD_KEY, hashPassword(password));
}

export function checkPassword(db: Db, password: string): boolean {
  const stored = getSetting(db, PASSWORD_KEY);
  return stored !== null && verifyPassword(password, stored);
}

/** Cambia la contrasena validando la actual, y corta todas las sesiones abiertas. */
export function changePassword(db: Db, current: string, next: string): void {
  if (!checkPassword(db, current)) {
    throw new BitacoraError('INVALID_INPUT', 'La contrasena actual no es correcta.');
  }
  writeTransaction(db, () => {
    setPassword(db, next);
    db.prepare('DELETE FROM sessions').run();
  });
}

export interface SessionInfo {
  id: string;
  expiresAt: string;
}

export function createSession(db: Db, userAgent: string | undefined): SessionInfo {
  const id = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)').run(
    id,
    now.toISOString(),
    expires.toISOString(),
    userAgent?.slice(0, 200) ?? null
  );
  return { id, expiresAt: expires.toISOString() };
}

export function isSessionValid(db: Db, id: string | undefined): boolean {
  if (!id) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as
    | { expires_at: string }
    | undefined;
  if (!row) return false;
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return false;
  }
  return true;
}

export function destroySession(db: Db, id: string | undefined): void {
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function purgeExpiredSessions(db: Db): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()).changes;
}

/**
 * Freno simple a la fuerza bruta. Es una app local de un solo usuario:
 * alcanza con memoria del proceso, no hace falta persistirlo.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; lastAt: number; until: number }>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly lockMs = 30_000,
    /** Fallos separados por mas que esto no se acumulan. */
    private readonly windowMs = 5 * 60_000
  ) {}

  /** Milisegundos que faltan para poder reintentar, o 0 si puede intentar ya. */
  retryAfterMs(key: string, now = Date.now()): number {
    const entry = this.failures.get(key);
    if (!entry || entry.until <= now) return 0;
    return entry.until - now;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    // El contador arranca de cero si el bloqueo anterior ya vencio o si el
    // ultimo fallo quedo fuera de la ventana.
    const lockExpired = entry !== undefined && entry.until > 0 && entry.until <= now;
    const outOfWindow = entry !== undefined && now - entry.lastAt > this.windowMs;
    const count = !entry || lockExpired || outOfWindow ? 1 : entry.count + 1;

    this.failures.set(key, {
      count,
      lastAt: now,
      until: count >= this.maxAttempts ? now + this.lockMs : 0
    });
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
