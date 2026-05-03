const connections = new Map();

export function addConnection(socketId, ws, meta) {
  connections.set(socketId, {
    ws,
    userId: meta.userId ?? null,
    isAuthenticated: Boolean(meta.isAuthenticated),
    ip: meta.ip || '',
  });
}

export function removeConnection(socketId) {
  connections.delete(socketId);
}

export function broadcastAll(message) {
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  for (const { ws } of connections.values()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

export function broadcastExcept(socketId, message) {
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  for (const [id, { ws }] of connections) {
    if (id === socketId) continue;
    if (ws.readyState === 1) ws.send(payload);
  }
}

export function getStats() {
  let total = 0;
  let authenticated = 0;
  for (const c of connections.values()) {
    total += 1;
    if (c.isAuthenticated) authenticated += 1;
  }
  return {
    total,
    authenticated,
    anonymous: total - authenticated,
  };
}
