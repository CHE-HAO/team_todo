'use strict';
const path = require('path');

const PORT      = parseInt(process.env.PORT) || 3000;
const DATA_PATH = path.resolve((process.env.DATA_PATH || './data').replace(/\/$/, ''));

module.exports = { PORT, DATA_PATH };
