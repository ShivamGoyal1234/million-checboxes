import Redis from 'ioredis';
import { REDIS_URL } from '../config.js';

const client = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

client.on('error', (err) => {
  console.error('[redis] client error:', err.message);
});

export default client;
