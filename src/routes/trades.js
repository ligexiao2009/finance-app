/**
 * 待确认交易 + 交易历史路由
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

async function handleTradeRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix }) {
  // ========== 待确认交易 ==========

  // GET /api/pending-trades
  if (req.method === 'GET' && req.url === '/api/pending-trades') {
    try {
      await sendCachedJson(req, res, 'pending-trades', async () => {
        const trades = await db.getPendingTrades(userId);
        return { trades };
      });
    } catch (error) {
      console.error('Error getting pending trades:', error);
      sendJson(res, 500, { error: 'Failed to get pending trades' });
    }
    return true;
  }

  // POST /api/pending-trades — 新增
  if (req.method === 'POST' && req.url === '/api/pending-trades') {
    try {
      const trade = await readJsonBody(req);
      trade.user_id = userId;
      await db.createPendingTrade(trade);
      invalidateCache('pending-trades');
      sendJson(res, 200, { success: true, message: '保存成功' });
    } catch (e) {
      console.error('Error creating pending trade:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/pending-trades/delete — 删除
  if (req.method === 'POST' && req.url === '/api/pending-trades/delete') {
    try {
      const { id } = await readJsonBody(req);
      await db.deletePendingTrade(id);
      invalidateCache('pending-trades');
      sendJson(res, 200, { success: true });
    } catch (e) {
      console.error('Error deleting pending trade:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/save-pending-trades — 批量保存
  if (req.method === 'POST' && req.url === '/api/save-pending-trades') {
    try {
      const { trades } = await readJsonBody(req);
      await db.deleteAllPendingTrades(userId);
      for (const trade of trades) {
        trade.user_id = userId;
        await db.createPendingTrade(trade);
      }
      invalidateCache('pending-trades');
      sendJson(res, 200, { success: true, message: '批量保存成功' });
    } catch (e) {
      console.error('Error saving pending trades:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // ========== 交易历史 ==========

  // GET /api/trade-history
  if (req.method === 'GET' && req.url === '/api/trade-history') {
    try {
      await sendCachedJson(req, res, 'trade-history', async () => {
        const history = await db.getTradeHistory(userId);
        return { history };
      });
    } catch (error) {
      console.error('Error getting trade history:', error);
      sendJson(res, 500, { error: 'Failed to get trade history' });
    }
    return true;
  }

  // GET /api/trade-history/:rowId
  if (req.method === 'GET' && req.url.startsWith('/api/trade-history/')) {
    try {
      const rowId = req.url.split('/api/trade-history/')[1];
      await sendCachedJson(req, res, `trade-history:${rowId}`, async () => {
        const records = await db.getTradeHistoryByRowId(rowId);
        return { records };
      });
    } catch (error) {
      console.error('Error getting trade history by rowId:', error);
      sendJson(res, 500, { error: 'Failed to get trade history' });
    }
    return true;
  }

  // POST /api/trade-history — 新增
  if (req.method === 'POST' && req.url === '/api/trade-history') {
    try {
      const { rowId, record } = await readJsonBody(req);
      const formatted = { ...record };
      if (typeof formatted.shares === 'number') formatted.shares = parseFloat(formatted.shares.toFixed(2));
      if (typeof formatted.netValue === 'number') formatted.netValue = parseFloat(formatted.netValue.toFixed(4));

      await db.createTradeRecord({
        id: formatted.id, rowId, type: formatted.type,
        amount: formatted.amount, shares: formatted.shares,
        netValue: formatted.netValue, isBefore15: formatted.isBefore15 || true,
        createdAt: formatted.createdAt, localDate: formatted.localDate || null,
      });

      invalidateCache('trade-history', `trade-history:${rowId}`);
      sendJson(res, 200, { success: true, message: '保存成功' });
    } catch (e) {
      console.error('Error creating trade record:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/save-trade-history — 批量保存
  if (req.method === 'POST' && req.url === '/api/save-trade-history') {
    try {
      const { history } = await readJsonBody(req);

      await db.query('BEGIN');
      await db.query('DELETE FROM trade_history');

      for (const [rowId, records] of Object.entries(history)) {
        for (const record of records) {
          const formatted = { ...record };
          if (typeof formatted.shares === 'number') formatted.shares = parseFloat(formatted.shares.toFixed(2));
          if (typeof formatted.netValue === 'number') formatted.netValue = parseFloat(formatted.netValue.toFixed(4));

          await db.createTradeRecord({
            id: formatted.id, rowId, type: formatted.type,
            amount: formatted.amount, shares: formatted.shares,
            netValue: formatted.netValue, isBefore15: formatted.isBefore15 || true,
            createdAt: formatted.createdAt, localDate: formatted.localDate || null,
          });
        }
      }

      await db.query('COMMIT');
      invalidateCache('trade-history');
      invalidateCacheByPrefix('trade-history:');
      sendJson(res, 200, { success: true, message: '批量保存成功' });
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {});
      console.error('Error saving trade history:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleTradeRoutes };
