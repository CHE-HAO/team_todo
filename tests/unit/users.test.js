'use strict';
const os   = require('os');
const fs   = require('fs');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-users-'));
process.env.DATA_PATH = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const users = require('../../storage/users');

const FILE = path.join(tmpDir, 'users.json');

function clearFiles() {
  [FILE, FILE + '.tmp'].forEach(f => { try { fs.unlinkSync(f); } catch {} });
}

beforeEach(clearFiles);
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

// ── getAll ───────────────────────────────────────────────────────────────────

describe('getAll', () => {
  test('無檔案時回傳空陣列', () => {
    expect(users.getAll()).toEqual([]);
  });

  test('回傳所有已註冊的用戶', async () => {
    await users.register('Alice');
    await users.register('Bob');
    const all = users.getAll();
    expect(all.map(u => u.name)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    expect(all).toHaveLength(2);
  });
});

// ── register ─────────────────────────────────────────────────────────────────

describe('register', () => {
  test('新增用戶', async () => {
    await users.register('Alice');
    expect(users.getAll()).toHaveLength(1);
    expect(users.getAll()[0].name).toBe('Alice');
  });

  test('用戶資料含 created_at 時間戳', async () => {
    await users.register('Alice');
    expect(typeof users.getAll()[0].created_at).toBe('number');
  });

  test('重複 register 相同名稱不重複新增', async () => {
    await users.register('Alice');
    await users.register('Alice');
    expect(users.getAll()).toHaveLength(1);
  });

  test('可新增多個不同用戶', async () => {
    await users.register('Alice');
    await users.register('Bob');
    await users.register('Charlie');
    expect(users.getAll()).toHaveLength(3);
  });
});

// ── exists ───────────────────────────────────────────────────────────────────

describe('exists', () => {
  test('不存在的用戶回傳 false', () => {
    expect(users.exists('Nobody')).toBe(false);
  });

  test('已註冊的用戶回傳 true', async () => {
    await users.register('Alice');
    expect(users.exists('Alice')).toBe(true);
  });

  test('大小寫視為不同用戶', async () => {
    await users.register('alice');
    expect(users.exists('Alice')).toBe(false);
  });
});

// ── rename ───────────────────────────────────────────────────────────────────

describe('rename', () => {
  test('重新命名用戶', async () => {
    await users.register('Alice');
    await users.rename('Alice', 'Alicia');
    expect(users.exists('Alice')).toBe(false);
    expect(users.exists('Alicia')).toBe(true);
  });

  test('重新命名後其他用戶不受影響', async () => {
    await users.register('Alice');
    await users.register('Bob');
    await users.rename('Alice', 'Alicia');
    expect(users.exists('Bob')).toBe(true);
    expect(users.getAll()).toHaveLength(2);
  });

  test('舊名稱不存在時不拋出錯誤', async () => {
    await expect(users.rename('Ghost', 'Nobody')).resolves.not.toThrow();
    expect(users.getAll()).toHaveLength(0);
  });
});
