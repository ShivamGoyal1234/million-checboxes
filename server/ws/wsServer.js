import { WebSocketServer } from 'ws';
import { TOTAL_CHECKBOXES } from '../config.js';
import * as bitfield from '../redis/bitfield.js';
import * as connectionManager from './connectionManager.js';
import * as messageHandler from './messageHandler.js';
import { resolveWsAuth } from '../auth/middleware.js';

function padBitBuffer(buf) {
  const needBytes = Math.ceil(TOTAL_CHECKBOXES / 8);
  if (buf.length >= needBytes) return buf.subarray(0, needBytes);
  return Buffer.concat([buf, Buffer.alloc(needBytes - buf.length, 0)]);
}

export function attachWebSocketServer(httpServer, { sessionStore }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    const url = new URL(request.url || '/', `http://${host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, async (ws) => {
      const socketId = messageHandler.randomSocketId();
      let auth;
      try {
        auth = await resolveWsAuth(request, sessionStore);
      } catch {
        auth = { userId: null, isAuthenticated: false };
      }

      connectionManager.addConnection(socketId, ws, {
        userId: auth.userId,
        isAuthenticated: auth.isAuthenticated,
        ip: request.socket.remoteAddress || '',
      });

      const statsPayload = {
        type: 'STATS',
        connected: connectionManager.getStats().total,
        ...connectionManager.getStats(),
      };
      connectionManager.broadcastExcept(socketId, statsPayload);

      try {
        const raw = await bitfield.getAll();
        ws.send(padBitBuffer(Buffer.from(raw)));
      } catch {
        messageHandler.sendWsError(ws, 'Failed to load checkbox state');
        connectionManager.removeConnection(socketId);
        ws.close();
        return;
      }

      ws.send(JSON.stringify(statsPayload));

      ws.on('message', (data) => {
        messageHandler.handleMessage(ws, data, {
          userId: auth.userId,
          isAuthenticated: auth.isAuthenticated,
          socketId,
        });
      });

      ws.on('close', () => {
        connectionManager.removeConnection(socketId);
        connectionManager.broadcastAll({
          type: 'STATS',
          connected: connectionManager.getStats().total,
          ...connectionManager.getStats(),
        });
      });
    });
  });

  return wss;
}
