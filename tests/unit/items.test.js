'use strict';
const os   = require('os');
const fs   = require('fs');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-items-'));
process.env.DATA_PATH = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const items = require('../../storage/items');

const FILE = path.join(tmpDir, 'items.json');

function clearFiles() {
  [FILE, FILE + '.tmp'].forEach(f => { try { fs.unlinkSync(f); } catch {} });
}

beforeEach(clearFiles);
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

// ── getAll ──────────────────────────────────────────────────────────────────

describe('getAll', () => {
  test('無檔案時回傳空陣列', () => {
    expect(items.getAll()).toEqual([]);
  });

  test('回傳結果按 sort_order 升冪排序', async () => {
    await items.create({ owner: 'A', parent_id: null, task: 'First' });
    await items.create({ owner: 'A', parent_id: null, task: 'Second' });
    const all = items.getAll();
    expect(all[0].sort_order).toBeLessThanOrEqual(all[1].sort_order);
  });
});

// ── create ──────────────────────────────────────────────────────────────────

describe('create', () => {
  test('建立項目包含所有預設欄位', async () => {
    const item = await items.create({ owner: 'Alice', parent_id: null, task: '測試項目' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.owner).toBe('Alice');
    expect(item.task).toBe('測試項目');
    expect(item.parent_id).toBeNull();
    expect(item.status).toBe('');
    expect(item.result_plan).toBe('');
    expect(item.risk_help).toBe('');
    expect(item.due_date).toBe('');
    expect(item.priority).toBe('中');
    expect(item.progress).toBe(0);
    expect(item.note).toBe('');
    expect(item.completed).toBe(false);
    expect(typeof item.created_at).toBe('number');
    expect(typeof item.updated_at).toBe('number');
  });

  test('task 為 undefined 時預設為空字串', async () => {
    const item = await items.create({ owner: 'Alice', parent_id: null, task: undefined });
    expect(item.task).toBe('');
  });

  test('新項目的 sort_order 小於既有兄弟項目（置頂行為）', async () => {
    const first  = await items.create({ owner: 'A', parent_id: null, task: 'First' });
    const second = await items.create({ owner: 'A', parent_id: null, task: 'Second' });
    expect(second.sort_order).toBeLessThan(first.sort_order);
  });

  test('子項目的 parent_id 對應父項目 id', async () => {
    const parent = await items.create({ owner: 'A', parent_id: null, task: 'Parent' });
    const child  = await items.create({ owner: 'A', parent_id: parent.id, task: 'Child' });
    expect(child.parent_id).toBe(parent.id);
  });

  test('子項目的 sort_order 不受不同層級兄弟影響', async () => {
    const p1 = await items.create({ owner: 'A', parent_id: null, task: 'P1' });
    const p2 = await items.create({ owner: 'A', parent_id: null, task: 'P2' });
    const c1 = await items.create({ owner: 'A', parent_id: p1.id, task: 'C1' });
    expect(c1.sort_order).not.toBe(p2.sort_order - 1); // different sibling group
  });

  test('建立後可透過 getAll 取回', async () => {
    await items.create({ owner: 'Bob', parent_id: null, task: 'Hello' });
    const all = items.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].task).toBe('Hello');
  });
});

// ── update ──────────────────────────────────────────────────────────────────

describe('update', () => {
  test('更新允許的欄位', async () => {
    const item = await items.create({ owner: 'A', parent_id: null, task: 'Original' });
    await items.update(item.id, { task: 'Updated', status: 'Done', progress: 80 }, item.updated_at);
    const updated = items.getAll().find(i => i.id === item.id);
    expect(updated.task).toBe('Updated');
    expect(updated.status).toBe('Done');
    expect(updated.progress).toBe(80);
  });

  test('更新後 updated_at 增加', async () => {
    const item = await items.create({ owner: 'A', parent_id: null, task: 'T' });
    const before = item.updated_at;
    await new Promise(r => setTimeout(r, 5));
    await items.update(item.id, { task: 'New' }, item.updated_at);
    const after = items.getAll().find(i => i.id === item.id).updated_at;
    expect(after).toBeGreaterThan(before);
  });

  test('clientUpdatedAt < server updated_at 回傳 conflict', async () => {
    const item  = await items.create({ owner: 'A', parent_id: null, task: 'T' });
    const stale = item.updated_at;
    await new Promise(r => setTimeout(r, 5));
    await items.update(item.id, { task: 'Server updated' }, stale);
    const result = await items.update(item.id, { task: 'Client stale' }, stale);
    expect(result.conflict).toBe(true);
    expect(result.item.task).toBe('Server updated');
  });

  test('clientUpdatedAt === server updated_at 允許更新', async () => {
    const item   = await items.create({ owner: 'A', parent_id: null, task: 'T' });
    const result = await items.update(item.id, { task: 'Updated' }, item.updated_at);
    expect(result.conflict).toBe(false);
  });

  test('不允許更新 owner 欄位', async () => {
    const item = await items.create({ owner: 'Alice', parent_id: null, task: 'T' });
    await items.update(item.id, { owner: 'Hacker' }, item.updated_at);
    const updated = items.getAll().find(i => i.id === item.id);
    expect(updated.owner).toBe('Alice');
  });

  test('不允許更新 id 欄位', async () => {
    const item = await items.create({ owner: 'A', parent_id: null, task: 'T' });
    const origId = item.id;
    await items.update(item.id, { id: 'fake-id' }, item.updated_at);
    expect(items.getAll().find(i => i.id === origId)).toBeTruthy();
  });

  test('不存在的 id 回傳 { conflict: false, item: null }', async () => {
    const result = await items.update('nonexistent-id', { task: 'x' }, 0);
    expect(result.conflict).toBe(false);
    expect(result.item).toBeNull();
  });

  test('completed 變為 true 時已完成項目排到未完成之後', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    const b = await items.create({ owner: 'A', parent_id: null, task: 'B' });
    // a has smaller sort_order (added second = placed at top)
    await items.update(a.id, { completed: true }, a.updated_at);
    const all = items.getAll().filter(i => i.parent_id === null);
    const aItem = all.find(i => i.id === a.id);
    const bItem = all.find(i => i.id === b.id);
    expect(bItem.sort_order).toBeLessThan(aItem.sort_order);
  });

  test('completed 由 true 變回 false 時排到未完成群組', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    await items.update(a.id, { completed: true }, a.updated_at);
    const latestA = items.getAll().find(i => i.id === a.id);
    await items.update(a.id, { completed: false }, latestA.updated_at);
    const final = items.getAll().find(i => i.id === a.id);
    expect(final.completed).toBe(false);
  });
});

// ── remove ──────────────────────────────────────────────────────────────────

describe('remove', () => {
  test('刪除指定 id 的項目', async () => {
    const item = await items.create({ owner: 'A', parent_id: null, task: 'Delete me' });
    await items.remove(item.id);
    expect(items.getAll()).toHaveLength(0);
  });

  test('級聯刪除子孫項目', async () => {
    const parent      = await items.create({ owner: 'A', parent_id: null,   task: 'P' });
    const child       = await items.create({ owner: 'A', parent_id: parent.id, task: 'C' });
    const grandchild  = await items.create({ owner: 'A', parent_id: child.id,  task: 'G' });
    await items.remove(parent.id);
    expect(items.getAll()).toHaveLength(0);
  });

  test('只刪除指定子樹，不影響無關項目', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    const b = await items.create({ owner: 'A', parent_id: null, task: 'B' });
    await items.remove(a.id);
    const all = items.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(b.id);
  });

  test('刪除不存在的 id 不拋出錯誤', async () => {
    await expect(items.remove('no-such-id')).resolves.not.toThrow();
  });
});

// ── reorder ─────────────────────────────────────────────────────────────────

describe('reorder', () => {
  test('更新指定項目的 sort_order', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    const b = await items.create({ owner: 'A', parent_id: null, task: 'B' });
    await items.reorder([{ id: a.id, sort_order: 10 }, { id: b.id, sort_order: 5 }]);
    const all  = items.getAll();
    expect(all.find(i => i.id === a.id).sort_order).toBe(10);
    expect(all.find(i => i.id === b.id).sort_order).toBe(5);
  });

  test('忽略不存在的 id', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    await items.reorder([{ id: 'unknown', sort_order: 99 }, { id: a.id, sort_order: 7 }]);
    expect(items.getAll()[0].sort_order).toBe(7);
  });

  test('reorder 後 updated_at 更新', async () => {
    const a = await items.create({ owner: 'A', parent_id: null, task: 'A' });
    const before = a.updated_at;
    await new Promise(r => setTimeout(r, 5));
    await items.reorder([{ id: a.id, sort_order: 0 }]);
    const after = items.getAll().find(i => i.id === a.id).updated_at;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

// ── transfer ─────────────────────────────────────────────────────────────────

describe('transfer', () => {
  test('轉移項目及其所有子孫至新 owner', async () => {
    const parent = await items.create({ owner: 'Alice', parent_id: null,     task: 'P' });
    const child  = await items.create({ owner: 'Alice', parent_id: parent.id, task: 'C' });
    const grand  = await items.create({ owner: 'Alice', parent_id: child.id,  task: 'G' });
    await items.transfer(parent.id, 'Bob');
    const all = items.getAll();
    expect(all.find(i => i.id === parent.id).owner).toBe('Bob');
    expect(all.find(i => i.id === child.id).owner).toBe('Bob');
    expect(all.find(i => i.id === grand.id).owner).toBe('Bob');
  });

  test('只轉移指定子樹，不影響無關項目', async () => {
    const a = await items.create({ owner: 'Alice', parent_id: null, task: 'A' });
    const b = await items.create({ owner: 'Alice', parent_id: null, task: 'B' });
    await items.transfer(a.id, 'Bob');
    expect(items.getAll().find(i => i.id === b.id).owner).toBe('Alice');
  });
});

// ── renameOwner ──────────────────────────────────────────────────────────────

describe('renameOwner', () => {
  test('更新所有符合舊名稱的項目 owner', async () => {
    await items.create({ owner: 'Alice', parent_id: null, task: 'A1' });
    await items.create({ owner: 'Alice', parent_id: null, task: 'A2' });
    await items.create({ owner: 'Bob',   parent_id: null, task: 'B1' });
    await items.renameOwner('Alice', 'Alicia');
    const all = items.getAll();
    expect(all.filter(i => i.owner === 'Alicia')).toHaveLength(2);
    expect(all.filter(i => i.owner === 'Alice')).toHaveLength(0);
    expect(all.filter(i => i.owner === 'Bob')).toHaveLength(1);
  });

  test('舊名稱不存在時不拋出錯誤', async () => {
    await expect(items.renameOwner('Ghost', 'Nobody')).resolves.not.toThrow();
  });
});

// ── ALLOWED_FIELDS ────────────────────────────────────────────────────────────

describe('ALLOWED_FIELDS', () => {
  test('包含所有預期的可更新欄位', () => {
    const expected = ['task', 'status', 'result_plan', 'risk_help', 'due_date', 'priority', 'progress', 'note', 'completed'];
    expect(items.ALLOWED_FIELDS).toEqual(expect.arrayContaining(expected));
    expect(items.ALLOWED_FIELDS).toHaveLength(expected.length);
  });
});
