'use strict';
const ExcelJS     = require('exceljs');
const itemsStore  = require('../storage/items');

module.exports = function registerExport(app) {
  app.get('/export', async (_req, res) => {
    const allItems = itemsStore.getAll();
    const byOwner  = {};
    for (const item of allItems) {
      (byOwner[item.owner] ??= []).push(item);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'team-todo';

    for (const [owner, ownerItems] of Object.entries(byOwner)) {
      const sheet = workbook.addWorksheet(owner);
      sheet.columns = [
        { header: '工作項目',         key: 'task',        width: 40 },
        { header: '目前進度',         key: 'status',      width: 25 },
        { header: '成果/下一步計畫',   key: 'result_plan', width: 30 },
        { header: '風險/需要協助事項', key: 'risk_help',   width: 30 },
        { header: '預定完成日期',     key: 'due_date',    width: 14 },
        { header: '優先順序',        key: 'priority',    width: 10 },
        { header: '進度%',           key: 'progress',    width: 8  },
        { header: '備註',            key: 'note',        width: 25 },
        { header: '已完成',          key: 'completed',   width: 8  },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

      const addRows = (parentId, depth) => {
        const children = ownerItems
          .filter(i => (i.parent_id ?? null) === (parentId ?? null))
          .sort((a, b) => a.sort_order - b.sort_order);
        for (const item of children) {
          const prefix = depth === 0 ? '' : '  '.repeat(depth) + '└─ ';
          sheet.addRow({
            task:        prefix + (item.task        ?? ''),
            status:      item.status      ?? '',
            result_plan: item.result_plan ?? '',
            risk_help:   item.risk_help   ?? '',
            due_date:    item.due_date    ?? '',
            priority:    item.priority    ?? '',
            progress:    item.progress    ?? 0,
            note:        item.note        ?? '',
            completed:   item.completed   ? '✓' : '',
          });
          addRows(item.id, depth + 1);
        }
      };
      addRows(null, 0);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="team_todo.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  });
};
