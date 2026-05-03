import Redis from 'ioredis';
import { REDIS_URL } from '../config.js';

export const CHANNEL = 'checkbox:updates';

let publisher;
let subscriber;

function getPublisher() {
  if (!publisher) {
    publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    publisher.on('error', (err) => console.error('[redis pub] error:', err.message));
  }
  return publisher;
}

/** @param {{ index: number, value: 0|1, userId: string|null, timestamp: number }} payload */
export async function publishUpdate(payload) {
  const pub = getPublisher();
  await pub.publish(CHANNEL, JSON.stringify(payload));
}

/** @param {(msg: { index: number, value: 0|1, userId: string|null, timestamp: number }) => void} onMessage */
export function subscribe(onMessage) {
  if (subscriber) {
    subscriber.removeAllListeners('message');
  }
  subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  subscriber.on('error', (err) => console.error('[redis sub] error:', err.message));
  subscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error('[redis sub] subscribe failed:', err.message);
  });
  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      onMessage(JSON.parse(message));
    } catch {
      /* ignore */
    }
  });
  return subscriber;
}

export function shutdownPubSub() {
  if (subscriber) {
    subscriber.quit();
    subscriber = undefined;
  }
  if (publisher) {
    publisher.quit();
    publisher = undefined;
  }
}
