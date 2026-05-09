'use strict';
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DATA_PATH } = require('../config');
const { enqueue }   = require('./queue');

const FILE = path.join(DATA_PATH, 'items.json');

const ALLOWED_FIELDS = [
  'task', 'status', 'result_plan', 'risk_help',
  'due_date', 'priority', 'progress', 'note', 'completed',
];

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).items || []; }
  catch { return []; }
}

function write(items) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2));
  fs.renameSync(tmp, FILE);
}

function getAll() {
  return read().sort((a, b) => a.sort_order - b.sort_order);
}

function create({ owner, parent_id, task }) {
  return enqueue('items', () => {
    const items = read();
    const siblings = items.filter(i => (i.parent_id ?? null) === (parent_id ?? null));
    const maxOrder = siblings.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const now = Date.now();
    const item = {
      id: uuidv4(), owner,
      parent_id: parent_id ?? null,
      sort_order: maxOrder + 1,
      task: task ?? '', status: '', result_plan: '', risk_help: '',
      due_date: '', priority: '中', progress: 0, note: '',
      completed: false,
      updated_at: now, created_at: now,
    };
    items.push(item);
    write(items);
    return item;
  });
}

function update(id, updates, clientUpdatedAt) {
  return enqueue('items', () => {
    const items = read();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return { conflict: false, item: null };
    const item = items[idx];
    if (clientUpdatedAt != null && clientUpdatedAt < item.updated_at) {
      return { conflict: true, item: { ...item } };
    }
    const safe = {};
    for (const key of ALLOWED_FIELDS) { if (key in updates) safe[key] = updates[key]; }
    const completedChanged = 'completed' in safe && safe.completed !== item.completed;
    Object.assign(item, safe, { updated_at: Date.now() });

    if (completedChanged) {
      const siblings = items.filter(i => (i.parent_id ?? null) === (item.parent_id ?? null));
      const others = siblings.filter(i => i.id !== id);
      const nonDone = others.filter(i => !i.completed).sort((a, b) => a.sort_order - b.sort_order);
      const done    = others.filter(i =>  i.completed).sort((a, b) => a.sort_order - b.sort_order);
      // item lands at boundary: last non-completed / first completed
      [...nonDone, item, ...done].forEach((i, n) => { i.sort_order = n; });
    }

    write(items);
    return { conflict: false, item };
  });
}

function remove(id) {
  return enqueue('items', () => {
    const items = read();
    const toDelete = new Set();
    const collect = pid => {
      toDelete.add(pid);
      items.filter(i => i.parent_id === pid).forEach(c => collect(c.id));
    };
    collect(id);
    write(items.filter(i => !toDelete.has(i.id)));
  });
}

function reorder(orderList) {
  return enqueue('items', () => {
    const items = read();
    const now = Date.now();
    for (const { id, sort_order } of orderList) {
      const item = items.find(i => i.id === id);
      if (item) { item.sort_order = sort_order; item.updated_at = now; }
    }
    write(items);
  });
}

function transfer(id, newOwner) {
  return enqueue('items', () => {
    const items = read();
    const now = Date.now();
    const cascade = itemId => {
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      item.owner = newOwner;
      item.updated_at = now;
      items.filter(i => i.parent_id === itemId).forEach(c => cascade(c.id));
    };
    cascade(id);
    write(items);
  });
}

function renameOwner(oldName, newName) {
  return enqueue('items', () => {
    const items = read();
    for (const item of items) {
      if (item.owner === oldName) item.owner = newName;
    }
    write(items);
  });
}

module.exports = { getAll, create, update, remove, reorder, transfer, renameOwner, ALLOWED_FIELDS };
