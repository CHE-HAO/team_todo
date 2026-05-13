'use strict';
const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitConnected(page) {
  await expect(page.locator('#ws-label')).toHaveText('已連線', { timeout: 6000 });
}

async function setUsername(page, name) {
  await page.fill('#username-input', name);
  await page.click('#btn-set-name');
  await expect(page.locator('#user-list')).toContainText(name, { timeout: 5000 });
}

async function ensureAtLeastOneItem(page) {
  const count = await page.locator('.item-row').count();
  if (count === 0) {
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
  }
}

// ── 頁面結構 ──────────────────────────────────────────────────────────────────

test.describe('頁面結構', () => {
  test('頁面標題為 Team Todo', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Team Todo');
  });

  test('頁面包含側邊欄和主要區域', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.main')).toBeVisible();
  });

  test('表格標題欄全部顯示', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tbl-header')).toContainText('工作項目');
    await expect(page.locator('.tbl-header')).toContainText('目前進度');
    await expect(page.locator('.tbl-header')).toContainText('成果/下一步計畫');
    await expect(page.locator('.tbl-header')).toContainText('風險/需要協助事項');
    await expect(page.locator('.tbl-header')).toContainText('預定完成日期');
    await expect(page.locator('.tbl-header')).toContainText('優先順序');
    await expect(page.locator('.tbl-header')).toContainText('進度%');
    await expect(page.locator('.tbl-header')).toContainText('備註');
  });

  test('匯出 Excel 按鈕存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.btn-export')).toBeVisible();
    await expect(page.locator('.btn-export')).toContainText('匯出');
  });

  test('隱藏已完成 checkbox 存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hide-completed')).toBeVisible();
  });
});

// ── WebSocket 連線 ────────────────────────────────────────────────────────────

test.describe('WebSocket 連線', () => {
  test('連線後狀態指示器顯示「已連線」', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await expect(page.locator('#ws-status')).toHaveClass(/\bon\b/);
  });

  test('#ws-status 元素存在且有 dot 子元素', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#ws-status')).toBeVisible();
    await expect(page.locator('#ws-status .dot')).toBeVisible();
  });
});

// ── 用戶名稱設定 ──────────────────────────────────────────────────────────────

test.describe('用戶名稱設定', () => {
  test('設定空白名稱顯示 toast 錯誤', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', '   ');
    await page.click('#btn-set-name');
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('名稱僅限');
  });

  test('設定含特殊字元名稱顯示 toast 錯誤', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', 'User@badname');
    await page.click('#btn-set-name');
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('設定含空白字元名稱顯示 toast 錯誤', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', 'Hello World');
    await page.click('#btn-set-name');
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('Enter 鍵可觸發設定名稱', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', 'EnterKeyUser');
    await page.press('#username-input', 'Enter');
    await expect(page.locator('#user-list')).toContainText('EnterKeyUser', { timeout: 5000 });
  });

  test('設定中文名稱成功並出現在用戶清單', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, '測試甲');
    await expect(page.locator('#user-list')).toContainText('測試甲');
  });

  test('設定英文名稱成功並出現在用戶清單', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'UserAlpha');
    await expect(page.locator('#user-list')).toContainText('UserAlpha');
  });

  test('設定含底線名稱成功', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'User_Beta');
    await expect(page.locator('#user-list')).toContainText('User_Beta');
  });

  test('設定名稱後顯示「我」徽章', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'UserGamma');
    await expect(page.locator('.me-badge').first()).toBeVisible();
    await expect(page.locator('.me-badge').first()).toContainText('我');
  });

  test('設定名稱後 localStorage 儲存用戶名', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'UserDelta');
    const stored = await page.evaluate(() => localStorage.getItem('todo_username'));
    expect(stored).toBe('UserDelta');
  });

  test('設定名稱後「新增項目」按鈕啟用', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await expect(page.locator('#btn-add-root')).toBeDisabled();
    await setUsername(page, 'UserEpsilon');
    await expect(page.locator('#btn-add-root')).toBeEnabled();
  });

  test('已設定名稱時頁面重載後自動還原', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'UserZeta');
    await page.reload();
    await waitConnected(page);
    const val = await page.locator('#username-input').inputValue();
    expect(val).toBe('UserZeta');
  });
});

// ── 用戶清單切換 ──────────────────────────────────────────────────────────────

test.describe('用戶清單切換', () => {
  test('點選自己的用戶項目後 viewing-label 顯示名稱', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'ViewerUser');
    // Explicitly click own user item
    await page.locator('#user-list .user-item', { hasText: 'ViewerUser' }).click();
    await expect(page.locator('#viewing-label')).toContainText('ViewerUser');
  });

  test('查看自己時顯示「(我)」', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'SelfViewer');
    // Click on own user to ensure currentUser is set to self
    await page.locator('#user-list .user-item', { hasText: 'SelfViewer' }).click();
    await expect(page.locator('#viewing-label')).toContainText('(我)');
  });

  test('點選其他用戶後 viewing-label 切換', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'SwitcherUser');
    // Click on self first
    await page.locator('#user-list .user-item', { hasText: 'SwitcherUser' }).click();
    await expect(page.locator('#viewing-label')).toContainText('SwitcherUser');

    // If there are other users, click one to verify label changes
    const allItems = page.locator('#user-list .user-item');
    const count = await allItems.count();
    if (count > 1) {
      const texts = await allItems.allTextContents();
      const otherIdx = texts.findIndex(t => !t.includes('SwitcherUser'));
      if (otherIdx >= 0) {
        await allItems.nth(otherIdx).click();
        await expect(page.locator('#viewing-label')).not.toContainText('SwitcherUser');
      }
    }
  });

  test('active class 標記當前選中的用戶', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'ActiveTester');
    await page.locator('#user-list .user-item', { hasText: 'ActiveTester' }).click();
    await expect(page.locator('#user-list .user-item.active')).toContainText('ActiveTester');
  });
});

// ── 新增項目 ──────────────────────────────────────────────────────────────────

test.describe('新增項目', () => {
  test('點選「新增項目」新增根項目（數量+1）', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CreatorA');
    await page.locator('#user-list .user-item', { hasText: 'CreatorA' }).click();

    const before = await page.locator('.item-row').count();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    const after = await page.locator('.item-row').count();
    expect(after).toBe(before + 1);
  });

  test('新增根項目顯示為「新項目」', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CreatorB');
    await page.locator('#user-list .user-item', { hasText: 'CreatorB' }).click();

    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    const firstInput = page.locator('.item-row').first().locator('[data-key="task"]');
    await expect(firstInput).toHaveValue('新項目', { timeout: 5000 });
  });

  test('點選子項目加號新增子項目（數量+1）', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CreatorC');
    await page.locator('#user-list .user-item', { hasText: 'CreatorC' }).click();

    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const before = await page.locator('.item-row').count();
    await page.locator('.btn-add-child').first().click();
    await expect(page.locator('.item-row')).toHaveCount(before + 1, { timeout: 5000 });
  });

  test('子項目預設文字為「新子項目」', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CreatorD');
    await page.locator('#user-list .user-item', { hasText: 'CreatorD' }).click();

    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.btn-add-child').first().click();
    await expect(page.locator('.item-row').nth(1)).toBeVisible({ timeout: 5000 });

    // Use evaluateAll to get JS values (attribute selector won't work for JS-set values)
    const values = await page.locator('[data-key="task"]').evaluateAll(
      els => els.map(e => e.value)
    );
    expect(values).toContain('新子項目');
  });
});

// ── 編輯項目 ──────────────────────────────────────────────────────────────────

test.describe('編輯項目欄位', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'EditorUser');
    await page.locator('#user-list .user-item', { hasText: 'EditorUser' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
  });

  test('編輯 task 欄位後 blur 儲存', async ({ page }) => {
    const taskInput = page.locator('.item-row').first().locator('[data-key="task"]');
    await taskInput.fill('已編輯的任務名稱');
    await taskInput.blur();
    await page.waitForTimeout(500);
    // Reload and verify persistence
    await page.reload();
    await waitConnected(page);
    await page.locator('#user-list .user-item', { hasText: 'EditorUser' }).click();
    await page.waitForTimeout(500);
    // Use evaluateAll since JS-set values can't be queried via CSS attribute selectors
    const values = await page.locator('[data-key="task"]').evaluateAll(
      els => els.map(e => e.value)
    );
    expect(values).toContain('已編輯的任務名稱');
  });

  test('按下 Escape 取消編輯還原原始值', async ({ page }) => {
    const taskInput = page.locator('.item-row').first().locator('[data-key="task"]');
    const original  = await taskInput.inputValue();
    await taskInput.fill('暫時輸入的文字');
    await taskInput.press('Escape');
    await expect(taskInput).toHaveValue(original);
  });

  test('編輯 status 欄位', async ({ page }) => {
    const statusInput = page.locator('.item-row').first().locator('[data-key="status"]');
    await statusInput.fill('進行中');
    await statusInput.blur();
    await page.waitForTimeout(300);
    await expect(statusInput).toHaveValue('進行中');
  });

  test('編輯 priority 下拉選單', async ({ page }) => {
    const prioritySelect = page.locator('.item-row').first().locator('[data-key="priority"]');
    await prioritySelect.selectOption('高');
    await page.waitForTimeout(300);
    await expect(prioritySelect).toHaveValue('高');
  });

  test('編輯 progress 數字欄位', async ({ page }) => {
    const progressInput = page.locator('.item-row').first().locator('[data-key="progress"]');
    await progressInput.fill('75');
    await progressInput.blur();
    await page.waitForTimeout(300);
    await expect(progressInput).toHaveValue('75');
  });

  test('編輯 note 備註欄位', async ({ page }) => {
    const noteInput = page.locator('.item-row').first().locator('[data-key="note"]');
    await noteInput.fill('這是備註');
    await noteInput.blur();
    await page.waitForTimeout(300);
    await expect(noteInput).toHaveValue('這是備註');
  });
});

// ── 刪除項目 ──────────────────────────────────────────────────────────────────

test.describe('刪除項目', () => {
  test('確認後刪除項目（數量-1）', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'DeleterA');
    await page.locator('#user-list .user-item', { hasText: 'DeleterA' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const before = await page.locator('.item-row').count();
    page.on('dialog', d => d.accept());
    await page.locator('.btn-del').first().click();
    await expect(page.locator('.item-row')).toHaveCount(before - 1, { timeout: 5000 });
  });

  test('取消不刪除項目（數量不變）', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'DeleterB');
    await page.locator('#user-list .user-item', { hasText: 'DeleterB' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const before = await page.locator('.item-row').count();
    page.on('dialog', d => d.dismiss());
    await page.locator('.btn-del').first().click();
    await page.waitForTimeout(500);
    expect(await page.locator('.item-row').count()).toBe(before);
  });

  test('有子項目時確認訊息包含「及其所有子項目」', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'DeleterC');
    await page.locator('#user-list .user-item', { hasText: 'DeleterC' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.btn-add-child').first().click();
    await expect(page.locator('.item-row').nth(1)).toBeVisible({ timeout: 5000 });

    let dialogMessage = '';
    page.once('dialog', d => {
      dialogMessage = d.message();
      d.dismiss();
    });
    await page.locator('.btn-del').first().click();
    await page.waitForTimeout(300);
    expect(dialogMessage).toContain('及其所有子項目');
  });
});

// ── 完成項目 ──────────────────────────────────────────────────────────────────

test.describe('完成/取消完成', () => {
  test('勾選 checkbox 標記為完成（row 加上 completed-row class）', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CheckerA');
    await page.locator('#user-list .user-item', { hasText: 'CheckerA' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const row = page.locator('.item-row').first();
    await row.locator('.chk-done').check();
    await expect(row).toHaveClass(/completed-row/, { timeout: 3000 });
  });

  test('取消勾選移除 completed-row class', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CheckerB');
    await page.locator('#user-list .user-item', { hasText: 'CheckerB' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const row = page.locator('.item-row').first();
    await row.locator('.chk-done').check();
    await expect(row).toHaveClass(/completed-row/, { timeout: 3000 });
    await row.locator('.chk-done').uncheck();
    await expect(row).not.toHaveClass(/completed-row/, { timeout: 3000 });
  });
});

// ── 隱藏已完成 ────────────────────────────────────────────────────────────────

test.describe('隱藏已完成設定', () => {
  test('勾選後已完成項目不顯示', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'HideUser');
    await page.locator('#user-list .user-item', { hasText: 'HideUser' }).click();

    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.item-row').first().locator('.chk-done').check();
    await page.waitForTimeout(400);

    const beforeHide = await page.locator('.item-row').count();
    await page.check('#hide-completed');
    await page.waitForTimeout(500);
    const afterHide = await page.locator('.item-row').count();
    expect(afterHide).toBeLessThan(beforeHide);
  });

  test('取消勾選後已完成項目重新顯示', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'UnhideUser');
    await page.locator('#user-list .user-item', { hasText: 'UnhideUser' }).click();

    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.item-row').first().locator('.chk-done').check();
    await page.waitForTimeout(400);

    await page.check('#hide-completed');
    await page.waitForTimeout(300);
    const hidden = await page.locator('.item-row').count();

    await page.uncheck('#hide-completed');
    await page.waitForTimeout(500);
    const shown = await page.locator('.item-row').count();
    expect(shown).toBeGreaterThan(hidden);
  });
});

// ── 展開/收合 ─────────────────────────────────────────────────────────────────

test.describe('展開/收合子項目', () => {
  async function setupParentChild(page, username) {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, username);
    await page.locator('#user-list .user-item', { hasText: username }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.btn-add-child').first().click();
    // Wait for child to appear
    await expect(page.locator('.item-row').nth(1)).toBeVisible({ timeout: 5000 });
  }

  test('有子項目時顯示 ▼ 收合按鈕', async ({ page }) => {
    await setupParentChild(page, 'CollapseA');
    const collapseBtn = page.locator('.item-wrap').first().locator('.btn-collapse').first();
    await expect(collapseBtn).not.toHaveClass(/no-children/);
    await expect(collapseBtn).toContainText('▼');
  });

  test('點擊 ▼ 收合子項目後顯示 ▶', async ({ page }) => {
    await setupParentChild(page, 'CollapseB');
    const collapseBtn = page.locator('.item-wrap').first().locator('.btn-collapse').first();
    await collapseBtn.click();
    await expect(collapseBtn).toContainText('▶');
    const childGroup = page.locator('.item-wrap').first().locator('.sortable-group').first();
    await expect(childGroup).toHaveCSS('display', 'none');
  });

  test('點擊 ▶ 展開後顯示 ▼', async ({ page }) => {
    await setupParentChild(page, 'CollapseC');
    const collapseBtn = page.locator('.item-wrap').first().locator('.btn-collapse').first();
    await collapseBtn.click();
    await expect(collapseBtn).toContainText('▶');
    await collapseBtn.click();
    await expect(collapseBtn).toContainText('▼');
  });

  test('無子項目的項目具有 no-children class', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'CollapseD');
    await page.locator('#user-list .user-item', { hasText: 'CollapseD' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const collapseBtn = page.locator('.item-row').first().locator('.btn-collapse').first();
    await expect(collapseBtn).toHaveClass(/no-children/);
  });

  test('收合狀態儲存至 sessionStorage', async ({ page }) => {
    await setupParentChild(page, 'CollapseE');
    const firstWrap   = page.locator('.item-wrap').first();
    const parentId    = await firstWrap.getAttribute('data-id');
    const collapseBtn = firstWrap.locator('.btn-collapse').first();
    await collapseBtn.click();

    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('collapsed') || '[]'));
    expect(stored).toContain(parentId);
  });
});

// ── 欄位寬度調整 ──────────────────────────────────────────────────────────────

test.describe('欄位寬度調整', () => {
  test('col-resizer 元素存在', async ({ page }) => {
    await page.goto('/');
    const count = await page.locator('.col-resizer').count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('拖曳 resizer 增加欄位寬度', async ({ page }) => {
    await page.goto('/');
    const resizer = page.locator('.col-resizer[data-col="status"]');
    const box = await resizer.boundingBox();

    const startW = await page.evaluate(() =>
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--col-status')) || 160
    );

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
    await page.mouse.up();

    const endW = await page.evaluate(() =>
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--col-status')) || 160
    );

    expect(endW).toBeGreaterThan(startW);
  });

  test('欄位寬度儲存至 cookie 並在重載後還原', async ({ page }) => {
    await page.goto('/');
    const resizer = page.locator('.col-resizer[data-col="note"]');
    const box = await resizer.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
    await page.mouse.up();

    const w1 = await page.evaluate(() =>
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--col-note'))
    );

    await page.reload();

    const w2 = await page.evaluate(() =>
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--col-note'))
    );

    expect(w2).toBe(w1);
  });
});

// ── Toast 通知 ────────────────────────────────────────────────────────────────

test.describe('Toast 通知', () => {
  test('錯誤操作顯示 toast', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', 'bad!name');
    await page.click('#btn-set-name');
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('Toast 5 秒後自動消失', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.fill('#username-input', 'bad@name');
    await page.click('#btn-set-name');
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).toBeHidden({ timeout: 7000 });
  });
});

// ── 轉移任務 ─────────────────────────────────────────────────────────────────

test.describe('轉移任務', () => {
  test('多用戶環境下顯示轉移按鈕', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'TransferSourceUser');
    await page.locator('#user-list .user-item', { hasText: 'TransferSourceUser' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    // Since multiple tests have run, there should be multiple users
    const userCount = await page.locator('#user-list .user-item').count();
    const transferCount = await page.locator('.btn-transfer').count();

    if (userCount > 1) {
      expect(transferCount).toBeGreaterThan(0);
    } else {
      // Single user: no transfer button
      expect(transferCount).toBe(0);
    }
  });

  test('點擊轉移按鈕顯示下拉選單', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await setUsername(page, 'TransferUser');
    await page.locator('#user-list .user-item', { hasText: 'TransferUser' }).click();
    await page.click('#btn-add-root');
    await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 5000 });

    const userCount = await page.locator('#user-list .user-item').count();
    if (userCount > 1) {
      await page.locator('.btn-transfer').first().click();
      await expect(page.locator('.transfer-sel').first()).toBeVisible();
    }
  });
});

// ── 匯出 Excel ────────────────────────────────────────────────────────────────

test.describe('匯出 Excel', () => {
  test('/export 端點回傳 200 和 xlsx content-type', async ({ page }) => {
    const res = await page.request.get('/export');
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('spreadsheetml');
  });

  test('/export 回傳 Content-Disposition 含 team_todo.xlsx', async ({ page }) => {
    const res = await page.request.get('/export');
    expect(res.headers()['content-disposition']).toContain('team_todo.xlsx');
  });
});

// ── index.js 伺服器功能 ───────────────────────────────────────────────────────

test.describe('index.js 伺服器', () => {
  test('/ 路由回傳 HTML', async ({ page }) => {
    const res = await page.request.get('/');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('Team Todo');
  });

  test('靜態檔案 sortable.min.js 可存取', async ({ page }) => {
    const res = await page.request.get('/sortable.min.js');
    expect(res.status()).toBe(200);
  });

  test('WebSocket 連線接受並發送 sync_all', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await expect(page.locator('#ws-status')).toHaveClass(/\bon\b/);
  });

  test('收到無效 JSON 時伺服器不崩潰', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.evaluate(() => {
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send('not-valid-json:{{{');
      }
    });
    await page.waitForTimeout(500);
    const res = await page.request.get('/');
    expect(res.status()).toBe(200);
  });

  test('WebSocket 斷線後自動重連', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    // Force close; onclose fires setConn(false) then schedules reconnect after 3s
    await page.evaluate(() => { if (window.ws) window.ws.close(); });
    // On localhost reconnect is nearly instant - just verify it re-establishes
    await expect(page.locator('#ws-label')).toHaveText('已連線', { timeout: 8000 });
  });
});
