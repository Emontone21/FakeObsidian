/** Ayudantes para los tests: base en memoria, migrada y con la taxonomia inicial. */
import { loadConfig, type Config } from './config.js';
import { ensureDefaultFolders, migrate, openDatabase, type Db } from './db/index.js';
import { createServices, type Services } from './services/index.js';

export interface TestApp {
  config: Config;
  db: Db;
  services: Services;
  close(): void;
}

export function createTestApp(overrides: Partial<Config> = {}): TestApp {
  const config: Config = { ...loadConfig({}), dbPath: ':memory:', ...overrides };
  const db = openDatabase(':memory:');
  migrate(db);
  ensureDefaultFolders(db, config.defaultFolders, '2026-05-28T10:00:00-03:00');
  return { config, db, services: createServices(db, config), close: () => db.close() };
}

export const BASE_NOTE = {
  folder: 'Calidad',
  tags: ['calidad'],
  summary: 'Resumen de prueba.',
  contexto: 'Contexto de prueba.',
  decisiones: ['Una decision.'],
  pendientes: [],
  referencias: [],
  relacionados: []
};
