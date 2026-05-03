import crypto from 'crypto';
import { TOTAL_CHECKBOXES } from '../config.js';
import * as bitfield from '../redis/bitfield.js';
import { publishUpdate } from '../redis/pubsub.js';
import * as rateLimiter from '../rateLimit/rateLimiter.js';
import * as connectionManager from './connectionManager.js';

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sendError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'ERROR', message }));
  }
}

function sendPong(ws) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'PONG' }));
  }
}

function sendStats(ws) {
  const s = connectionManager.getStats();
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'STATS', connected: s.total, ...s }));
  }
}

export async function handleMessage(ws, data, ctx) {
  const raw = typeof data === 'string' ? data : data.toString('utf8');
  const msg = safeJsonParse(raw);
  if (!msg || typeof msg.type !== 'string') {
    sendError(ws, 'Invalid message');
    return;
  }

  switch (msg.type) {
    case 'PING':
      sendPong(ws);
      return;
    case 'GET_STATS':
      sendStats(ws);
      return;
    case 'TOGGLE':
      await handleToggle(ws, msg, ctx);
      return;
    default:
      sendError(ws, `Unknown type: ${msg.type}`);
  }
}

async function handleToggle(ws, msg, ctx) {
  if (!ctx.isAuthenticated) {
    sendError(ws, 'Login required to toggle checkboxes');
    return;
  }

  const index = msg.index;
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= TOTAL_CHECKBOXES
  ) {
    sendError(ws, `Invalid index (0..${TOTAL_CHECKBOXES - 1})`);
    return;
  }

  const identifier = ctx.userId || ctx.socketId;
  const limit = await rateLimiter.checkWsLimit(identifier);
  if (!limit.allowed) {
    sendError(ws, 'Rate limit exceeded; try again later');
    return;
  }

  const current = await bitfield.getBit(index);
  const value = (current ^ 1);
  await bitfield.setBit(index, value);

  await publishUpdate({
    index,
    value,
    userId: ctx.userId,
    timestamp: Date.now(),
  });

  if (ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: 'OK',
        action: 'TOGGLE',
        index,
        value,
      }),
    );
  }
}

export function sendWsError(ws, message) {
  sendError(ws, message);
}

export function randomSocketId() {
  return crypto.randomBytes(16).toString('hex');
}
