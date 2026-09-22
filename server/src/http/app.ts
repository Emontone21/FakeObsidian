import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { App } from '../bootstrap.js';
import { createApiRouter } from './api.js';

/** Solo aceptamos requests dirigidos al loopback: proteccion contra DNS rebinding. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Saca el puerto del header Host, sea cual sea, y compara solo el nombre. */
function hostAllowed(header: string | undefined): boolean {
  if (!header) return false;
  const raw = header.trim().toLowerCase();
  if (ALLOWED_HOSTS.has(raw)) return true;
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : (raw.split(':')[0] ?? '');
  return ALLOWED_HOSTS.has(host);
}

export function createHttpApp(app: App): Express {
  const server = express();
  server.disable('x-powered-by');

  server.use((req, res, next) => {
    if (!hostAllowed(req.headers.host)) {
      res.status(421).json({ error: 'Host no permitido. Bitacora solo atiende en 127.0.0.1.' });
      return;
    }
    next();
  });

  // El import sube un archivo binario; el resto de la API habla JSON.
  const parseJson = express.json({ limit: '4mb' });
  server.use((req, res, next) => {
    if (req.path.startsWith('/api/import')) {
      next();
      return;
    }
    parseJson(req, res, next);
  });
  server.use(cookieParser());

  // Log minimo: metodo, ruta y estado. Nunca el cuerpo de una nota.
  server.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  server.use('/api', createApiRouter(app));

  const webDist = path.join(app.config.repoRoot, 'web', 'dist');
  const indexHtml = path.join(webDist, 'index.html');

  if (existsSync(indexHtml)) {
    server.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // Express 5 ya no acepta app.get('*'): el fallback de la SPA va como middleware.
    server.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  } else {
    server.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('La interfaz web no esta compilada todavia. Corre: npm run build');
    });
  }

  return server;
}
