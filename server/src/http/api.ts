import { ZipArchive } from 'archiver';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import type { App } from '../bootstrap.js';
import {
  changePassword,
  checkPassword,
  createSession,
  destroySession,
  isSessionValid,
  LoginThrottle,
  needsSetup,
  setPassword
} from '../services/auth.js';
import { BitacoraError } from '../services/errors.js';
import { readConversationsJson } from '../services/archive.js';
import type { SearchSort } from '../services/index.js';
import { parseClaudeExportText } from '@bitacora/shared';

export const SESSION_COOKIE = 'bitacora_session';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  FOLDER_NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_INPUT: 400,
  SECTION_NOT_FOUND: 400
};

/** Corre el handler y traduce los errores de dominio a codigos HTTP. */
function handle(res: Response, run: () => unknown): void {
  try {
    const result = run();
    if (result === undefined) res.status(204).end();
    else res.json(result);
  } catch (error) {
    if (error instanceof BitacoraError) {
      res.status(STATUS_BY_CODE[error.code] ?? 400).json({ error: error.message, code: error.code });
      return;
    }
    // Nunca exponemos el stack ni el cuerpo de la nota al cliente.
    console.error('[api] error inesperado:', (error as Error).message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function strList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter(Boolean);
  return undefined;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createApiRouter(app: App): Router {
  const { db, services, config } = app;
  const router = Router();
  const throttle = new LoginThrottle();

  // --- Autenticacion (sin sesion) -------------------------------------------

  router.get('/auth/session', (req, res) => {
    res.json({
      authenticated: isSessionValid(db, req.cookies?.[SESSION_COOKIE]),
      needsSetup: needsSetup(db)
    });
  });

  router.post('/auth/setup', (req, res) =>
    handle(res, () => {
      if (!needsSetup(db)) {
        throw new BitacoraError('CONFLICT', 'Ya hay una contrasena configurada.');
      }
      setPassword(db, String(req.body?.password ?? ''));
      const session = createSession(db, req.get('user-agent'));
      setSessionCookie(res, session.id, session.expiresAt);
      return { ok: true };
    })
  );

  router.post('/auth/login', (req, res) =>
    handle(res, () => {
      const key = req.ip ?? 'local';
      const waitMs = throttle.retryAfterMs(key);
      if (waitMs > 0) {
        throw new BitacoraError(
          'CONFLICT',
          `Demasiados intentos fallidos. Espera ${Math.ceil(waitMs / 1000)} segundos.`
        );
      }

      const password = String(req.body?.password ?? '');
      if (!checkPassword(db, password)) {
        throttle.recordFailure(key);
        throw new BitacoraError('INVALID_INPUT', 'Contrasena incorrecta.');
      }

      throttle.reset(key);
      const session = createSession(db, req.get('user-agent'));
      setSessionCookie(res, session.id, session.expiresAt);
      return { ok: true };
    })
  );

  router.post('/auth/logout', (req, res) =>
    handle(res, () => {
      destroySession(db, req.cookies?.[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    })
  );

  // --- A partir de aca todo requiere sesion ---------------------------------

  router.use((req, res, next) => {
    if (!isSessionValid(db, req.cookies?.[SESSION_COOKIE])) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    next();
  });

  router.post('/auth/password', (req, res) =>
    handle(res, () => {
      changePassword(db, String(req.body?.current ?? ''), String(req.body?.next ?? ''));
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    })
  );

  // --- Carpetas y tags ------------------------------------------------------

  router.get('/folders', (_req, res) => handle(res, () => ({ carpetas: services.listFolders() })));

  router.post('/folders', (req, res) =>
    handle(res, () => ({ created: services.createFolder(String(req.body?.name ?? '')) }))
  );

  router.patch('/folders/:name', (req, res) =>
    handle(res, () => {
      services.renameFolder(req.params.name, String(req.body?.name ?? ''));
      return { ok: true };
    })
  );

  router.delete('/folders/:name', (req, res) =>
    handle(res, () => {
      services.deleteFolder(req.params.name, str(req.query.moveTo) ?? 'General');
      return { ok: true };
    })
  );

  router.get('/tags', (req, res) => handle(res, () => ({ tags: services.listTags(str(req.query.prefix)) })));

  router.patch('/tags/:name', (req, res) =>
    handle(res, () => ({ name: services.renameTag(req.params.name, String(req.body?.name ?? '')) }))
  );

  // --- Notas ----------------------------------------------------------------

  router.get('/notes', (req, res) =>
    handle(res, () => {
      const filter = {
        query: str(req.query.query) ?? null,
        folder: str(req.query.folder) ?? null,
        tags: strList(req.query.tags) ?? null,
        dateFrom: str(req.query.date_from) ?? null,
        dateTo: str(req.query.date_to) ?? null,
        sort: (str(req.query.sort) as SearchSort | undefined) ?? null,
        limit: num(req.query.limit) ?? 60
      };
      return { resultados: services.searchNotes(filter), total: services.countNotes(filter) };
    })
  );

  router.get('/notes/:id', (req, res) => handle(res, () => services.requireNoteDetail(req.params.id)));

  router.post('/notes', (req, res) =>
    handle(res, () => {
      const body = req.body ?? {};
      return services.saveNote({
        title: String(body.title ?? ''),
        folder: String(body.folder ?? 'General'),
        tags: strList(body.tags) ?? [],
        summary: String(body.summary ?? ''),
        contexto: String(body.contexto ?? ''),
        decisiones: strList(body.decisiones) ?? [],
        pendientes: Array.isArray(body.pendientes) ? body.pendientes : [],
        referencias: strList(body.referencias) ?? [],
        notasAdicionales: body.notas_adicionales ?? null,
        relacionados: strList(body.relacionados) ?? [],
        tipoSeccion: body.tipo_seccion,
        source: 'manual'
      });
    })
  );

  router.patch('/notes/:id', (req, res) =>
    handle(res, () => {
      const body = req.body ?? {};
      return services.updateNote(req.params.id, {
        title: body.title,
        folder: body.folder,
        tags: strList(body.tags),
        summary: body.summary,
        status: body.status,
        bodyMarkdown: body.body_markdown
      });
    })
  );

  router.delete('/notes/:id', (req, res) =>
    handle(res, () => ({ deleted: services.deleteNote(req.params.id).title }))
  );

  // --- Pendientes -----------------------------------------------------------

  router.get('/pending', (req, res) =>
    handle(res, () => ({
      pendientes: services.listPending({
        owner: str(req.query.owner) ?? null,
        dueBefore: str(req.query.due_before) ?? null,
        noteId: str(req.query.note_id) ?? null,
        includeDone: bool(req.query.include_done),
        limit: num(req.query.limit) ?? 500
      })
    }))
  );

  router.post('/pending/:id/done', (req, res) =>
    handle(res, () => {
      const result = services.setPendingDone(req.params.id, req.body?.done !== false);
      return { pending: result.pending, noteId: result.note.id, changed: result.changed };
    })
  );

  // --- Grafo ----------------------------------------------------------------

  const graphOptions = (req: Request) => ({
    includeTags: bool(req.query.include_tags),
    includePhantoms: bool(req.query.include_phantoms),
    folder: str(req.query.folder) ?? null,
    tags: strList(req.query.tags) ?? null,
    dateFrom: str(req.query.date_from) ?? null,
    dateTo: str(req.query.date_to) ?? null
  });

  router.get('/graph', (req, res) => handle(res, () => services.getFullGraph(graphOptions(req))));

  router.get('/graph/:id', (req, res) =>
    handle(res, () => services.getNeighborhood(req.params.id, num(req.query.depth) ?? 1, graphOptions(req)))
  );

  // --- Importacion ----------------------------------------------------------

  // El export de claude.ai puede pesar bastante, asi que entra como binario crudo.
  const uploadBody = express.raw({ type: '*/*', limit: '256mb' });

  router.post('/import', uploadBody, (req, res) => {
    void (async () => {
      try {
        const body = req.body as Buffer | undefined;
        if (!body || body.length === 0) {
          res.status(400).json({ error: 'No llego ningun archivo.' });
          return;
        }
        const { text, source } = await readConversationsJson(new Uint8Array(body));
        const parsed = parseClaudeExportText(text);
        const report = services.importConversations(parsed, {
          folder: str(req.query.folder) ?? undefined,
          dryRun: bool(req.query.dry_run)
        });
        res.json({ ...report, archivo: source, dryRun: bool(req.query.dry_run) });
      } catch (error) {
        if (error instanceof BitacoraError) {
          res.status(STATUS_BY_CODE[error.code] ?? 400).json({ error: error.message, code: error.code });
          return;
        }
        res.status(400).json({ error: (error as Error).message });
      }
    })();
  });

  router.post('/notes/:id/summarize', (req, res) => {
    void (async () => {
      try {
        res.json(await services.summarizeNote(req.params.id));
      } catch (error) {
        if (error instanceof BitacoraError) {
          res.status(STATUS_BY_CODE[error.code] ?? 400).json({ error: error.message, code: error.code });
          return;
        }
        console.error('[api] fallo el resumen:', (error as Error).message);
        res.status(502).json({ error: `No se pudo generar el resumen: ${(error as Error).message}` });
      }
    })();
  });

  // --- Ajustes --------------------------------------------------------------

  router.get('/status', (_req, res) =>
    handle(res, () => {
      const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
      return {
        version: '0.1.0',
        dbPath: config.dbPath,
        timeZone: config.timeZone,
        webBaseUrl: config.webBaseUrl,
        notas: count('SELECT count(*) AS c FROM notes'),
        carpetas: count('SELECT count(*) AS c FROM folders'),
        tags: count('SELECT count(*) AS c FROM tags'),
        enlaces: count('SELECT count(*) AS c FROM links WHERE to_note_id IS NOT NULL'),
        enlacesSinResolver: count('SELECT count(*) AS c FROM links WHERE to_note_id IS NULL'),
        pendientesAbiertos: count('SELECT count(*) AS c FROM pending_items WHERE done = 0'),
        // El conector remoto llega en la fase 3.
        conectorRemoto: { habilitado: false, estado: 'No configurado (fase 3)' },
        resumidor: {
          habilitado: services.summarizerEnabled(),
          estado: services.summarizerEnabled()
            ? 'Listo: hay ANTHROPIC_API_KEY configurada.'
            : 'Sin ANTHROPIC_API_KEY: las notas importadas quedan con el tag sin-resumir.'
        }
      };
    })
  );

  router.get('/export/vault.zip', async (_req, res) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (error: Error) => {
      console.error('[api] fallo el zip:', error.message);
      res.destroy();
    });
    res.attachment(`bitacora-vault-${new Date().toISOString().slice(0, 10)}.zip`);
    archive.pipe(res);
    for (const file of services.exportVault()) archive.append(file.content, { name: file.path });
    await archive.finalize();
  });

  router.get('/export/backup.db', async (_req, res) => {
    const target = path.join(config.dataDir, 'backups', `tmp-${randomBytes(8).toString('hex')}.db`);
    try {
      await db.backup(target);
      await new Promise<void>((resolve, reject) => {
        res.download(target, `bitacora-${new Date().toISOString().slice(0, 10)}.db`, (error) =>
          error ? reject(error) : resolve()
        );
      });
    } catch (error) {
      console.error('[api] fallo el backup:', (error as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el backup.' });
    } finally {
      await rm(target, { force: true });
    }
  });

  return router;
}

function setSessionCookie(res: Response, id: string, expiresAt: string): void {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    // El servidor escucha solo en 127.0.0.1 sobre http, asi que secure romperia la cookie.
    secure: false,
    path: '/',
    expires: new Date(expiresAt)
  });
}
