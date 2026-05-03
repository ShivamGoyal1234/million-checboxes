import redis from './client.js';

export const KEY = 'checkboxes:state';

export async function getBit(index) {
  const result = await redis.bitfield(KEY, 'GET', 'u1', index);
  return result[0] & 1;
}

export async function setBit(index, value) {
  await redis.bitfield(KEY, 'SET', 'u1', index, value);
}

export async function getBulkBits(start, count) {
  if (count <= 0) return Buffer.alloc(0);
  const startByte = Math.floor(start / 8);
  const endBit = start + count - 1;
  const endByte = Math.floor(endBit / 8);
  const buf = await redis.getrange(KEY, startByte, endByte);
  return buf ? Buffer.from(buf) : Buffer.alloc(endByte - startByte + 1);
}

export async function getAll() {
  const buf = await redis.getrange(KEY, 0, -1);
  return buf ? Buffer.from(buf) : Buffer.alloc(0);
}

export async function ensureBitfieldLength(totalBits) {
  const minBytes = Math.ceil(totalBits / 8);
  const existing = await redis.strlen(KEY);
  if (existing < minBytes) {
    await redis.append(KEY, Buffer.alloc(minBytes - existing, 0));
  }
}
