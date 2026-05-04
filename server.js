'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT)  || 8080;
const MODE = process.env.TODO_MODE       || 'sqlite'; // 'sqlite' | 'json'
const PATH = (process.env.TODO_PATH      || './shared.db').replace(/\/$/, '');
// ──────────────────────────────────────────────────────────────────────────────

const express              = require('express');
const http                 = require('http');
const { WebSocketServer }  = require('ws');
const { v4: uuidv4 }       = require('uuid');
const fs                   = require('fs');

const ALLOWED_FIELDS = ['task', 'status', 'result_plan', 'risk_help', 'due_date', 'priority', 'progress', 'note'];

// ─── STORAGE：SQLite ──────────────────────────────────────────────────────────

let db;

function initSQLite() {
  const Database = require('better-sqlite3');
  db = new Database(PATH);
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      parent_id   TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      task        TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT '',
      result_plan TEXT NOT NULL DEFAULT '',
      risk_help   TEXT NOT NULL DEFAULT '',
      due_date    TEXT NOT NULL DEFAULT '',
      priority    TEXT NOT NULL DEFAULT '中',
      progress    INTEGER NOT NULL DEFAULT 0,
      note        TEXT NOT NULL DEFAULT '',
      updated_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    )
  `);
  try { db.exec("ALTER TABLE items ADD COLUMN due_date TEXT NOT NULL DEFAULT ''"); } catch {}
}

function withExclusive(fn) {
  db.exec('BEGIN EXCLUSIVE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

// ─── STORAGE：JSON ────────────────────────────────────────────────────────────

let jsonItems = [];

function initJSON() {
  try {
    const data = fs.readFileSync(PATH, 'utf8');
    jsonItems = JSON.parse(data).items || [];
  } catch {
    jsonItems = [];
  }
}

function saveJSON() {
  fs.writeFileSync(PATH, JSON.stringify({ items: jsonItems }, null, 2));
}

// ─── 統一讀寫介面 ─────────────────────────────────────────────────────────────

function getAllItems() {
  if (MODE === 'sqlite') return db.prepare('SELECT * FROM items ORDER BY sort_order ASC').all();
  return [...jsonItems].sort((a, b) => a.sort_order - b.sort_order);
}

function getItem(id) {
  if (MODE === 'sqlite') return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null;
  return jsonItems.find(i => i.id === id) || null;
}

function createItem({ owner, parent_id, task }) {
  if (MODE === 'sqlite') {
    withExclusive(() => {
      const { m } = db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM items WHERE parent_id IS ?'
      ).get(parent_id ?? null);
      const now = Date.now();
      db.prepare(`
        INSERT INTO items (id, owner, parent_id, sort_order, task, status, result_plan,
                           risk_help, priority, progress, note, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, '', '', '', '中', 0, '', ?, ?)
      `).run(uuidv4(), owner, parent_id ?? null, m + 1, task ?? '', now, now);
    });
  } else {
    const siblings = jsonItems.filter(i => (i.parent_id ?? null) === (parent_id ?? null));
    const maxOrder = siblings.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const now = Date.now();
    jsonItems.push({
      id: uuidv4(), owner, parent_id: parent_id ?? null,
      sort_order: maxOrder + 1,
      task: task ?? '', status: '', result_plan: '', risk_help: '',
      due_date: '', priority: '中', progress: 0, note: '',
      updated_at: now, created_at: now,
    });
    saveJSON();
  }
}

function updateItem(id, updates, clientUpdatedAt) {
  if (MODE === 'sqlite') {
    let conflict = false;
    let conflictItem = null;
    withExclusive(() => {
      const cur = db.prepare('SELECT updated_at FROM items WHERE id = ?').get(id);
      if (!cur) return;
      if (clientUpdatedAt < cur.updated_at) {
        conflict = true;
        conflictItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
        return;
      }
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE items SET ${setClauses}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(updates), Date.now(), id);
    });
    return { conflict, item: conflictItem };
  } else {
    const idx = jsonItems.findIndex(i => i.id === id);
    if (idx < 0) return { conflict: false, item: null };
    const item = jsonItems[idx];
    if (clientUpdatedAt < item.updated_at) return { conflict: true, item: { ...item } };
    Object.assign(item, updates, { updated_at: Date.now() });
    saveJSON();
    return { conflict: false, item };
  }
}

function deleteItem(id) {
  if (MODE === 'sqlite') {
    withExclusive(() => {
      const deleteTree = (itemId) => {
        const children = db.prepare('SELECT id FROM items WHERE parent_id = ?').all(itemId);
        for (const c of children) deleteTree(c.id);
        db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
      };
      deleteTree(id);
    });
  } else {
    const deleteTree = (itemId) => {
      const children = jsonItems.filter(i => i.parent_id === itemId);
      for (const c of children) deleteTree(c.id);
      const idx = jsonItems.findIndex(i => i.id === itemId);
      if (idx >= 0) jsonItems.splice(idx, 1);
    };
    deleteTree(id);
    saveJSON();
  }
}

function reorderItems(items) {
  if (MODE === 'sqlite') {
    withExclusive(() => {
      const updateOrder = db.prepare('UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?');
      const now = Date.now();
      for (const { id, sort_order } of items) updateOrder.run(sort_order, now, id);
    });
  } else {
    const now = Date.now();
    for (const { id, sort_order } of items) {
      const item = jsonItems.find(i => i.id === id);
      if (item) { item.sort_order = sort_order; item.updated_at = now; }
    }
    saveJSON();
  }
}

// ─── HTTP + WS ────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());

const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function syncAll() {
  broadcast({ type: 'sync_all', items: getAllItems() });
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/items', (_req, res) => {
  res.json(getAllItems());
});

app.post('/api/items/reorder', (req, res) => {
  const username = req.headers['x-username'];
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ message: '無效的排序資料' });

  for (const { id } of items) {
    const existing = getItem(id);
    if (!existing) return res.status(404).json({ message: `項目 ${id} 不存在` });
    if (existing.owner !== username) return res.status(403).json({ message: '越權操作' });
  }

  try {
    reorderItems(items);
    syncAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/items', (req, res) => {
  const username = req.headers['x-username'];
  const { owner, parent_id, task } = req.body;
  if (!username || owner !== username) return res.status(403).json({ message: '越權操作' });

  try {
    createItem({ owner, parent_id, task });
    syncAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/items/:id', (req, res) => {
  const { id } = req.params;
  const username = req.headers['x-username'];
  const { updated_at, ...rest } = req.body;

  const existing = getItem(id);
  if (!existing) return res.status(404).json({ message: '項目不存在' });
  if (existing.owner !== username) return res.status(403).json({ message: '越權操作' });

  const updates = {};
  for (const key of ALLOWED_FIELDS) { if (key in rest) updates[key] = rest[key]; }
  if (Object.keys(updates).length === 0) return res.status(400).json({ message: '無有效更新欄位' });

  try {
    const result = updateItem(id, updates, updated_at);
    if (result.conflict) {
      return res.status(409).json({
        conflict: true, item: result.item,
        message: '資料已由他人更新，請確認後重新操作',
      });
    }
    syncAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/items/:id', (req, res) => {
  const { id } = req.params;
  const username = req.headers['x-username'];

  const existing = getItem(id);
  if (!existing) return res.status(404).json({ message: '項目不存在' });
  if (existing.owner !== username) return res.status(403).json({ message: '越權操作' });

  try {
    deleteItem(id);
    syncAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── WEBSOCKET（供 client.js 連線，路徑 /ws）─────────────────────────────────

wss.on('connection', (ws, req) => {
  if (req.url !== '/ws') { ws.close(); return; }

  clients.add(ws);
  ws.send(JSON.stringify({ type: 'sync_all', items: getAllItems() }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'auth') console.log(`  [WS] ${msg.username} 已連線`);
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ─── PERIODIC SYNC ────────────────────────────────────────────────────────────

setInterval(syncAll, 10_000);

// ─── START ────────────────────────────────────────────────────────────────────

if (MODE === 'sqlite') {
  initSQLite();
} else if (MODE === 'json') {
  initJSON();
} else {
  console.error(`未知的 MODE: "${MODE}"，請設定為 'sqlite' 或 'json'`);
  process.exit(1);
}

server.listen(PORT, () => {
  const modeLabel = MODE === 'sqlite' ? `SQLite → ${PATH}` : `JSON → ${PATH}`;
  console.log(`✓ Server: http://localhost:${PORT}`);
  console.log(`  Mode:   ${modeLabel}`);
  console.log(`  WS:     ws://localhost:${PORT}/ws`);
});
