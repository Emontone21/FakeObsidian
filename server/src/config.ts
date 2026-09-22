import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz del repo, tanto compilado (server/dist) como en dev con tsx (server/src). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Carga el .env de la raiz si existe. No pisa variables ya definidas. */
export function loadDotEnv(root: string = REPO_ROOT): void {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Un .env ilegible no debe impedir que arranque con los valores por defecto.
  }
}

export interface Config {
  repoRoot: string;
  dataDir: string;
  dbPath: string;
  /** Zona horaria con la que el servidor sella fecha y hora de las notas. */
  timeZone: string;
  /** Base para armar la URL de la nota en la web. */
  webBaseUrl: string;
  defaultFolders: string[];
}

export const DEFAULT_FOLDERS = [
  'I+D',
  'Regulatorios',
  'Calidad',
  'Farmacovigilancia',
  'Produccion',
  'Comercial',
  'Marketing',
  'TI',
  'General'
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.BITACORA_DATA_DIR
    ? path.resolve(process.cwd(), env.BITACORA_DATA_DIR)
    : path.join(REPO_ROOT, 'data');

  return {
    repoRoot: REPO_ROOT,
    dataDir,
    dbPath: env.BITACORA_DB_PATH
      ? path.resolve(process.cwd(), env.BITACORA_DB_PATH)
      : path.join(dataDir, 'bitacora.db'),
    timeZone: env.BITACORA_TZ || 'America/Montevideo',
    webBaseUrl: (env.BITACORA_WEB_URL || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    defaultFolders: DEFAULT_FOLDERS
  };
}

export function ensureDataDir(config: Config): void {
  mkdirSync(config.dataDir, { recursive: true });
}
