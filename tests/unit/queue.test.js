'use strict';
const { enqueue } = require('../../storage/queue');

describe('enqueue - 佇列序列化', () => {
  test('同一 key 的任務依序執行', async () => {
    const results = [];
    await Promise.all([
      enqueue('q1', () => { results.push(1); }),
      enqueue('q1', () => { results.push(2); }),
      enqueue('q1', () => { results.push(3); }),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  test('不同 key 可獨立並發執行並各自回傳值', async () => {
    const a = enqueue('qa', () => Promise.resolve('a'));
    const b = enqueue('qb', () => Promise.resolve('b'));
    expect(await a).toBe('a');
    expect(await b).toBe('b');
  });

  test('非同步任務也保持序列', async () => {
    const results = [];
    await Promise.all([
      enqueue('q2', () => new Promise(r => setTimeout(() => { results.push('first'); r(); }, 20))),
      enqueue('q2', () => { results.push('second'); }),
    ]);
    expect(results).toEqual(['first', 'second']);
  });

  test('任務拋出錯誤不影響後續任務執行', async () => {
    enqueue('q3', () => { throw new Error('oops'); });
    const result = await enqueue('q3', () => 'ok');
    expect(result).toBe('ok');
  });

  test('Promise reject 不影響後續任務執行', async () => {
    enqueue('q4', () => Promise.reject(new Error('rejected')));
    const result = await enqueue('q4', () => 'survived');
    expect(result).toBe('survived');
  });
});
