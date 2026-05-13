'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TEST_DATA = path.join(os.tmpdir(), 'team-todo-playwright');

module.exports = async function globalSetup() {
  if (fs.existsSync(TEST_DATA)) {
    fs.rmSync(TEST_DATA, { recursive: true });
  }
  fs.mkdirSync(TEST_DATA, { recursive: true });
};
