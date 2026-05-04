'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT     = parseInt(process.env.PORT)     || 3000;
const MODE     = process.env.TODO_MODE          || 'local-sqlite'; // 'server' | 'local-sqlite' | 'local-json'
const PATH     = (process.env.TODO_PATH         || './todo.db').replace(/\/$/, '');
const USERNAME = process.env.TODO_USER          || 'Justin';
// ──────────────────────────────────────────────────────────────────────────────

const express              = require('express');
const http                 = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 }       = require('uuid');
const ExcelJS              = require('exceljs');
const fs                   = require('fs');

const ALLOWED_FIELDS = ['task', 'status', 'result_plan', 'risk_help', 'due_date', 'priority', 'progress', 'note'];

// ─── STORAGE：SQLite（local-sqlite 模式）──────────────────────────────────────

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

// ─── STORAGE：JSON（local-json 模式）─────────────────────────────────────────

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

// ─── LOCAL STORAGE 統一介面 ───────────────────────────────────────────────────

function localGetAll() {
  if (MODE === 'local-sqlite') return db.prepare('SELECT * FROM items ORDER BY sort_order ASC').all();
  return [...jsonItems].sort((a, b) => a.sort_order - b.sort_order);
}

function localGetItem(id) {
  if (MODE === 'local-sqlite') return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null;
  return jsonItems.find(i => i.id === id) || null;
}

function localCreate({ owner, parent_id, task }) {
  if (MODE === 'local-sqlite') {
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

function localUpdate(id, updates, clientUpdatedAt) {
  if (MODE === 'local-sqlite') {
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

function localDelete(id) {
  if (MODE === 'local-sqlite') {
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

function localReorder(items) {
  if (MODE === 'local-sqlite') {
    withExclusive(() => {
      const getOwner    = db.prepare('SELECT owner FROM items WHERE id = ?');
      const updateOrder = db.prepare('UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?');
      const now = Date.now();
      for (const { id, sort_order } of items) {
        const row = getOwner.get(id);
        if (!row || row.owner !== USERNAME) throw Object.assign(new Error('越權操作'), { code: 'EPERM' });
        updateOrder.run(sort_order, now, id);
      }
    });
  } else {
    const now = Date.now();
    for (const { id, sort_order } of items) {
      const item = jsonItems.find(i => i.id === id);
      if (!item || item.owner !== USERNAME) throw Object.assign(new Error('越權操作'), { code: 'EPERM' });
      item.sort_order = sort_order;
      item.updated_at = now;
    }
    saveJSON();
  }
}

// ─── HTTP + WS SERVER（瀏覽器端）─────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const browserClients = new Set();
let allItems = [];

function broadcastToBrowsers(data) {
  const msg = JSON.stringify(data);
  for (const ws of browserClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function syncAllLocal() {
  allItems = localGetAll();
  broadcastToBrowsers({ type: 'sync_all', items: allItems });
}

// ─── WS 訊息處理（本地模式）──────────────────────────────────────────────────

function handleLocalMessage(ws, msg) {
  switch (msg.type) {

    case 'create_item': {
      const { owner, parent_id, task } = msg;
      if (owner !== USERNAME) return ws.send(JSON.stringify({ type: 'error', message: '越權操作' }));
      localCreate({ owner, parent_id, task });
      syncAllLocal();
      break;
    }

    case 'update_item': {
      const { id, updated_at } = msg;
      if (!id || updated_at == null) return;
      const existing = localGetItem(id);
      if (!existing) return;
      if (existing.owner !== USERNAME) return ws.send(JSON.stringify({ type: 'error', message: '越權操作' }));
      const updates = {};
      for (const key of ALLOWED_FIELDS) { if (key in msg) updates[key] = msg[key]; }
      if (Object.keys(updates).length === 0) return;
      const result = localUpdate(id, updates, updated_at);
      if (result.conflict) {
        ws.send(JSON.stringify({ type: 'conflict', item: result.item, message: '資料已由他人更新，請確認後重新操作' }));
      } else {
        syncAllLocal();
      }
      break;
    }

    case 'delete_item': {
      const { id } = msg;
      if (!id) return;
      const existing = localGetItem(id);
      if (!existing) return;
      if (existing.owner !== USERNAME) return ws.send(JSON.stringify({ type: 'error', message: '越權操作' }));
      localDelete(id);
      syncAllLocal();
      break;
    }

    case 'reorder_items': {
      const { items } = msg;
      if (!Array.isArray(items) || items.length === 0) return;
      try {
        localReorder(items);
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      syncAllLocal();
      break;
    }
  }
}

// ─── WS 訊息處理（伺服器模式，轉發至 server.js REST API）─────────────────────

async function handleServerMessage(browserWs, msg) {
  const headers = { 'Content-Type': 'application/json', 'X-Username': USERNAME };

  switch (msg.type) {

    case 'create_item': {
      const { owner, parent_id, task } = msg;
      const res = await fetch(`${PATH}/api/items`, {
        method: 'POST', headers,
        body: JSON.stringify({ owner, parent_id, task }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: '伺服器錯誤' }));
        browserWs.send(JSON.stringify({ type: 'error', message: data.message }));
      }
      break;
    }

    case 'update_item': {
      const { id, updated_at } = msg;
      const updates = {};
      for (const key of ALLOWED_FIELDS) { if (key in msg) updates[key] = msg[key]; }
      const res = await fetch(`${PATH}/api/items/${id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ updated_at, ...updates }),
      });
      if (res.status === 409) {
        const data = await res.json();
        browserWs.send(JSON.stringify({ type: 'conflict', item: data.item, message: data.message }));
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({ message: '伺服器錯誤' }));
        browserWs.send(JSON.stringify({ type: 'error', message: data.message }));
      }
      break;
    }

    case 'delete_item': {
      const { id } = msg;
      const res = await fetch(`${PATH}/api/items/${id}`, { method: 'DELETE', headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: '伺服器錯誤' }));
        browserWs.send(JSON.stringify({ type: 'error', message: data.message }));
      }
      break;
    }

    case 'reorder_items': {
      const { items } = msg;
      const res = await fetch(`${PATH}/api/items/reorder`, {
        method: 'POST', headers,
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: '伺服器錯誤' }));
        browserWs.send(JSON.stringify({ type: 'error', message: data.message }));
      }
      break;
    }
  }
}

// ─── WEBSOCKET（瀏覽器連線）──────────────────────────────────────────────────

wss.on('connection', (ws) => {
  browserClients.add(ws);
  ws.send(JSON.stringify({ type: 'sync_all', items: allItems }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (MODE === 'server') {
      handleServerMessage(ws, msg).catch(err => {
        console.error('[Server mode error]', err.message);
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
      });
    } else {
      try { handleLocalMessage(ws, msg); }
      catch (err) {
        console.error('[WS error]', err.message);
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }
  });

  ws.on('close', () => browserClients.delete(ws));
  ws.on('error', () => browserClients.delete(ws));
});

// ─── 伺服器模式：初始化 + 持久連線至 server.js ───────────────────────────────

let serverWs;

async function initServerMode() {
  try {
    const res = await fetch(`${PATH}/api/items`);
    if (res.ok) allItems = await res.json();
  } catch (err) {
    console.warn('[Server] 無法取得初始資料，稍後重試:', err.message);
  }
  connectToServer();
}

function connectToServer() {
  const wsUrl = PATH.replace(/^https?/, m => m === 'https' ? 'wss' : 'ws') + '/ws';
  serverWs = new WebSocket(wsUrl);

  serverWs.on('open', () => {
    console.log(`  已連線至 server: ${PATH}`);
    serverWs.send(JSON.stringify({ type: 'auth', username: USERNAME }));
  });

  serverWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'sync_all') {
      allItems = msg.items;
      broadcastToBrowsers(msg);
    }
  });

  serverWs.on('close', () => setTimeout(connectToServer, 3000));
  serverWs.on('error', () => serverWs.close());
}

// ─── HTTP ROUTES ──────────────────────────────────────────────────────────────

app.get('/export', async (_req, res) => {
  const items   = allItems;
  const byOwner = {};
  for (const item of items) {
    (byOwner[item.owner] ??= []).push(item);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'team-todo';

  for (const [owner, ownerItems] of Object.entries(byOwner)) {
    const sheet = workbook.addWorksheet(owner);
    sheet.columns = [
      { header: '工作項目',          key: 'task',        width: 40 },
      { header: '目前進度',          key: 'status',      width: 25 },
      { header: '成果/下一步計畫',    key: 'result_plan', width: 30 },
      { header: '風險/需要協助事項',  key: 'risk_help',   width: 30 },
      { header: '預定完成日期',      key: 'due_date',    width: 14 },
      { header: '優先順序',          key: 'priority',    width: 10 },
      { header: '進度%',             key: 'progress',    width: 8  },
      { header: '備註',              key: 'note',        width: 25 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    const addRows = (parentId, depth) => {
      const children = ownerItems
        .filter(i => (i.parent_id ?? null) === (parentId ?? null))
        .sort((a, b) => a.sort_order - b.sort_order);
      for (const item of children) {
        const prefix = depth === 0 ? '' : '  '.repeat(depth) + '└─ ';
        sheet.addRow({
          task:        prefix + (item.task        ?? ''),
          status:      item.status      ?? '',
          result_plan: item.result_plan ?? '',
          risk_help:   item.risk_help   ?? '',
          due_date:    item.due_date    ?? '',
          priority:    item.priority    ?? '',
          progress:    item.progress    ?? 0,
          note:        item.note        ?? '',
        });
        addRows(item.id, depth + 1);
      }
    };
    addRows(null, 0);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="team_todo.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getHTML());
});

// ─── START ────────────────────────────────────────────────────────────────────

async function start() {
  if (MODE === 'local-sqlite') {
    initSQLite();
    allItems = localGetAll();
    setInterval(syncAllLocal, 10_000);
  } else if (MODE === 'local-json') {
    initJSON();
    allItems = localGetAll();
    setInterval(syncAllLocal, 10_000);
  } else if (MODE === 'server') {
    await initServerMode();
  } else {
    console.error(`未知的 MODE: "${MODE}"，請設定為 'server'、'local-sqlite' 或 'local-json'`);
    process.exit(1);
  }

  server.listen(PORT, () => {
    const modeLabel = {
      'server':       `伺服器模式 → ${PATH}`,
      'local-sqlite': `本地 SQLite → ${PATH}`,
      'local-json':   `本地 JSON   → ${PATH}`,
    }[MODE];
    console.log(`✓ Client: http://localhost:${PORT}`);
    console.log(`  User:   ${USERNAME}`);
    console.log(`  Mode:   ${modeLabel}`);
  });
}

start();

// ─── HTML TEMPLATE ────────────────────────────────────────────────────────────

function getHTML() {
  return /* html */`<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Team Todo – ${USERNAME}</title>
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;background:#f0f0f0;height:100vh;overflow:hidden}

/* ── Layout ── */
.layout{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ── */
.sidebar{width:168px;min-width:168px;background:#1e1e2e;color:#cdd6f4;display:flex;flex-direction:column;overflow:hidden}
.sidebar-title{padding:16px 14px 8px;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#585b70;font-weight:700;border-bottom:1px solid #313244}
.user-list{flex:1;overflow-y:auto;padding:6px 0}
.user-item{padding:8px 14px;cursor:pointer;border-left:3px solid transparent;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .1s}
.user-item:hover{background:#313244}
.user-item.active{background:#313244;border-left-color:#89b4fa;color:#cdd6f4}
.user-item .me{font-size:10px;color:#a6e3a1;margin-left:4px}
.sidebar-footer{padding:10px 12px;border-top:1px solid #313244}
.btn-export{width:100%;padding:7px 0;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;cursor:pointer;font-size:12px;transition:background .1s}
.btn-export:hover{background:#45475a}

/* ── Main ── */
.main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.main-header{background:#fff;border-bottom:1px solid #ddd;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.main-header h2{font-size:14px;font-weight:600;color:#222}
.btn-add-root{padding:5px 12px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:700;transition:background .1s}
.btn-add-root:hover{background:#74c7ec}
.btn-add-root:disabled{opacity:.35;cursor:not-allowed}

/* ── Table ── */
.table-wrap{flex:1;overflow:auto;background:#f5f5f5}

:root{
  --col-ops:82px;
  --col-task:220px;
  --col-status:160px;
  --col-result:200px;
  --col-risk:180px;
  --col-due:120px;
  --col-priority:78px;
  --col-progress:78px;
  --col-note:160px;
}

.tbl-header{
  display:flex;align-items:center;
  background:#e8e8e8;border-bottom:2px solid #ccc;
  position:sticky;top:0;z-index:20;
  font-size:11px;font-weight:700;color:#555;
  padding:6px 0;
}
.tbl-header>div{padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}

.item-row{
  display:flex;align-items:stretch;
  border-bottom:1px solid #e4e4e4;
  background:#fff;
  min-height:34px;
}
.item-row:hover{background:#fafafa}

/* ── Columns ── */
.c-ops{width:var(--col-ops);min-width:var(--col-ops);display:flex;align-items:center;gap:1px;padding:2px 3px;flex-shrink:0}
.c-task{width:var(--col-task);min-width:var(--col-task);flex-shrink:0;display:flex;align-items:center}
.c-status{width:var(--col-status);min-width:var(--col-status);flex-shrink:0;display:flex;align-items:center}
.c-result{width:var(--col-result);min-width:var(--col-result);flex-shrink:0;display:flex;align-items:center}
.c-risk{width:var(--col-risk);min-width:var(--col-risk);flex-shrink:0;display:flex;align-items:center}
.c-due{width:var(--col-due);min-width:var(--col-due);flex-shrink:0;display:flex;align-items:center}
.c-priority{width:var(--col-priority);min-width:var(--col-priority);flex-shrink:0;display:flex;align-items:center}
.c-progress{width:var(--col-progress);min-width:var(--col-progress);flex-shrink:0;display:flex;align-items:center}
.c-note{width:var(--col-note);min-width:var(--col-note);flex-shrink:0;display:flex;align-items:center}

.indent{display:inline-block;flex-shrink:0}
.drag-handle{cursor:grab;color:#bbb;font-size:15px;padding:0 2px;user-select:none;line-height:1}
.drag-handle:active{cursor:grabbing}
.drag-handle:hover{color:#888}

.btn-add-child,.btn-del{border:none;background:none;cursor:pointer;font-size:14px;padding:1px 2px;border-radius:3px;line-height:1;flex-shrink:0}
.btn-add-child{color:#4caf50}.btn-add-child:hover{background:#e8f5e9}
.btn-del{color:#e53935}.btn-del:hover{background:#ffebee}

.sortable-ghost{opacity:.35;background:#c8ebfb!important}
.sortable-chosen{background:#e3f0ff!important}
.sortable-drag{opacity:.9}
.sortable-group{min-height:2px}

input[type=text],input[type=number],input[type=date],select{
  width:100%;border:none;background:transparent;
  padding:5px 6px;font-size:13px;color:#333;
  outline:none;font-family:inherit;
}
input[type=text]:focus,input[type=number]:focus,input[type=date]:focus,select:focus{background:#e8f0fe;border-radius:3px}
input[type=number]{-moz-appearance:textfield}
input[type=number]::-webkit-inner-spin-button{opacity:1}
select{cursor:pointer}
.ro-cell{padding:5px 6px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;font-size:13px}

/* ── Notifications ── */
#toast{
  position:fixed;top:14px;right:14px;
  background:#f57c00;color:#fff;
  padding:9px 14px;border-radius:8px;
  font-size:13px;max-width:320px;
  z-index:999;box-shadow:0 4px 14px rgba(0,0,0,.2);
  display:none;line-height:1.4;
}
#conn{
  position:fixed;bottom:10px;right:10px;
  font-size:11px;padding:3px 8px;border-radius:4px;
}
#conn.on{background:#e8f5e9;color:#2e7d32}
#conn.off{background:#ffebee;color:#c62828}
</style>
</head>
<body>
<div class="layout">

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-title">成員</div>
    <div class="user-list" id="user-list"></div>
    <div class="sidebar-footer">
      <button class="btn-export" onclick="exportExcel()">⬇ 匯出 Excel</button>
    </div>
  </div>

  <!-- Main -->
  <div class="main">
    <div class="main-header">
      <h2 id="viewing-label">—</h2>
      <button class="btn-add-root" id="btn-add-root" disabled onclick="addRootItem()">＋ 新增項目</button>
    </div>
    <div class="table-wrap">
      <div class="tbl-header">
        <div style="width:var(--col-ops)">操作</div>
        <div style="width:var(--col-task)">工作項目</div>
        <div style="width:var(--col-status)">目前進度</div>
        <div style="width:var(--col-result)">成果/下一步計畫</div>
        <div style="width:var(--col-risk)">風險/需要協助事項</div>
        <div style="width:var(--col-due)">預定完成日期</div>
        <div style="width:var(--col-priority)">優先順序</div>
        <div style="width:var(--col-progress)">進度%</div>
        <div style="width:var(--col-note)">備註</div>
      </div>
      <div id="items-root"></div>
    </div>
  </div>
</div>

<div id="toast"></div>
<div id="conn" class="off">● 未連線</div>

<script>
const ME = ${JSON.stringify(USERNAME)};
let allItems = [];
let currentUser = ME;
let ws;
let sortableInstances = [];

// ── WebSocket ──────────────────────────────────────────────────────────────

function connect() {
  ws = new WebSocket('ws://' + location.host);
  ws.onopen = () => setConn(true);
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'sync_all') {
      allItems = msg.items;
      render();
    } else if (msg.type === 'conflict') {
      const idx = allItems.findIndex(i => i.id === msg.item.id);
      if (idx >= 0) allItems[idx] = msg.item;
      render();
      showToast(msg.message);
    }
  };
  ws.onclose = () => { setConn(false); setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
}

function send(data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function setConn(on) {
  const el = document.getElementById('conn');
  el.className = on ? 'on' : 'off';
  el.textContent = on ? '● 已連線' : '● 已斷線';
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', 5000);
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  renderUserList();
  renderItems();
}

function renderUserList() {
  const owners = [...new Set(allItems.map(i => i.owner))].sort();
  if (!owners.includes(ME)) owners.unshift(ME);
  const list = document.getElementById('user-list');
  list.innerHTML = '';
  for (const owner of owners) {
    const d = document.createElement('div');
    d.className = 'user-item' + (owner === currentUser ? ' active' : '');
    d.innerHTML = esc(owner) + (owner === ME ? '<span class="me">(我)</span>' : '');
    d.onclick = () => { currentUser = owner; render(); };
    list.appendChild(d);
  }
}

function computeMaxDepth(items) {
  const depthOf = {};
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  function getDepth(id) {
    if (id in depthOf) return depthOf[id];
    const item = byId[id];
    depthOf[id] = item?.parent_id ? getDepth(item.parent_id) + 1 : 0;
    return depthOf[id];
  }
  return items.reduce((max, i) => Math.max(max, getDepth(i.id)), 0);
}

function renderItems() {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;

  for (const s of sortableInstances) s.destroy();
  sortableInstances = [];

  const isOwn = currentUser === ME;
  document.getElementById('btn-add-root').disabled = !isOwn;
  document.getElementById('viewing-label').textContent = currentUser + (isOwn ? ' (我)' : '');

  const userItems = allItems.filter(i => i.owner === currentUser);

  const maxD = Math.min(computeMaxDepth(userItems), 8);
  const opsWidth = maxD * 24 + 64;
  document.documentElement.style.setProperty('--col-ops', opsWidth + 'px');

  const root = document.getElementById('items-root');
  root.innerHTML = '';

  const roots = userItems.filter(i => !i.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  root.appendChild(buildGroup(null, roots, userItems, isOwn, 0));
}

function buildGroup(parentId, siblings, allUserItems, isOwn, depth) {
  const grp = document.createElement('div');
  grp.className = 'sortable-group';
  grp.dataset.parentId = parentId ?? 'root';

  for (const item of siblings) {
    const wrap = document.createElement('div');
    wrap.dataset.id = item.id;
    wrap.appendChild(buildRow(item, isOwn, depth));

    const childItems = allUserItems
      .filter(i => i.parent_id === item.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    wrap.appendChild(buildGroup(item.id, childItems, allUserItems, isOwn, depth + 1));

    grp.appendChild(wrap);
  }

  if (isOwn) {
    const inst = Sortable.create(grp, {
      handle: '.drag-handle',
      animation: 120,
      group: 'g-' + (parentId ?? 'root'),
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd() {
        const order = [...grp.children].map((w, idx) => ({ id: w.dataset.id, sort_order: idx }));
        send({ type: 'reorder_items', items: order });
      }
    });
    sortableInstances.push(inst);
  }

  return grp;
}

function buildRow(item, isOwn, depth) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.id = item.id;

  const indentPx = Math.min(depth, 8) * 24;

  // ── Ops column ──
  const ops = document.createElement('div');
  ops.className = 'c-ops';

  const indent = document.createElement('span');
  indent.className = 'indent';
  indent.style.width = indentPx + 'px';
  ops.appendChild(indent);

  if (isOwn) {
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = '拖曳排序';
    handle.textContent = '⠿';
    ops.appendChild(handle);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-child';
    addBtn.title = '新增子項目';
    addBtn.textContent = '＋';
    addBtn.onclick = () => addChild(item.id);
    ops.appendChild(addBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-del';
    delBtn.title = '刪除';
    delBtn.textContent = '×';
    delBtn.onclick = () => deleteItem(item.id, item.task);
    ops.appendChild(delBtn);
  }

  row.appendChild(ops);

  // ── Data columns ──
  const cols = [
    { key: 'task',        cls: 'c-task',     type: 'text'   },
    { key: 'status',      cls: 'c-status',   type: 'text'   },
    { key: 'result_plan', cls: 'c-result',   type: 'text'   },
    { key: 'risk_help',   cls: 'c-risk',     type: 'text'   },
    { key: 'due_date',    cls: 'c-due',      type: 'date'   },
    { key: 'priority',    cls: 'c-priority', type: 'select', opts: ['高','中','低'] },
    { key: 'progress',    cls: 'c-progress', type: 'number' },
    { key: 'note',        cls: 'c-note',     type: 'text'   },
  ];

  for (const col of cols) {
    const cell = document.createElement('div');
    cell.className = col.cls;

    if (isOwn) {
      let input;
      if (col.type === 'select') {
        input = document.createElement('select');
        for (const o of col.opts) {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          if (item[col.key] === o) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = col.type;
        input.value = item[col.key] ?? '';
        if (col.type === 'number') { input.min = 0; input.max = 100; }
      }

      input.onblur = () => {
        const live = allItems.find(i => i.id === item.id);
        if (!live) return;
        const val = col.type === 'number' ? (parseInt(input.value) || 0) : input.value;
        send({ type: 'update_item', id: item.id, updated_at: live.updated_at, [col.key]: val });
        live.updated_at = Date.now(); // 樂觀更新防止連續 blur 誤觸衝突
      };

      cell.appendChild(input);
    } else {
      const ro = document.createElement('div');
      ro.className = 'ro-cell';
      ro.title = String(item[col.key] ?? '');
      ro.textContent = item[col.key] ?? '';
      cell.appendChild(ro);
    }

    row.appendChild(cell);
  }

  return row;
}

// ── Actions ────────────────────────────────────────────────────────────────

function addRootItem()  { send({ type: 'create_item', owner: ME, parent_id: null,     task: '新項目'   }); }
function addChild(pid)  { send({ type: 'create_item', owner: ME, parent_id: pid,      task: '新子項目' }); }

function deleteItem(id, task) {
  const hasKids = allItems.some(i => i.parent_id === id);
  const msg = hasKids
    ? '確定刪除「' + task + '」及其所有子項目？'
    : '確定刪除「' + task + '」？';
  if (confirm(msg)) send({ type: 'delete_item', id });
}

function exportExcel() { window.open('/export', '_blank'); }

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

connect();
</script>
</body>
</html>`;
}
