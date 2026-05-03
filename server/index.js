import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import http from 'http';

import redisClient from './redis/client.js';
import * as bitfield from './redis/bitfield.js';
import { subscribe } from './redis/pubsub.js';
import * as connectionManager from './ws/connectionManager.js';
import { attachWebSocketServer } from './ws/wsServer.js';
import {
  PORT,
  REDIS_URL,
  SESSION_SECRET,
  TOTAL_CHECKBOXES,
  OIDC_ISSUER,
} from './config.js';
import { createOidcProvider, mountInteractionRoutes } from './auth/oidcProvider.js';
import authRoutes from './routes/authRoutes.js';
import checkboxRoutes from './routes/checkboxRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);

const redisStore = new RedisStore({
  client: redisClient,
});

app.use(
  session({
    store: redisStore,
    name: 'connect.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 86400000,
      sameSite: 'lax',
      secure: false,
    },
  }),
);

const provider = createOidcProvider();
mountInteractionRoutes(app, provider);
app.use('/oidc', provider.callback());

app.use('/auth', authRoutes);
app.use('/api', checkboxRoutes);

app.use(express.static(path.join(__dirname, '../public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).send(err.message || 'Internal Server Error');
});

const server = http.createServer(app);

attachWebSocketServer(server, { sessionStore: redisStore });

subscribe((payload) => {
  connectionManager.broadcastAll({
    type: 'UPDATE',
    index: payload.index,
    value: payload.value,
  });
});

await bitfield.ensureBitfieldLength(TOTAL_CHECKBOXES);

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] OIDC issuer: ${OIDC_ISSUER}`);
  console.log(`[server] Redis: ${REDIS_URL}`);
  console.log(`[server] Total checkboxes: ${TOTAL_CHECKBOXES}`);
  console.log(`[server] WebSocket: ws://localhost:${PORT}/ws`);
});
