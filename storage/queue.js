'use strict';

const queues = new Map();

// Serialize async writes per key so concurrent callers don't corrupt files.
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn);
  queues.set(key, next.catch(() => {}));
  return next;
}

module.exports = { enqueue };
