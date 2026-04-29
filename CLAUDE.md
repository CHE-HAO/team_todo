# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the server

```bash
node server.js          # start server (default port 3000)
npm start               # alias for the above
```

The server prints its URL, username, and DB path on startup. No build step required.

## Configuration

Edit the three constants at the very top of `server.js`:

```js
const DB_PATH  = './todo.db';       // path to shared SQLite file (network share path)
const PORT     = 3000;              // each user picks a free local port
const USERNAME = 'Alice';           // each user sets their own name
```

Each team member clones the repo, edits these three lines, and runs `node server.js`. All users point `DB_PATH` at the same network-shared `.db` file.

## Architecture

**Single file**: `server.js` contains the entire backend and the frontend HTML (embedded as a template literal in `getHTML()`).

**Deployment model**: Every user runs their own local Node.js server. Browsers connect to `localhost`. All servers share one SQLite file on a network mount. Real-time sync within the same machine happens via WebSocket broadcast; cross-machine sync happens via the 10-second periodic re-read of the DB.

**Key components** (all in `server.js`):

| Section | What it does |
|---------|-------------|
| DB init | Opens SQLite with `node:sqlite` (built-in, no native compilation), enables WAL + busy_timeout |
| `withExclusive(fn)` | Wraps writes in `BEGIN EXCLUSIVE` so concurrent servers don't corrupt data |
| WS `handleMessage` | Routes `create_item`, `update_item`, `delete_item`, `reorder_items`; enforces `owner === USERNAME` on all writes |
| `syncAll()` | Reads all rows and broadcasts to every connected browser tab; called after each write and every 10 s |
| `GET /export` | Streams an `.xlsx` file via ExcelJS; one sheet per owner, DFS tree order with `└─` indentation |
| `getHTML()` | Returns the full SPA; uses SortableJS (CDN) for drag-drop |

**Conflict detection**: each `update_item` carries the client's last-known `updated_at`. If the DB's value is newer, the server rejects the write and sends a `conflict` message with the latest row so the client refreshes before retrying.

**Drag-drop constraint**: SortableJS is initialized with a unique `group` name per parent (`'g-<parentId>'`), which prevents items from being dragged across parent boundaries.

## Dependencies

All packages are vendored (`node_modules/` is committed). No `npm install` needed after cloning.

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `ws` | WebSocket server |
| `exceljs` | Excel export |
| `uuid` | UUID generation for item IDs |
| `node:sqlite` | SQLite (Node.js built-in, no npm package) |
