import redis from '../redis/client.js';
import {
  HTTP_RATE_LIMIT_WINDOW,
  HTTP_RATE_LIMIT_MAX,
  WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX,
} from '../config.js';

const HTTP_WINDOW_MS = HTTP_RATE_LIMIT_WINDOW * 1000;
const WS_WINDOW_MS = WS_RATE_LIMIT_WINDOW * 1000;
const BAN_SECONDS = 60;

function httpWindowId() {
  return Math.floor(Date.now() / HTTP_WINDOW_MS);
}

function wsWindowId() {
  return Math.floor(Date.now() / WS_WINDOW_MS);
}

function banKey(identifier) {
  return `ratelimit:ban:${identifier}`;
}

/** @param {string} ip */
export async function checkHttpLimit(ip) {
  const wid = httpWindowId();
  const key = `ratelimit:http:${ip}:${wid}`;

  const n = await redis.incr(key);
  if (n === 1) {
    await redis.pexpire(key, HTTP_WINDOW_MS);
  }
  if (n > HTTP_RATE_LIMIT_MAX) {
    const ttlMs = await redis.pttl(key);
    const retryAfter = Math.max(1, Math.ceil(ttlMs / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true, retryAfter: 0 };
}

/** @param {string} identifier */
export async function checkWsLimit(identifier) {
  if (await isUserBanned(identifier)) {
    return { allowed: false };
  }
  const wid = wsWindowId();
  const key = `ratelimit:ws:${identifier}:${wid}`;
  const n = await redis.incr(key);
  if (n === 1) {
    await redis.pexpire(key, WS_WINDOW_MS);
  }
  if (n > WS_RATE_LIMIT_MAX) {
    await banUser(identifier, BAN_SECONDS);
    return { allowed: false };
  }
  return { allowed: true };
}

export async function banUser(identifier, durationSeconds) {
  await redis.set(banKey(identifier), '1', 'EX', durationSeconds);
}

export async function isUserBanned(identifier) {
  return (await redis.exists(banKey(identifier))) === 1;
}
