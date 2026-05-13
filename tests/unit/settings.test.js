'use strict';
const os   = require('os');
const fs   = require('fs');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-settings-'));
process.env.DATA_PATH = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const settings = require('../../storage/settings');

const FILE = path.join(tmpDir, 'settings.json');

function clearFiles() {
  [FILE, FILE + '.tmp'].forEach(f => { try { fs.unlinkSync(f); } catch {} });
}

beforeEach(clearFiles);
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

// ── getUser ──────────────────────────────────────────────────────────────────

describe('getUser', () => {
  test('未知用戶回傳預設值', () => {
    const s = settings.getUser('Unknown');
    expect(s.hide_completed).toBe(false);
  });

  test('回傳物件包含所有預設欄位', () => {
    const s = settings.getUser('Nobody');
    expect(s).toHaveProperty('hide_completed');
  });
});

// ── updateUser ───────────────────────────────────────────────────────────────

describe('updateUser', () => {
  test('儲存 hide_completed = true', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    expect(settings.getUser('Alice').hide_completed).toBe(true);
  });

  test('儲存 hide_completed = false 覆蓋舊值', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    await settings.updateUser('Alice', { hide_completed: false });
    expect(settings.getUser('Alice').hide_completed).toBe(false);
  });

  test('回傳已儲存的設定', async () => {
    const result = await settings.updateUser('Alice', { hide_completed: true });
    expect(result.hide_completed).toBe(true);
  });

  test('多個用戶設定互不干擾', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    await settings.updateUser('Bob',   { hide_completed: false });
    expect(settings.getUser('Alice').hide_completed).toBe(true);
    expect(settings.getUser('Bob').hide_completed).toBe(false);
  });

  test('部分更新時保留其他預設值', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    const s = settings.getUser('Alice');
    expect(s).toHaveProperty('hide_completed', true);
  });
});

// ── rename ───────────────────────────────────────────────────────────────────

describe('rename', () => {
  test('將設定從舊名稱搬移至新名稱', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    await settings.rename('Alice', 'Alicia');
    expect(settings.getUser('Alice').hide_completed).toBe(false); // 舊名稱回到預設
    expect(settings.getUser('Alicia').hide_completed).toBe(true);
  });

  test('重新命名後其他用戶設定不受影響', async () => {
    await settings.updateUser('Alice', { hide_completed: true });
    await settings.updateUser('Bob',   { hide_completed: true });
    await settings.rename('Alice', 'Alicia');
    expect(settings.getUser('Bob').hide_completed).toBe(true);
  });

  test('舊名稱不存在時不拋出錯誤', async () => {
    await expect(settings.rename('Ghost', 'Nobody')).resolves.not.toThrow();
  });
});
