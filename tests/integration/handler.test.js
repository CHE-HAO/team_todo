'use strict';
const os   = require('os');
const fs   = require('fs');
const path = require('path');

// Set DATA_PATH before any module requiring config.js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-handler-'));
process.env.DATA_PATH = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const http    = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const WS      = require('ws');
const wsHandler = require('../../ws/handler');

let server, port, clients;
const openClients = [];

beforeAll(done => {
  clients = new Set();
  wsHandler.init(clients);

  const app = express();
  server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', ws => {
    clients.add(ws);
    wsHandler.sendSync(ws).catch(() => {});
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      wsHandler.handleMessage(ws, msg).catch(err => {
        if (ws.readyState === 1)
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
      });
    });
    ws.on('close', () => clients.delete(ws));
  });

  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll(done => {
  openClients.forEach(ws => ws.terminate());
  server.close(done);
  fs.rmSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  // Terminate leftover clients from previous test
  openClients.splice(0).forEach(ws => ws.terminate());
  // Clear data files
  ['items', 'users', 'settings'].forEach(f => {
    const file = path.join(tmpDir, f + '.json');
    [file, file + '.tmp'].forEach(p => { try { fs.unlinkSync(p); } catch {} });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://localhost:${port}`);
    openClients.push(ws);
    ws.once('error', reject);
    ws.once('message', data => {
      const msg = JSON.parse(data);
      if (msg.type === 'sync_all') resolve(ws);
      else reject(new Error('Expected sync_all, got ' + msg.type));
    });
  });
}

function nextMessage(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeoutMs);
    const onMsg = data => {
      const msg = JSON.parse(data);
      if (!type || msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
  });
}

function sendMsg(ws, payload) {
  ws.send(JSON.stringify(payload));
}

async function setupUser(ws, name) {
  const p = nextMessage(ws, 'sync_all');
  sendMsg(ws, { type: 'set_username', name });
  return p;
}

// ── set_username ──────────────────────────────────────────────────────────────

describe('set_username', () => {
  test('有效名稱觸發 sync_all 廣播', async () => {
    const ws  = await connectClient();
    const msg = await sendMsg(ws, { type: 'set_username', name: 'Alice' }) || await nextMessage(ws, 'sync_all');
    // After setting username, server broadcasts sync_all
    // We just need to verify the call doesn't result in an error
    const syncP = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'set_username', name: 'TestUser' });
    const sync = await syncP;
    expect(sync.type).toBe('sync_all');
    expect(Array.isArray(sync.users)).toBe(true);
    expect(sync.users.some(u => u.name === 'TestUser')).toBe(true);
  });

  test('無效名稱（包含數字）回傳 error', async () => {
    const ws = await connectClient();
    const p  = nextMessage(ws, 'error');
    sendMsg(ws, { type: 'set_username', name: 'User123' });
    const msg = await p;
    expect(msg.type).toBe('error');
    expect(msg.message).toMatch(/用戶名稱/);
  });

  test('空名稱回傳 error', async () => {
    const ws = await connectClient();
    const p  = nextMessage(ws, 'error');
    sendMsg(ws, { type: 'set_username', name: '' });
    const msg = await p;
    expect(msg.type).toBe('error');
  });

  test('名稱超過 20 字回傳 error', async () => {
    const ws = await connectClient();
    const p  = nextMessage(ws, 'error');
    sendMsg(ws, { type: 'set_username', name: 'a'.repeat(21) });
    const msg = await p;
    expect(msg.type).toBe('error');
  });

  test('重新命名：舊名稱消失、新名稱出現', async () => {
    const ws = await connectClient();
    // Register as Alice
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'set_username', name: 'Alice' });
    await s1;
    // Rename to Alicia
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'set_username', name: 'Alicia', old_name: 'Alice' });
    const sync = await s2;
    expect(sync.users.some(u => u.name === 'Alicia')).toBe(true);
    expect(sync.users.some(u => u.name === 'Alice')).toBe(false);
  });

  test('重新命名為已使用名稱回傳 error', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();
    // Register ws1 as Alice
    const s1 = nextMessage(ws1, 'sync_all');
    sendMsg(ws1, { type: 'set_username', name: 'Alice' });
    await s1;
    // Register ws2 as Bob
    const s2 = nextMessage(ws2, 'sync_all');
    sendMsg(ws2, { type: 'set_username', name: 'Bob' });
    await s2;
    // Try to rename Bob -> Alice (collision)
    const p = nextMessage(ws2, 'error');
    sendMsg(ws2, { type: 'set_username', name: 'Alice', old_name: 'Bob' });
    const msg = await p;
    expect(msg.type).toBe('error');
    expect(msg.message).toMatch(/已被使用/);
  });

  test('sync_all 包含 settings 當 ws 已有 username', async () => {
    const ws   = await connectClient();
    const s1   = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'set_username', name: 'Alice' });
    const sync = await s1;
    expect(sync).toHaveProperty('settings');
    expect(sync.settings).toHaveProperty('hide_completed');
  });
});

// ── create_item ───────────────────────────────────────────────────────────────

describe('create_item', () => {
  test('建立項目後 sync_all 包含新項目', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const p = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: '測試任務' });
    const sync = await p;
    expect(sync.items.some(i => i.task === '測試任務')).toBe(true);
  });

  test('owner 為空時忽略訊息', async () => {
    const ws = await connectClient();
    // No response expected - just verify it doesn't crash
    sendMsg(ws, { type: 'create_item', owner: '', parent_id: null, task: 'T' });
    await new Promise(r => setTimeout(r, 200));
    // No error should be thrown
  });

  test('建立子項目帶有正確 parent_id', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    // Create parent
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'Parent' });
    const sync1 = await s1;
    const parent = sync1.items.find(i => i.task === 'Parent');
    // Create child
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: parent.id, task: 'Child' });
    const sync2 = await s2;
    const child = sync2.items.find(i => i.task === 'Child');
    expect(child.parent_id).toBe(parent.id);
  });
});

// ── update_item ───────────────────────────────────────────────────────────────

describe('update_item', () => {
  test('更新項目欄位', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'Original' });
    const { items: [item] } = await s1;
    // Update
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'update_item', id: item.id, updated_at: item.updated_at, task: 'Updated', status: '進行中' });
    const sync = await s2;
    const updated = sync.items.find(i => i.id === item.id);
    expect(updated.task).toBe('Updated');
    expect(updated.status).toBe('進行中');
  });

  test('衝突時回傳 conflict 訊息', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();
    await setupUser(ws1, 'Alice');
    // Create item via ws1
    const s1 = nextMessage(ws1, 'sync_all');
    sendMsg(ws1, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'T' });
    const sync1 = await s1;
    const item = sync1.items[0];
    const staleTs = item.updated_at;
    // ws1 updates first
    const s2 = nextMessage(ws1, 'sync_all');
    sendMsg(ws1, { type: 'update_item', id: item.id, updated_at: staleTs, task: 'First update' });
    await s2;
    // ws2 tries with stale timestamp
    const conflictP = nextMessage(ws2, 'conflict');
    sendMsg(ws2, { type: 'update_item', id: item.id, updated_at: staleTs, task: 'Conflicting' });
    const conflict = await conflictP;
    expect(conflict.type).toBe('conflict');
    expect(conflict.item.task).toBe('First update');
  });

  test('id 或 updated_at 缺失時忽略', async () => {
    const ws = await connectClient();
    sendMsg(ws, { type: 'update_item', id: null, updated_at: null, task: 'x' });
    await new Promise(r => setTimeout(r, 200));
    // No crash
  });
});

// ── delete_item ───────────────────────────────────────────────────────────────

describe('delete_item', () => {
  test('刪除項目後 sync_all 不包含該項目', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'To delete' });
    const sync1 = await s1;
    const item = sync1.items.find(i => i.task === 'To delete');
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'delete_item', id: item.id });
    const sync2 = await s2;
    expect(sync2.items.some(i => i.id === item.id)).toBe(false);
  });

  test('id 缺失時忽略', async () => {
    const ws = await connectClient();
    sendMsg(ws, { type: 'delete_item', id: null });
    await new Promise(r => setTimeout(r, 200));
  });
});

// ── reorder_items ─────────────────────────────────────────────────────────────

describe('reorder_items', () => {
  test('重排後 sync_all 項目反映新 sort_order', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'A' });
    const sync1 = await s1;
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'B' });
    const sync2 = await s2;
    const [itemA, itemB] = sync2.items;
    const s3 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'reorder_items', items: [{ id: itemA.id, sort_order: 5 }, { id: itemB.id, sort_order: 0 }] });
    const sync3 = await s3;
    const a = sync3.items.find(i => i.id === itemA.id);
    const b = sync3.items.find(i => i.id === itemB.id);
    expect(a.sort_order).toBe(5);
    expect(b.sort_order).toBe(0);
  });

  test('空陣列時忽略', async () => {
    const ws = await connectClient();
    sendMsg(ws, { type: 'reorder_items', items: [] });
    await new Promise(r => setTimeout(r, 200));
  });
});

// ── transfer_item ─────────────────────────────────────────────────────────────

describe('transfer_item', () => {
  test('轉移項目後 owner 改變', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const ws2 = await connectClient();
    await setupUser(ws2, 'Bob');
    // Create item as Alice
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'Transfer me' });
    const sync1 = await s1;
    const item  = sync1.items.find(i => i.task === 'Transfer me');
    // Transfer to Bob
    const s2 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'transfer_item', id: item.id, new_owner: 'Bob' });
    const sync2 = await s2;
    const transferred = sync2.items.find(i => i.id === item.id);
    expect(transferred.owner).toBe('Bob');
  });

  test('轉移至不存在用戶回傳 error', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const s1 = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'create_item', owner: 'Alice', parent_id: null, task: 'T' });
    const sync1 = await s1;
    const item  = sync1.items[0];
    const p = nextMessage(ws, 'error');
    sendMsg(ws, { type: 'transfer_item', id: item.id, new_owner: 'GhostUser' });
    const err = await p;
    expect(err.type).toBe('error');
    expect(err.message).toMatch(/不存在/);
  });
});

// ── update_settings ───────────────────────────────────────────────────────────

describe('update_settings', () => {
  test('更新設定後回傳 settings 訊息', async () => {
    const ws = await connectClient();
    await setupUser(ws, 'Alice');
    const p = nextMessage(ws, 'settings');
    sendMsg(ws, { type: 'update_settings', hide_completed: true });
    const msg = await p;
    expect(msg.type).toBe('settings');
    expect(msg.settings.hide_completed).toBe(true);
  });

  test('未登入時忽略（不回傳 settings）', async () => {
    const ws = await connectClient();
    // No username set
    sendMsg(ws, { type: 'update_settings', hide_completed: true });
    // Wait a bit - no response expected
    await new Promise(r => setTimeout(r, 300));
    // No error, no crash
  });

  test('初始連線帶有 settings（設定用戶名稱後）', async () => {
    const ws = await connectClient();
    const sync = nextMessage(ws, 'sync_all');
    sendMsg(ws, { type: 'set_username', name: 'Alice' });
    const msg = await sync;
    expect(msg).toHaveProperty('settings');
    expect(msg.settings).toHaveProperty('hide_completed', false);
  });
});
