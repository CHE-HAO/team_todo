'use strict';
const fs      = require('fs');
const path    = require('path');
const http    = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { PORT, DATA_PATH } = require('./config');
const wsHandler   = require('./ws/handler');
const registerExport = require('./routes/export');

fs.mkdirSync(DATA_PATH, { recursive: true });

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
registerExport(app);

const clients = new Set();
wsHandler.init(clients);

wss.on('connection', (ws) => {
  clients.add(ws);
  wsHandler.sendSync(ws).catch(() => {});

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    wsHandler.handleMessage(ws, msg).catch(err => {
      console.error('[WS]', err.message);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
    });
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`✓ Server: http://0.0.0.0:${PORT}`);
  console.log(`  Data:   ${DATA_PATH}`);
});
