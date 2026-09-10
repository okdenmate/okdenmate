import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { Db } from './db.js';
import { HttpError, SESSION_COOKIE, userForToken } from './auth.js';
import { registerRoutes } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DB_PATH = resolve(here, '../../../data/ukn.db');

export async function buildServer(dbPath: string = process.env['UKN_DB'] ?? DEFAULT_DB_PATH) {
  const db = new Db(dbPath);
  const app = Fastify({
    logger: process.env['NODE_ENV'] === 'test' ? false : { level: process.env['LOG_LEVEL'] ?? 'info' },
    bodyLimit: 1_048_576,
  });

  await app.register(cookie, { secret: process.env['COOKIE_SECRET'] ?? 'ukn-dev-secret-change-me' });

  // Attach the signed-in user to every request. Public routes simply ignore it.
  app.addHook('onRequest', async (req) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = req.cookies[SESSION_COOKIE] ?? bearer;
    const user = userForToken(db, token);
    if (user) req.user = user;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ ok: false, error: err.message, detail: err.detail ?? null });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        ok: false,
        error: 'That request was not valid.',
        detail: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ ok: false, error: 'Something went wrong on the server.' });
  });

  app.get('/api/health', async () => ({ ok: true, data: { status: 'up', time: new Date().toISOString() } }));

  registerRoutes(app, db);

  // Serve the built front end when it exists, so one process runs the whole app.
  const webDist = resolve(here, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ ok: false, error: 'No such endpoint.' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => db.close());
  return { app, db };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env['PORT'] ?? 4000);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const { app } = await buildServer();
  try {
    await app.listen({ port, host });
    app.log.info(`UK Nitrates CRM API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export { join };
