function bitBytes(total) {
  return Math.ceil(total / 8);
}

function getBit(arr, index) {
  const b = index >> 3;
  const bit = index & 7;
  return (arr[b] >> bit) & 1;
}

function setBit(arr, index, val) {
  const b = index >> 3;
  const bit = index & 7;
  if (val) arr[b] |= 1 << bit;
  else arr[b] &= ~(1 << bit);
}

function countChecked(arr, total) {
  let c = 0;
  for (let i = 0; i < total; i++) {
    if (getBit(arr, i)) c += 1;
  }
  return c;
}

function padBits(buf, total) {
  const need = bitBytes(total);
  if (buf.length >= need) return buf.subarray(0, need);
  const out = new Uint8Array(need);
  out.set(buf);
  return out;
}


let totalCheckboxes = 100000;
let bits = null;
let cellSize = 12;
let cellGap = 1;
let cols = 1;
let rows = 1;
let ws = null;
let reconnectAttempt = 0;
let authed = false;
let drawScheduled = false;
/** Running total of checked boxes (avoid full scans on each click at large N). */
let checkedCount = 0;

const canvas = document.getElementById('grid');
const wrap = document.getElementById('canvas-wrap');
const ctx = canvas.getContext('2d');

function toast(message, isError = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' err' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function setWsStatus(ok) {
  const el = document.getElementById('ws-status');
  if (ok) {
    el.textContent = 'live';
    el.className = 'pill pill-ok';
  } else {
    el.textContent = 'reconnecting…';
    el.className = 'pill pill-warn';
  }
}

async function loadMeta() {
  const r = await fetch('/api/stats');
  if (!r.ok) throw new Error('stats failed');
  const j = await r.json();
  totalCheckboxes = j.totalCheckboxes;
  checkedCount = j.checkedCount;
  document.getElementById('total-count').textContent = String(totalCheckboxes);
  document.getElementById('checked-count').textContent = String(checkedCount);
}

async function loadAuth() {
  const area = document.getElementById('auth-area');
  const role = document.getElementById('role-label');
  try {
    const r = await fetch('/auth/me');
    if (r.ok) {
      const j = await r.json();
      authed = true;
      const name = j.user.name || j.user.sub;
      role.textContent = `logged in as ${name}`;
      canvas.classList.remove('read-only');
      area.innerHTML = '<a class="btn" href="/auth/logout">Logout</a>';
      return;
    }
  } catch {
    /* anonymous */
  }
  authed = false;
  role.textContent = 'anonymous (read-only)';
  canvas.classList.add('read-only');
  area.innerHTML = '<a class="btn btn-primary" href="/auth/login">Login</a>';
}

/**
 * `clientWidth` is often 0 before first layout — that produced cols=1 and a million-pixel-tall
 * canvas, which then looked like a single smeared line when squashed by CSS.
 */
function effectiveContainerWidth() {
  const w = wrap.clientWidth || wrap.offsetWidth;
  if (w > 0) return w;
  const approx = Math.min(window.innerWidth - 48, 960);
  return Math.max(320, approx);
}

function resizeCanvasAndGrid() {
  if (window.innerWidth < 480) {
    cellSize = 9;
  } else if (window.innerWidth < 900) {
    cellSize = 10;
  } else {
    cellSize = 12;
  }
  cellGap = 1;
  const step = cellSize + cellGap;

  const rawW = effectiveContainerWidth() - 8;
  const maxW = Math.min(920, Math.max(280, rawW));
  cols = Math.max(8, Math.floor(maxW / step));
  rows = Math.max(1, Math.ceil(totalCheckboxes / cols));

  canvas.width = cols * step - cellGap;
  canvas.height = rows * step - cellGap;
  if (bits) scheduleDraw();
}

function drawCell(col, row, on) {
  const step = cellSize + cellGap;
  const x = col * step + 0.5;
  const y = row * step + 0.5;
  const s = cellSize - 0.5;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  if (on) {
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = 'rgba(0, 255, 136, 0.35)';
    ctx.shadowBlur = 6;
    ctx.fillRect(x, y, s, s);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x, y, s, s);
    ctx.strokeRect(x, y, s, s);
  }
}

function draw() {
  if (!bits) return;
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const step = cellSize + cellGap;
  const sl = wrap.scrollLeft;
  const st = wrap.scrollTop;
  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  const fc = Math.max(0, Math.floor(sl / step));
  const fr = Math.max(0, Math.floor(st / step));
  const lc = Math.min(cols - 1, Math.floor((sl + vw - 1e-6) / step));
  const lr = Math.min(rows - 1, Math.floor((st + vh - 1e-6) / step));

  for (let row = fr; row <= lr; row++) {
    for (let col = fc; col <= lc; col++) {
      const idx = row * cols + col;
      if (idx >= totalCheckboxes) break;
      drawCell(col, row, getBit(bits, idx));
    }
  }
}

function scheduleDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    draw();
  });
}

function redrawCell(index) {
  if (!bits) return;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const sl = wrap.scrollLeft;
  const st = wrap.scrollTop;
  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  const step = cellSize + cellGap;
  const x0 = col * step;
  const y0 = row * step;
  if (x0 + step < sl || x0 > sl + vw || y0 + step < st || y0 > st + vh) return;
  drawCell(col, row, getBit(bits, index));
}

async function resyncFromRest() {
  try {
    const r = await fetch('/api/checkboxes/state');
    if (!r.ok) return;
    const buf = new Uint8Array(await r.arrayBuffer());
    bits = padBits(buf, totalCheckboxes);
    checkedCount = countChecked(bits, totalCheckboxes);
    document.getElementById('checked-count').textContent = String(checkedCount);
    scheduleDraw();
  } catch {
    /* ignore */
  }
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    reconnectAttempt = 0;
    setWsStatus(true);
  };

  ws.onmessage = async (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      const raw = new Uint8Array(ev.data);
      bits = padBits(raw, totalCheckboxes);
      checkedCount = countChecked(bits, totalCheckboxes);
      document.getElementById('checked-count').textContent = String(checkedCount);
      resizeCanvasAndGrid();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'UPDATE' && bits) {
      const oldVal = getBit(bits, msg.index);
      setBit(bits, msg.index, msg.value);
      if (oldVal !== msg.value) {
        checkedCount += msg.value ? 1 : -1;
      }
      document.getElementById('checked-count').textContent = String(checkedCount);
      redrawCell(msg.index);
      return;
    }
    if (msg.type === 'STATS') {
      document.getElementById('conn-count').textContent = `users: ${msg.connected}`;
      return;
    }
    if (msg.type === 'ERROR') {
      toast(msg.message, true);
      await resyncFromRest();
      return;
    }
  };

  ws.onclose = () => {
    setWsStatus(false);
    const delay = Math.min(30000, 1000 * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    setTimeout(connectWs, delay);
  };
}

function sendToggle(index) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected', true);
    return;
  }
  const prev = getBit(bits, index);
  const next = prev ^ 1;
  setBit(bits, index, next);
  checkedCount += next ? 1 : -1;
  document.getElementById('checked-count').textContent = String(checkedCount);
  redrawCell(index);
  ws.send(JSON.stringify({ type: 'TOGGLE', index }));
}

canvas.addEventListener('click', (e) => {
  if (!bits) return;
  if (!authed) {
    toast('Login to toggle checkboxes', true);
    return;
  }
  const step = cellSize + cellGap;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const col = Math.floor(x / step);
  const row = Math.floor(y / step);
  const idx = row * cols + col;
  if (idx < 0 || idx >= totalCheckboxes) return;
  sendToggle(idx);
});

wrap.addEventListener('scroll', () => scheduleDraw(), { passive: true });
window.addEventListener('resize', () => {
  resizeCanvasAndGrid();
});

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    resizeCanvasAndGrid();
  });
  ro.observe(wrap);
}

async function main() {
  try {
    await loadMeta();
    await loadAuth();
    resizeCanvasAndGrid();
    requestAnimationFrame(() => {
      resizeCanvasAndGrid();
    });
    connectWs();
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 25000);
  } catch (e) {
    toast(String(e.message || e), true);
  }
}

main();
