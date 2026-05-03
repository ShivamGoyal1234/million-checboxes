import express from 'express';
import redis from '../redis/client.js';
import { KEY } from '../redis/bitfield.js';
import * as bitfield from '../redis/bitfield.js';
import { TOTAL_CHECKBOXES } from '../config.js';
import * as connectionManager from '../ws/connectionManager.js';
import { httpRateLimit } from '../auth/middleware.js';

const router = express.Router();

router.get('/checkboxes/state', httpRateLimit, async (req, res) => {
  const buf = await bitfield.getAll();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Total-Checkboxes', String(TOTAL_CHECKBOXES));
  res.send(buf);
});

router.get('/stats', httpRateLimit, async (req, res) => {
  const checked = await redis.bitcount(KEY);
  const s = connectionManager.getStats();
  res.json({
    totalCheckboxes: TOTAL_CHECKBOXES,
    checkedCount: checked,
    connections: s,
  });
});

router.get('/checkboxes/range', httpRateLimit, async (req, res) => {
  const start = parseInt(String(req.query.start), 10);
  const count = parseInt(String(req.query.count), 10);
  if (
    Number.isNaN(start) ||
    Number.isNaN(count) ||
    start < 0 ||
    count < 0 ||
    start + count > TOTAL_CHECKBOXES
  ) {
    res.status(400).json({ error: 'Invalid start/count range' });
    return;
  }
  const buf = await bitfield.getBulkBits(start, count);
  res.json({
    start,
    count,
    data: buf.toString('base64'),
  });
});

export default router;
