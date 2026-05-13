'use strict';
const os   = require('os');
const path = require('path');

const TEST_PORT = 3997;
const TEST_DATA = path.join(os.tmpdir(), 'team-todo-playwright');

module.exports = {
  testDir: './tests/e2e',
  timeout:  30_000,
  expect:   { timeout: 8000 },
  use: {
    baseURL:  `http://localhost:${TEST_PORT}`,
    headless: true,
  },
  webServer: {
    command:             `PORT=${TEST_PORT} DATA_PATH=${TEST_DATA} node index.js`,
    url:                 `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout:             10_000,
    stdout:              'ignore',
    stderr:              'ignore',
  },
  globalSetup: './tests/e2e/globalSetup.js',
};
