import { zonedNow } from '@bitacora/shared';
import { loadConfig, loadDotEnv, type Config } from './config.js';
import { initDatabase, type Db } from './db/index.js';
import { createServices, type Services } from './services/index.js';

export interface App {
  config: Config;
  db: Db;
  services: Services;
  close(): void;
}

/** Punto de entrada unico: .env, base migrada y servicios listos. */
export function createApp(env: NodeJS.ProcessEnv = process.env): App {
  loadDotEnv();
  const config = loadConfig(env);
  const { db } = initDatabase(config, zonedNow(config.timeZone).iso);
  return {
    config,
    db,
    services: createServices(db, config),
    close: () => db.close()
  };
}
