import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Db, id, now } from './db.js';

export type Role = 'owner' | 'ops_director' | 'sales' | 'production' | 'readonly';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 14;
export const SESSION_COOKIE = 'ukn_session';

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  return { hash: scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex'), salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(derived, stored);
}

export function createSession(db: Db, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)', token, userId, now(), expires);
  return { token, expiresAt: expires };
}

export function destroySession(db: Db, token: string): void {
  db.run('DELETE FROM sessions WHERE token = ?', token);
}

export function userForToken(db: Db, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db.get<{ id: string; email: string; name: string; role: Role; expires_at: string; active: number }>(
    `SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(db, token);
    return null;
  }
  if (Number(row.active) !== 1) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function createUser(
  db: Db,
  input: { email: string; name: string; role: Role; password: string },
): AuthUser {
  const { hash, salt } = hashPassword(input.password);
  const userId = id();
  db.run(
    'INSERT INTO users (id, email, name, role, password_hash, password_salt, created_at, active) VALUES (?,?,?,?,?,?,?,1)',
    userId,
    input.email.toLowerCase(),
    input.name,
    input.role,
    hash,
    salt,
    now(),
  );
  return { id: userId, email: input.email.toLowerCase(), name: input.name, role: input.role };
}

/** Roles that may change data. Everyone else gets a read-only view. */
const WRITE_ROLES: Role[] = ['owner', 'ops_director', 'sales'];
export const canWrite = (user: AuthUser): boolean => WRITE_ROLES.includes(user.role);

/**
 * Only the owner may sign off buyer verification or dismiss a suspicious
 * transaction. Both are decisions someone has to be answerable for.
 */
const COMPLIANCE_ROLES: Role[] = ['owner', 'ops_director'];
export const canSignCompliance = (user: AuthUser): boolean => COMPLIANCE_ROLES.includes(user.role);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Sign in to continue.');
  return req.user;
}

export function requireWrite(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (!canWrite(user)) throw new HttpError(403, 'Your account has read-only access.');
  return user;
}

export function requireCompliance(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (!canSignCompliance(user)) {
    throw new HttpError(403, 'Only an owner or operations director can sign off a compliance record.');
  }
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env['NODE_ENV'] === 'production',
    expires: new Date(expiresAt),
  });
}
