import Provider from 'oidc-provider';
import express from 'express';
import {
  OIDC_ISSUER,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  SESSION_SECRET,
} from '../config.js';

export const USERS = {
  user1: { password: 'pass1', name: 'Alice' },
  user2: { password: 'pass2', name: 'Bob' },
  user3: { password: 'pass3', name: 'Carol' },
};

export async function loadExistingGrant(ctx) {
  const accountId = ctx.oidc.session?.accountId;
  if (!accountId) return undefined;

  const existingId = ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
  if (existingId) {
    const existing = await ctx.oidc.provider.Grant.find(existingId);
    if (existing) return existing;
  }

  const grant = new ctx.oidc.provider.Grant({
    accountId,
    clientId: ctx.oidc.client.clientId,
  });
  grant.addOIDCScope('openid profile');
  await grant.save();
  return grant;
}

export function createOidcProvider() {
  const configuration = {
    features: {
      devInteractions: { enabled: false },
    },
    pkce: {
      methods: ['S256'],
      required() {
        return false;
      },
    },
    clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uris: [REDIRECT_URI],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
    ],
    cookies: {
      keys: [SESSION_SECRET, 'oidc-secondary'],
    },
    interactions: {
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },
    loadExistingGrant,
    findAccount: async (_ctx, id) => {
      if (!USERS[id]) return undefined;
      return {
        accountId: id,
        async claims(use, scope, claims, rejected) {
          return { sub: id, name: USERS[id].name };
        },
      };
    },
  };

  return new Provider(OIDC_ISSUER, configuration);
}

function loginPageHtml(uid, error) {
  const err = error
    ? `<p style="color:#ff6b6b;font-size:12px;margin-bottom:8px">${error}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Sign in</title>
<style>
body{font-family:system-ui;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
form{background:#141414;padding:24px;border:1px solid #333;border-radius:8px;min-width:280px;}
label{display:block;font-size:12px;margin-bottom:4px;color:#aaa;}
input{width:100%;box-sizing:border-box;padding:8px;margin-bottom:12px;background:#0a0a0a;border:1px solid #444;color:#e0e0e0;border-radius:4px;}
button{width:100%;padding:10px;background:#00ff88;color:#0a0a0a;border:none;border-radius:4px;font-weight:bold;cursor:pointer;}
button:hover{filter:brightness(1.05);}
h1{font-size:18px;margin:0 0 16px;}
</style></head>
<body>
<form method="post" action="/interaction/${uid}">
  <h1>Million Checkboxes — Sign in</h1>
  ${err}
  <label for="username">Username</label>
  <input id="username" name="username" autocomplete="username" required />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required />
  <button type="submit">Continue</button>
  <p style="font-size:11px;color:#888;margin-top:12px">Try user1 / pass1 or user2 / pass2</p>
</form></body></html>`;
}

export function mountInteractionRoutes(app, provider) {
  app.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name === 'login') {
        res.type('html').send(loginPageHtml(details.uid));
        return;
      }
      res.status(400).type('html').send('<p>Unexpected interaction step</p>');
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/interaction/:uid',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const { username, password } = req.body;
        const details = await provider.interactionDetails(req, res);
        if (details.prompt.name !== 'login') {
          res.status(400).send('Invalid interaction');
          return;
        }
        const acc = USERS[username];
        if (!acc || acc.password !== password) {
          res.status(200).type('html').send(loginPageHtml(details.uid, 'Invalid credentials'));
          return;
        }
        await provider.interactionFinished(
          req,
          res,
          { login: { accountId: username } },
          { mergeWithLastSubmission: false },
        );
      } catch (err) {
        next(err);
      }
    },
  );
}
