import { createRemoteJWKSet, jwtVerify } from 'jose';
import cookieSignature from 'cookie-signature';
import * as rateLimiter from '../rateLimit/rateLimiter.js';
import { OIDC_ISSUER, CLIENT_ID, SESSION_SECRET } from '../config.js';

export function requireAuth(req, res, next) {
  if (!req.session?.user?.sub) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export async function httpRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const r = await rateLimiter.checkHttpLimit(ip);
  if (!r.allowed) {
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).send('Too Many Requests');
    return;
  }
  next();
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep */
    }
    out[k] = v;
  }
  return out;
}

let jwksRef = null;
function getJwks() {
  if (!jwksRef) {
    jwksRef = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/jwks`));
  }
  return jwksRef;
}

/**
 * WebSocket upgrade auth: optional `?token=` JWT (OIDC id_token) or `express-session` cookie.
 * @param {import('http').IncomingMessage} req
 * @param {SessionStoreLike} sessionStore
 */
export async function resolveWsAuth(req, sessionStore) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const token = url.searchParams.get('token');
    if (token) {
      const JWKS = getJwks();
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: OIDC_ISSUER,
        audience: CLIENT_ID,
      });
      return { userId: String(payload.sub), isAuthenticated: true };
    }
  } catch {
    /* fall through to cookie session */
  }

  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies['connect.sid'];
  if (!signed) {
    return { userId: null, isAuthenticated: false };
  }

  const raw = signed.startsWith('s:') ? signed.slice(2) : signed;
  const sid = cookieSignature.unsign(raw, SESSION_SECRET);
  if (sid === false) {
    return { userId: null, isAuthenticated: false };
  }

  const session = await new Promise((resolve, reject) => {
    sessionStore.get(sid, (err, sess) => {
      if (err) reject(err);
      else resolve(sess);
    });
  }).catch(() => null);

  if (!session?.user?.sub) {
    return { userId: null, isAuthenticated: false };
  }

  return {
    userId: String(session.user.sub),
    isAuthenticated: true,
  };
}
