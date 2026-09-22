/** Servidor web de Bitacora. Escucha solo en 127.0.0.1. */
import { createApp } from './bootstrap.js';
import { createHttpApp } from './http/app.js';
import { needsSetup, purgeExpiredSessions, seedPasswordFromEnv } from './services/auth.js';

const HOST = '127.0.0.1';

function main(): void {
  const app = createApp();

  if (seedPasswordFromEnv(app.db, process.env.BITACORA_PASSWORD)) {
    console.log('Contrasena inicial tomada de BITACORA_PASSWORD y guardada hasheada.');
  }
  const purged = purgeExpiredSessions(app.db);
  if (purged > 0) console.log(`Sesiones vencidas eliminadas: ${purged}`);

  const server = createHttpApp(app).listen(app.config.port, HOST, () => {
    console.log(`Bitacora en http://${HOST}:${app.config.port}`);
    console.log(`Base: ${app.config.dbPath}`);
    if (needsSetup(app.db)) {
      console.log('Todavia no hay contrasena: la primera pantalla te va a pedir que definas una.');
    }
  });

  const shutdown = () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
