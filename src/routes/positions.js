/**
 * 持仓路由 — CRUD
 */
const db = require('../db/db');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handlePositionRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix, loadCodeFixMap }) {
  // GET /api/data — 获取所有持仓
  if (req.method === 'GET' && req.url === '/api/data') {
    try {
      await sendCachedJson(req, res, 'data', async () => {
        const rows = await db.getPositions(userId);
        return { rows };
      });
    } catch (error) {
      console.error('Error getting positions:', error);
      sendJson(res, 500, { error: 'Failed to get data' });
    }
    return true;
  }

  // POST /api/save-row — 保存单行
  if (req.method === 'POST' && req.url === '/api/save-row') {
    try {
      const rowData = await readJsonBody(req);

      if (typeof rowData.shares === 'number') rowData.shares = parseFloat(rowData.shares.toFixed(4));
      if (typeof rowData.cost === 'number') rowData.cost = parseFloat(rowData.cost.toFixed(4));

      let existingPosition = null;
      if (rowData.id) existingPosition = await db.getPosition(rowData.id);
      if (!existingPosition && rowData.code && rowData.isFund !== undefined) {
        existingPosition = await db.getPositionByCode(rowData.code, rowData.isFund);
      }

      if (existingPosition) {
        await db.updatePosition(existingPosition.id, {
          code: rowData.code, name: rowData.name,
          shares: rowData.shares, cost: rowData.cost,
          isFund: rowData.isFund, isOverseas: rowData.isOverseas || false,
          planBuy: rowData.planBuy || 0, alert: rowData.alert || null,
          targetPrice: rowData.targetPrice || null, categoryId: rowData.categoryId || null,
        });
      } else {
        await db.createPosition({
          id: rowData.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
          code: rowData.code, name: rowData.name,
          shares: rowData.shares, cost: rowData.cost,
          isFund: rowData.isFund || false, isOverseas: rowData.isOverseas || false,
          planBuy: rowData.planBuy || 0, alert: rowData.alert || null,
          targetPrice: rowData.targetPrice || null, categoryId: rowData.categoryId || null,
          userId,
        });
      }

      invalidateCache('data');
      invalidateCacheByPrefix('quotes:');

      sendJson(res, 200, { success: true, message: '保存成功' });
    } catch (e) {
      console.error('Save row error:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/delete-row — 删除单行
  if (req.method === 'POST' && req.url === '/api/delete-row') {
    try {
      const { id, code, isFund } = await readJsonBody(req);
      let deleted = false;

      if (code && isFund !== undefined) {
        try { await db.deletePositionByCode(code, isFund); deleted = true; } catch (_) {}
      }
      if (!deleted && id) {
        try { await db.deletePosition(id); deleted = true; } catch (_) {}
      }

      if (deleted) {
        invalidateCache('data');
        invalidateCacheByPrefix('quotes:');
      }

      sendJson(res, 200, { success: true, deleted });
    } catch (e) {
      console.error('Delete row error:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/update-category — 更新分类
  if (req.method === 'POST' && req.url === '/api/update-category') {
    try {
      const { id, categoryId } = await readJsonBody(req);
      await db.updatePosition(id, { categoryId });
      invalidateCache('data');
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handlePositionRoutes };
