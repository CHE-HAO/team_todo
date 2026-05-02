# team_todo

繁體中文 | [English](#english)

---

## 繁體中文

### 簡介

team_todo 是一套輕量級的團隊工作追蹤工具。每位成員在自己的電腦上跑一個本地 Node.js server，所有 server 共用同一個放在網路共享磁碟上的 SQLite 檔案，即可即時協作、互看進度。

### 系統需求

| 項目 | 版本需求 |
|------|---------|
| Node.js | 20.x（建議）或 22.x+ |
| 作業系統 | macOS / Linux / Windows |
| 網路 | 所有成員需能存取共用 SQLite 檔案（網路磁碟） |

### 架構概述

```
成員 A (localhost:3000)  ─┐
成員 B (localhost:3001)  ─┼──► 共用 SQLite (網路磁碟)
成員 C (localhost:3002)  ─┘
        │
        └─ 瀏覽器透過 WebSocket 即時更新
           每 10 秒自動跨機器同步
```

- **單一檔案**：全部後端邏輯與前端 HTML 都在 `server.js`
- **WAL + 排他鎖**：多 server 同時寫入時透過 `BEGIN EXCLUSIVE` 避免資料損毀
- **衝突偵測**：每次更新攜帶 `updated_at` 時間戳，若伺服器端資料較新則拒絕並通知 client 刷新
- **即時同步**：同機器靠 WebSocket broadcast；跨機器靠每 10 秒重讀 DB

### 安裝與啟動

```bash
# 1. clone 專案（node_modules 已 vendored，不需 npm install）
git clone <repo-url>
cd team_todo

# 2. 修改 server.js 頂端三個設定（或用環境變數）
#    DB_PATH  = 指向網路共享的 .db 檔案路徑
#    PORT     = 選一個本機未佔用的 port
#    USERNAME = 你自己的名字

# 3. 啟動
node server.js
# 或
npm start
```

啟動後終端機會顯示：
```
✓ Server: http://localhost:3000
  User: Alice
  DB:   ./todo.db
```

用瀏覽器開啟顯示的網址即可使用。

### 設定方式

**方式一：直接編輯 `server.js` 頂端**

```js
const DB_PATH  = './todo.db';   // 改為網路磁碟路徑，如 /Volumes/share/team.db
const PORT     = 3000;          // 每人選不同 port（若在同一台機器）
const USERNAME = 'Alice';       // 改為自己的名字
```

**方式二：環境變數**

```bash
DB_PATH=/Volumes/share/team.db TODO_USER=Bob PORT=3001 node server.js
```

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

team_todo is a lightweight team task tracker. Each member runs a local Node.js server on their own machine. All servers share a single SQLite file stored on a network drive, enabling real-time collaboration and visibility across the team.

### Requirements

| Item | Version |
|------|---------|
| Node.js | 20.x (recommended) or 22.x+ |
| OS | macOS / Linux / Windows |
| Network | All members must have access to the shared SQLite file (network drive) |

### Architecture

```
Member A (localhost:3000)  ─┐
Member B (localhost:3001)  ─┼──► Shared SQLite (network drive)
Member C (localhost:3002)  ─┘
        │
        └─ Browser updated in real-time via WebSocket
           Cross-machine sync every 10 seconds
```

- **Single file**: All backend logic and frontend HTML live in `server.js`
- **WAL + exclusive lock**: Uses `BEGIN EXCLUSIVE` to prevent data corruption when multiple servers write concurrently
- **Conflict detection**: Each update carries an `updated_at` timestamp; if the server's record is newer, the write is rejected and the client is notified to refresh
- **Real-time sync**: Same-machine via WebSocket broadcast; cross-machine via DB re-read every 10 seconds

### Installation & Startup

```bash
# 1. Clone the repo (node_modules is vendored — no npm install needed)
git clone <repo-url>
cd team_todo

# 2. Edit the three constants at the top of server.js (or use env vars)
#    DB_PATH  = path to the shared .db file on the network drive
#    PORT     = any free local port
#    USERNAME = your name

# 3. Start the server
node server.js
# or
npm start
```

On startup the terminal will show:
```
✓ Server: http://localhost:3000
  User: Alice
  DB:   ./todo.db
```

Open the URL in your browser to use the app.

### Configuration

**Option 1: Edit the top of `server.js`**

```js
const DB_PATH  = './todo.db';   // e.g. /Volumes/share/team.db
const PORT     = 3000;          // each member picks a free port
const USERNAME = 'Alice';       // your name
```

**Option 2: Environment variables**

```bash
DB_PATH=/Volumes/share/team.db TODO_USER=Bob PORT=3001 node server.js
```

### Usage

#### Left sidebar (member list)
- Lists all members who have data in the shared DB
- Click a member's name to view their task list
- Your own name is marked with "(我)" / "(me)"
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
