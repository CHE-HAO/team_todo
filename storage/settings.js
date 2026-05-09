'use strict';
const fs   = require('fs');
const path = require('path');
const { DATA_PATH } = require('../config');
const { enqueue }   = require('./queue');

const FILE = path.join(DATA_PATH, 'settings.json');

const DEFAULTS = { hide_completed: false };

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).settings || {}; }
  catch { return {}; }
}

function write(settings) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ settings }, null, 2));
  fs.renameSync(tmp, FILE);
}

function getUser(username) {
  return { ...DEFAULTS, ...(read()[username] || {}) };
}

function updateUser(username, updates) {
  return enqueue('settings', () => {
    const all = read();
    all[username] = { ...DEFAULTS, ...(all[username] || {}), ...updates };
    write(all);
    return all[username];
  });
}

function rename(oldName, newName) {
  return enqueue('settings', () => {
    const all = read();
    if (oldName in all) {
      all[newName] = all[oldName];
      delete all[oldName];
      write(all);
    }
  });
}

module.exports = { getUser, updateUser, rename };
