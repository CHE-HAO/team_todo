# team_todo

繁體中文 | [English](#english)

---

## 繁體中文

### 簡介

team_todo 是一套輕量級的團隊工作追蹤工具，支援三種執行模式：

| 模式 | 說明 |
|------|------|
| **本地 SQLite** | 單人或共享 SQLite 檔案（舊有模式，向下相容） |
| **本地 JSON** | 單人使用，以 JSON 檔案儲存 |
| **伺服器模式** | 多人共用，所有人連線至同一台 `server.js` |

### 系統需求

| 項目 | 需求 |
|------|------|
| Node.js | 20.x 以上（需支援全域 `fetch`） |
| 作業系統 | macOS / Linux / Windows |

### 架構概述

```
伺服器模式：
  [瀏覽器] ─WS─► [client.js 本地 :3000] ─REST API─► [server.js 共享 :8080]
                                          ◄─WS sync_all──────────────────────

本地模式：
  [瀏覽器] ─WS─► [client.js 本地 :3000] ─► SQLite / JSON 本地檔案
```

- **衝突偵測**：每次更新攜帶 `updated_at` 時間戳，若伺服器端資料較新則拒絕並通知 client 刷新
- **即時同步**：同機器靠 WebSocket broadcast；跨機器（本地模式）靠每 10 秒重讀儲存檔；伺服器模式靠 server.js 主動推送
- **WAL + 排他鎖**（SQLite）：`BEGIN EXCLUSIVE` 避免多寫入者資料損毀

---

### 安裝

```bash
git clone <repo-url>
cd team_todo
# node_modules 已 vendored，不需 npm install
```

---

### 各模式啟動方式

#### 1. 本地 SQLite 模式（預設）

與舊版行為完全相同，適合單人使用或透過網路共享磁碟多人協作。

```bash
node client.js
# 或
npm start
```

**設定（選擇其一）：**

直接修改 `client.js` 頂端：
```js
const PORT     = 3000;
const MODE     = 'local-sqlite';
const PATH     = './todo.db';      // 可改為網路磁碟路徑
const USERNAME = 'Justin';
```

或使用環境變數：
```bash
PORT=3001 TODO_PATH=/Volumes/share/team.db TODO_USER=Alice node client.js
```

---

#### 2. 本地 JSON 模式

以 JSON 檔案取代 SQLite，其餘行為相同。

```bash
TODO_MODE=local-json TODO_PATH=./todo.json TODO_USER=Alice node client.js
```

---

#### 3. 伺服器模式（多人共用）

**步驟 1：啟動共享伺服器（只需一台機器執行）**

```bash
node server.js
# 或
npm run server
```

設定（修改 `server.js` 頂端或使用環境變數）：
```js
const PORT = 8080;
const MODE = 'sqlite';      // 'sqlite' 或 'json'
const PATH = './shared.db'; // 資料儲存路徑
```

```bash
PORT=8080 TODO_MODE=sqlite TODO_PATH=./shared.db node server.js
```

啟動後顯示：
```
✓ Server: http://localhost:8080
  Mode:   SQLite → ./shared.db
  WS:     ws://localhost:8080/ws
```

**步驟 2：每位成員各自啟動 client.js**

```bash
TODO_MODE=server TODO_PATH=http://192.168.1.100:8080 TODO_USER=Alice PORT=3000 node client.js
```

`TODO_PATH` 填入 server.js 的 HTTP 位址。每位成員可用不同的本機 PORT，但指向同一個 server。

---

### 啟動訊息範例

```
✓ Client: http://localhost:3000
  User:   Alice
  Mode:   伺服器模式 → http://192.168.1.100:8080
```

用瀏覽器開啟顯示的網址即可使用。

---

### 環境變數對照表

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PORT` | `3000`（client） / `8080`（server） | 監聽 port |
| `TODO_MODE` | `local-sqlite`（client） / `sqlite`（server） | 執行模式 |
| `TODO_PATH` | `./todo.db`（client） / `./shared.db`（server） | 資料路徑或 server URL |
| `TODO_USER` | `Justin` | 使用者名稱（僅 client 使用） |

---

### 操作說明

#### 左側欄（成員列表）
- 顯示所有有資料的成員名稱
- 點選成員名稱可切換查看該成員的工作清單
- 自己的名稱旁會標示「(我)」
- 底部「⬇ 匯出 Excel」可下載所有成員的資料

#### 工作項目欄位

| 欄位 | 說明 |
|------|------|
| 工作項目 | 任務名稱 |
| 目前進度 | 目前執行狀態的文字描述 |
| 成果/下一步計畫 | 已完成事項或後續行動 |
| 風險/需要協助事項 | 阻礙或需要他人支援的事項 |
| 優先順序 | 高 / 中 / 低 |
| 進度% | 0–100 的數字 |
| 備註 | 其他補充說明 |

#### 新增與編輯（僅限自己的清單）
- 點「＋ 新增項目」新增根層級項目
- 點每列左側的「＋」新增子項目（支援多層巢狀）
- 直接點擊欄位內容即可編輯，游標離開後自動存檔
- 拖曳左側「⠿」圖示可調整同層順序
- 點「×」刪除項目（含所有子項目，刪除前會跳出確認視窗）

#### 衝突處理
若同一筆資料被其他人更新，系統會跳出橘色提示，並自動刷新為最新版本，確認後再重新編輯即可。

#### 匯出 Excel
點選左側欄底部「⬇ 匯出 Excel」，下載 `team_todo.xlsx`。每位成員各佔一個工作表，依樹狀結構排列，子項目以 `└─` 縮排呈現。

---

## English

### Overview

team_todo is a lightweight team task tracker that supports three operating modes:

| Mode | Description |
|------|-------------|
| **local-sqlite** | Single-user or shared SQLite file (backward compatible with old setup) |
| **local-json** | Single-user, JSON file storage |
| **server** | Multi-user, everyone connects to a shared `server.js` |

### Requirements

| Item | Requirement |
|------|-------------|
| Node.js | 20.x or above (needs global `fetch`) |
| OS | macOS / Linux / Windows |

### Architecture

```
Server mode:
  [Browser] ─WS─► [client.js local :3000] ─REST API─► [server.js shared :8080]
                                            ◄─WS sync_all──────────────────────

Local mode:
  [Browser] ─WS─► [client.js local :3000] ─► SQLite / JSON local file
```

- **Conflict detection**: Each update carries an `updated_at` timestamp; if the server's record is newer, the write is rejected and the client is notified to refresh
- **Real-time sync**: Same-machine via WebSocket broadcast; cross-machine (local mode) via 10-second DB re-read; server mode via server.js push
- **WAL + exclusive lock** (SQLite): `BEGIN EXCLUSIVE` prevents corruption under concurrent writes

---

### Installation

```bash
git clone <repo-url>
cd team_todo
# node_modules is vendored — no npm install needed
```

---

### Startup by Mode

#### 1. Local SQLite Mode (default)

Identical to the old behavior. Works for solo use or shared network drive collaboration.

```bash
node client.js
# or
npm start
```

**Configuration (choose one):**

Edit the top of `client.js`:
```js
const PORT     = 3000;
const MODE     = 'local-sqlite';
const PATH     = './todo.db';      // or a network drive path
const USERNAME = 'Justin';
```

Or use environment variables:
```bash
PORT=3001 TODO_PATH=/Volumes/share/team.db TODO_USER=Alice node client.js
```

---

#### 2. Local JSON Mode

Uses a JSON file instead of SQLite; otherwise identical.

```bash
TODO_MODE=local-json TODO_PATH=./todo.json TODO_USER=Alice node client.js
```

---

#### 3. Server Mode (multi-user)

**Step 1: Start the shared server (one machine only)**

```bash
node server.js
# or
npm run server
```

Configure by editing the top of `server.js` or using environment variables:
```js
const PORT = 8080;
const MODE = 'sqlite';      // 'sqlite' or 'json'
const PATH = './shared.db';
```

```bash
PORT=8080 TODO_MODE=sqlite TODO_PATH=./shared.db node server.js
```

On startup:
```
✓ Server: http://localhost:8080
  Mode:   SQLite → ./shared.db
  WS:     ws://localhost:8080/ws
```

**Step 2: Each member runs client.js**

```bash
TODO_MODE=server TODO_PATH=http://192.168.1.100:8080 TODO_USER=Alice PORT=3000 node client.js
```

Set `TODO_PATH` to the server's HTTP address. Each member can use a different local `PORT` but all point to the same server.

---

### Startup Output Example

```
✓ Client: http://localhost:3000
  User:   Alice
  Mode:   伺服器模式 → http://192.168.1.100:8080
```

Open the URL in a browser to use the app.

---

### Environment Variables

| Variable | Default (client) | Default (server) | Description |
|----------|-----------------|-----------------|-------------|
| `PORT` | `3000` | `8080` | Listen port |
| `TODO_MODE` | `local-sqlite` | `sqlite` | Operating mode |
| `TODO_PATH` | `./todo.db` | `./shared.db` | File path or server URL |
| `TODO_USER` | `Justin` | — | Username (client only) |

---

### Usage

#### Left sidebar (member list)
- Lists all members who have data
- Click a member's name to view their task list
- Your own name is marked with "(我)"
- Click "⬇ 匯出 Excel" at the bottom to download an Excel file with all members' data

#### Task fields

| Field | Description |
|-------|-------------|
| 工作項目 (Task) | Task name |
| 目前進度 (Status) | Current status description |
| 成果/下一步計畫 (Result/Plan) | Completed work or next actions |
| 風險/需要協助事項 (Risk/Help) | Blockers or items needing support |
| 優先順序 (Priority) | 高 (High) / 中 (Medium) / 低 (Low) |
| 進度% (Progress) | Number from 0 to 100 |
| 備註 (Note) | Additional notes |

#### Adding & editing (your own list only)
- Click "＋ 新增項目" to add a root-level item
- Click "＋" on any row to add a child item (unlimited nesting depth)
- Click any field to edit it; changes are saved automatically on blur
- Drag the "⠿" handle to reorder items within the same level
- Click "×" to delete an item and all its children (confirmation required)

#### Conflict handling
If a record was updated by another user, an orange toast message appears and the item is automatically refreshed to the latest version. Simply review the updated values and re-enter your changes.

#### Excel export
Click "⬇ 匯出 Excel" in the sidebar footer to download `team_todo.xlsx`. Each member gets their own worksheet. Items are listed in depth-first tree order with `└─` indentation for child items.
