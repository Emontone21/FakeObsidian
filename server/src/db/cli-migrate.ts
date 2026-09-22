import { zonedNow } from '@bitacora/shared';
import { loadConfig, loadDotEnv } from '../config.js';
import { initDatabase } from './index.js';

loadDotEnv();
const config = loadConfig();
const { db, applied } = initDatabase(config, zonedNow(config.timeZone).iso);

console.log(`Base: ${config.dbPath}`);
console.log(
  applied.length > 0
    ? `Migraciones aplicadas: ${applied.join(', ')}`
    : 'La base ya estaba al dia, no habia migraciones pendientes.'
);
const folders = db.prepare('SELECT count(*) AS c FROM folders').get() as { c: number };
console.log(`Carpetas disponibles: ${folders.c}`);
db.close();
