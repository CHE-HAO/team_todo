'use strict';
const itemsStore    = require('../storage/items');
const usersStore    = require('../storage/users');
const settingsStore = require('../storage/settings');

const NAME_RE = /^[一-龥a-zA-Z_]{1,20}$/;

// ws → username mapping (not enumerable, tied to ws lifetime)
const wsUserMap = new WeakMap();
let clients;

function init(clientSet) {
  clients = clientSet;
}

function getUsername(ws) { return wsUserMap.get(ws) || null; }

async function broadcast() {
  const allItems = itemsStore.getAll();
  const allUsers = usersStore.getAll();
  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    const username = wsUserMap.get(ws);
    const payload  = { type: 'sync_all', items: allItems, users: allUsers };
    if (username) payload.settings = settingsStore.getUser(username);
    ws.send(JSON.stringify(payload));
  }
}

async function sendSync(ws) {
  const allItems = itemsStore.getAll();
  const allUsers = usersStore.getAll();
  const username  = wsUserMap.get(ws);
  const payload   = { type: 'sync_all', items: allItems, users: allUsers };
  if (username) payload.settings = settingsStore.getUser(username);
  ws.send(JSON.stringify(payload));
}

async function handleMessage(ws, msg) {
  switch (msg.type) {

    case 'set_username': {
      const { name, old_name } = msg;
      if (!NAME_RE.test(name)) {
        return ws.send(JSON.stringify({ type: 'error', message: '用戶名稱僅限中文、英文及底線，長度 1-20 字' }));
      }
      // Collision check: another user already has this name
      if (old_name && old_name !== name && usersStore.exists(name)) {
        return ws.send(JSON.stringify({ type: 'error', message: `名稱「${name}」已被使用` }));
      }
      if (old_name && old_name !== name) {
        await usersStore.rename(old_name, name);
        await itemsStore.renameOwner(old_name, name);
        await settingsStore.rename(old_name, name);
      } else {
        await usersStore.register(name);
      }
      wsUserMap.set(ws, name);
      await broadcast();
      break;
    }

    case 'create_item': {
      const { owner, parent_id, task } = msg;
      if (!owner) return;
      await itemsStore.create({ owner, parent_id, task });
      await broadcast();
      break;
    }

    case 'update_item': {
      const { id, updated_at } = msg;
      if (!id || updated_at == null) return;
      const updates = {};
      for (const key of itemsStore.ALLOWED_FIELDS) { if (key in msg) updates[key] = msg[key]; }
      if (Object.keys(updates).length === 0) return;
      const result = await itemsStore.update(id, updates, updated_at);
      if (result.conflict) {
        ws.send(JSON.stringify({ type: 'conflict', item: result.item, message: '資料已由他人更新，請確認後重新操作' }));
      } else {
        await broadcast();
      }
      break;
    }

    case 'delete_item': {
      const { id } = msg;
      if (!id) return;
      await itemsStore.remove(id);
      await broadcast();
      break;
    }

    case 'reorder_items': {
      const { items } = msg;
      if (!Array.isArray(items) || items.length === 0) return;
      await itemsStore.reorder(items);
      await broadcast();
      break;
    }

    case 'transfer_item': {
      const { id, new_owner } = msg;
      if (!id || !new_owner) return;
      if (!usersStore.exists(new_owner)) {
        return ws.send(JSON.stringify({ type: 'error', message: `用戶「${new_owner}」不存在` }));
      }
      await itemsStore.transfer(id, new_owner);
      await broadcast();
      break;
    }

    case 'update_settings': {
      const username = wsUserMap.get(ws);
      if (!username) return;
      const { hide_completed } = msg;
      const saved = await settingsStore.updateUser(username, { hide_completed: !!hide_completed });
      ws.send(JSON.stringify({ type: 'settings', settings: saved }));
      break;
    }
  }
}

module.exports = { init, handleMessage, broadcast, sendSync, getUsername };
