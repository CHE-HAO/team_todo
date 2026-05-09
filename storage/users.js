'use strict';
const fs   = require('fs');
const path = require('path');
const { DATA_PATH } = require('../config');
const { enqueue }   = require('./queue');

const FILE = path.join(DATA_PATH, 'users.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).users || []; }
  catch { return []; }
}

function write(users) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2));
  fs.renameSync(tmp, FILE);
}

function getAll()        { return read(); }
function exists(name)    { return read().some(u => u.name === name); }

function register(name) {
  return enqueue('users', () => {
    const users = read();
    if (users.some(u => u.name === name)) return;
    users.push({ name, created_at: Date.now() });
    write(users);
  });
}

function rename(oldName, newName) {
  return enqueue('users', () => {
    const users = read();
    const u = users.find(u => u.name === oldName);
    if (u) u.name = newName;
    write(users);
  });
}

module.exports = { getAll, exists, register, rename };
