# team_todo

繁體中文 | [English](#english)

---

## 繁體中文

### 簡介

team_todo 是一套輕量級的團隊工作追蹤工具。啟動單一伺服器後，所有成員直接用瀏覽器連線，無須各自安裝或執行任何程式。

### 系統需求

| 項目 | 需求 |
|------|------|
| Node.js | 20.x 以上 |
| 作業系統 | macOS / Linux / Windows |

### 架構概述

```
[瀏覽器 A] ─WS─┐
[瀏覽器 B] ─WS─┤─► [index.js :3000] ─► data/ (JSON 檔案)
[瀏覽器 C] ─WS─┘
```

所有資料儲存於 `data/` 目錄下的 JSON 檔案。使用者名稱在瀏覽器介面中設定，不需修改設定檔。

| 檔案 | 說明 |
|------|------|
| `data/items.json` | 所有工作項目 |
| `data/users.json` | 已登錄的成員 |
| `data/settings.json` | 各成員的個人設定 |

**key 元件**（均在 `index.js` 及各子模組）：

| 模組 | 說明 |
|------|------|
| `config.js` | PORT、DATA_PATH 設定 |
| `storage/items.js` | 工作項目 CRUD、衝突偵測、完成項目排序 |
| `storage/users.js` | 成員註冊與重新命名 |
| `storage/settings.js` | 個人設定（如隱藏已完成項目） |
| `storage/queue.js` | 寫入序列化，避免並發衝突 |
| `ws/handler.js` | WebSocket 訊息路由 |
| `routes/export.js` | GET /export → Excel 下載 |
| `public/index.html` | 前端 SPA |

**即時同步**：每次寫入後透過 WebSocket broadcast 推送給所有連線瀏覽器。

**衝突偵測**：每次 `update_item` 攜帶 `updated_at` 時間戳；若伺服器端資料較新，伺服器回傳 `conflict` 並附上最新資料，客戶端確認後重新編輯。

---

### 安裝

```bash
git clone <repo-url>
cd team_todo
# node_modules 已 vendored，不需 npm install
```

---

### 啟動

```bash
node index.js
# 或
npm start
```

啟動後顯示：

```
✓ Server: http://0.0.0.0:3000
  Data:   /path/to/team_todo/data
```

用瀏覽器開啟 `http://<伺服器IP>:3000` 即可使用。首次開啟時，介面會要求輸入使用者名稱。

---

### 設定

修改 `config.js` 頂端，或使用環境變數：

```js
const PORT      = parseInt(process.env.PORT)      || 3000;
const DATA_PATH = path.resolve((process.env.DATA_PATH || './data'));
```

| 環境變數 | 預設值 | 說明 |
|----------|--------|------|
| `PORT` | `3000` | 監聽 port |
| `DATA_PATH` | `./data` | JSON 資料儲存目錄 |

```bash
PORT=8080 DATA_PATH=/mnt/share/team_data node index.js
```

---

### 操作說明

#### 左側欄（成員列表）
- 顯示所有已登錄的成員名稱
- 點選成員名稱可切換查看該成員的工作清單
- 自己的名稱旁會標示「(我)」
- 可在設定中重新命名自己
- 底部「⬇ 匯出 Excel」可下載所有成員的資料

#### 工作項目欄位

| 欄位 | 說明 |
|------|------|
| 工作項目 | 任務名稱 |
| 目前進度 | 目前執行狀態的文字描述 |
| 成果/下一步計畫 | 已完成事項或後續行動 |
| 風險/需要協助事項 | 阻礙或需要他人支援的事項 |
| 預定完成日期 | 預計完成日期 |
| 優先順序 | 高 / 中 / 低 |
| 進度% | 0–100 的數字 |
| 備註 | 其他補充說明 |
| 已完成 | 勾選後項目自動移至清單底部 |

#### 新增與編輯（僅限自己的清單）
- 點「＋ 新增項目」新增根層級項目
- 點每列左側的「＋」新增子項目（支援多層巢狀）
- 直接點擊欄位內容即可編輯，游標離開後自動存檔
- 拖曳左側「⠿」圖示可調整同層順序
- 勾選「已完成」後，項目自動排至該層最底部
- 點「×」刪除項目（含所有子項目，刪除前會跳出確認視窗）
- 可將項目移轉給其他成員

#### 個人設定
- 可隱藏已完成的項目
- 可修改自己的使用者名稱（歷史資料一併更新）

#### 衝突處理
若同一筆資料被其他人更新，系統會跳出橘色提示，並自動刷新為最新版本，確認後再重新編輯即可。

#### 匯出 Excel
點選左側欄底部「⬇ 匯出 Excel」，下載 `team_todo.xlsx`。每位成員各佔一個工作表，依樹狀結構排列，子項目以縮排呈現。

---

## English

### Overview

team_todo is a lightweight team task tracker. Start a single server and all team members connect directly via browser — no per-user installation or local server required.

### Requirements

| Item | Requirement |
|------|-------------|
| Node.js | 20.x or above |
| OS | macOS / Linux / Windows |

### Architecture

```
[Browser A] ─WS─┐
[Browser B] ─WS─┤─► [index.js :3000] ─► data/ (JSON files)
[Browser C] ─WS─┘
```

All data is stored as JSON files in the `data/` directory. Usernames are set from the browser UI — no config file edits required.

| File | Description |
|------|-------------|
| `data/items.json` | All task items |
| `data/users.json` | Registered members |
| `data/settings.json` | Per-user settings |

**Key components:**

| Module | Description |
|--------|-------------|
| `config.js` | PORT and DATA_PATH settings |
| `storage/items.js` | Item CRUD, conflict detection, completed-item sorting |
| `storage/users.js` | Member registration and rename |
| `storage/settings.js` | Per-user settings (e.g. hide completed items) |
| `storage/queue.js` | Write serialization to prevent concurrent conflicts |
| `ws/handler.js` | WebSocket message routing |
| `routes/export.js` | GET /export → Excel download |
| `public/index.html` | Frontend SPA |

**Real-time sync**: After every write, changes are broadcast via WebSocket to all connected browsers.

**Conflict detection**: Each `update_item` carries an `updated_at` timestamp. If the server's record is newer, the server returns a `conflict` response with the latest data so the client can review and retry.

---

### Installation

```bash
git clone <repo-url>
cd team_todo
# node_modules is vendored — no npm install needed
```

---

### Starting the server

```bash
node index.js
# or
npm start
```

On startup:

```
✓ Server: http://0.0.0.0:3000
  Data:   /path/to/team_todo/data
```

Open `http://<server-IP>:3000` in a browser. On first visit, you will be prompted to enter your username.

---

### Configuration

Edit `config.js` or use environment variables:

```js
const PORT      = parseInt(process.env.PORT)      || 3000;
const DATA_PATH = path.resolve((process.env.DATA_PATH || './data'));
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Listen port |
| `DATA_PATH` | `./data` | Directory for JSON data files |

```bash
PORT=8080 DATA_PATH=/mnt/share/team_data node index.js
```

---

### Usage

#### Left sidebar (member list)
- Lists all registered members
- Click a member's name to view their task list
- Your own name is marked with "(我)"
- You can rename yourself from the settings panel
- Click "⬇ 匯出 Excel" at the bottom to export all members' data

#### Task fields

| Field | Description |
|-------|-------------|
| 工作項目 (Task) | Task name |
| 目前進度 (Status) | Current status description |
| 成果/下一步計畫 (Result/Plan) | Completed work or next actions |
| 風險/需要協助事項 (Risk/Help) | Blockers or items needing support |
| 預定完成日期 (Due date) | Target completion date |
| 優先順序 (Priority) | 高 (High) / 中 (Medium) / 低 (Low) |
| 進度% (Progress) | Number from 0 to 100 |
| 備註 (Note) | Additional notes |
| 已完成 (Completed) | Checking this moves the item to the bottom of its group |

#### Adding & editing (your own list only)
- Click "＋ 新增項目" to add a root-level item
- Click "＋" on any row to add a child item (unlimited nesting depth)
- Click any field to edit it; changes are saved automatically on blur
- Drag the "⠿" handle to reorder items within the same level
- Marking an item as completed automatically sorts it to the bottom of its group
- Click "×" to delete an item and all its children (confirmation required)
- Items can be transferred to another team member

#### Personal settings
- Toggle visibility of completed items
- Rename yourself (all existing data is updated automatically)

#### Conflict handling
If a record was updated by another user, an orange toast message appears and the item is automatically refreshed to the latest version. Simply review the updated values and re-enter your changes.

#### Excel export
Click "⬇ 匯出 Excel" in the sidebar footer to download `team_todo.xlsx`. Each member gets their own worksheet with items listed in depth-first tree order, with child items indented.
