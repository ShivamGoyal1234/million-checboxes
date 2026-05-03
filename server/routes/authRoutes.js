import express from 'express';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  OIDC_ISSUER,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
} from '../config.js';

const router = express.Router();

function toBase64Url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkcePair() {
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(
    crypto.createHash('sha256').update(codeVerifier, 'utf8').digest(),
  );
  return { codeVerifier, codeChallenge };
}

let jwksRef = null;
function getJwks() {
  if (!jwksRef) {
    jwksRef = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/jwks`));
  }
  return jwksRef;
}

router.get('/login', (req, res, next) => {
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = createPkcePair();

  req.session.oauthState = state;
  req.session.oauthNonce = nonce;
  req.session.pkceCodeVerifier = codeVerifier;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const authorizeUrl = `${OIDC_ISSUER}/auth?${params.toString()}`;
  req.session.save((err) => {
    if (err) return next(err);
    res.redirect(authorizeUrl);
  });
});

function firstQuery(val) {
  if (val === undefined || val === null) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

router.get('/callback', async (req, res) => {
  const oauthErr = firstQuery(req.query.error);
  let oauthDesc = firstQuery(req.query.error_description);
  if (typeof oauthDesc === 'string') {
    try {
      oauthDesc = decodeURIComponent(oauthDesc.replace(/\+/g, ' '));
    } catch {
      /* keep raw */
    }
  }

  if (oauthErr) {
    const msg =
      typeof oauthDesc === 'string' && oauthDesc.length
        ? oauthDesc
        : typeof oauthErr === 'string'
          ? oauthErr
          : 'authorization_failed';
    res.status(400).type('html')
      .send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#0a0a0a;color:#e0e0e0">
<h1>Login failed</h1><p>${escapeHtml(msg)}</p><p><a href="/">Home</a> · <a href="/auth/login">Try again</a></p>
</body></html>`);
    return;
  }

  const code = firstQuery(req.query.code);
  const state = firstQuery(req.query.state);
  if (!code || typeof code !== 'string') {
    res.status(400).type('html')
      .send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#0a0a0a;color:#e0e0e0">
<h1>Missing authorization code</h1>
<p>Use <strong>Login</strong> from the app first. If this persists, check <code>OIDC_ISSUER</code> and <code>REDIRECT_URI</code> match your browser URL.</p>
<p><a href="/">Home</a> · <a href="/auth/login">Login</a></p>
</body></html>`);
    return;
  }
  if (state !== req.session.oauthState) {
    res.status(400).send('Invalid state — session may have expired. Try logging in again.');
    return;
  }

  const codeVerifier = req.session.pkceCodeVerifier;
  if (typeof codeVerifier !== 'string') {
    res.status(400).send('Missing PKCE verifier — start login again from /auth/login.');
    return;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(`${OIDC_ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    res.status(502).send(`Token exchange failed: ${errText}`);
    return;
  }

  const tokens = await tokenRes.json();
  if (!tokens.id_token) {
    res.status(502).send('No id_token in response');
    return;
  }

  const JWKS = getJwks();
  const { payload } = await jwtVerify(tokens.id_token, JWKS, {
    issuer: OIDC_ISSUER,
    audience: CLIENT_ID,
  });

  req.session.user = {
    sub: String(payload.sub),
    name: payload.name || payload.preferred_username || payload.sub,
  };
  req.session.accessToken = tokens.access_token;
  req.session.oauthState = undefined;
  req.session.oauthNonce = undefined;
  req.session.pkceCodeVerifier = undefined;

  res.redirect('/');
});

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    user: req.session.user,
  });
});

export default router;
