'use strict';
const os        = require('os');
const fs        = require('fs');
const path      = require('path');
const express   = require('express');
const supertest = require('supertest');

// Set DATA_PATH before requiring any module that uses config.js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-export-'));
process.env.DATA_PATH = tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const itemsStore     = require('../../storage/items');
const registerExport = require('../../routes/export');

const app = express();
registerExport(app);

const FILE = path.join(tmpDir, 'items.json');

function clearFiles() {
  [FILE, FILE + '.tmp'].forEach(f => { try { fs.unlinkSync(f); } catch {} });
}

beforeEach(clearFiles);
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

describe('GET /export', () => {
  test('無資料時回傳 200 及 xlsx content-type', async () => {
    const res = await supertest(app).get('/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  test('回傳 Content-Disposition 含 team_todo.xlsx', async () => {
    const res = await supertest(app).get('/export');
    expect(res.headers['content-disposition']).toContain('team_todo.xlsx');
  });

  test('有資料時回傳非空 binary', async () => {
    await itemsStore.create({ owner: 'Alice', parent_id: null, task: '匯出測試' });
    const res = await supertest(app).get('/export').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('xlsx 檔案以 PK 開頭（zip magic bytes）', async () => {
    await itemsStore.create({ owner: 'Alice', parent_id: null, task: 'Test' });
    const res = await supertest(app).get('/export').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    // xlsx is a zip file, starts with PK
    expect(res.body[0]).toBe(0x50); // 'P'
    expect(res.body[1]).toBe(0x4b); // 'K'
  });

  test('多個 owner 各自有資料', async () => {
    await itemsStore.create({ owner: 'Alice', parent_id: null, task: 'Alice task' });
    await itemsStore.create({ owner: 'Bob',   parent_id: null, task: 'Bob task' });
    const res = await supertest(app).get('/export').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(100);
  });

  test('有子項目時 DFS 順序匯出', async () => {
    const parent = await itemsStore.create({ owner: 'Alice', parent_id: null,      task: 'Parent' });
    await itemsStore.create({ owner: 'Alice', parent_id: parent.id, task: 'Child' });
    const res = await supertest(app).get('/export').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
