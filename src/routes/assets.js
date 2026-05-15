/**
 * 资产记录路由
 */
const db = require('../db/db');

function beijingTime() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

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

async function handleAssetRoutes(req, res, { userId, sendCachedJson, invalidateCache }) {
  // GET /api/assets
  if (req.method === 'GET' && req.url === '/api/assets') {
    try {
      await sendCachedJson(req, res, 'assets', async () => {
        return await db.getAssetRecords(userId);
      });
    } catch (error) {
      console.error('Error getting asset records:', error);
      sendJson(res, 500, { error: 'Failed to get asset records' });
    }
    return true;
  }

  // POST /api/assets
  if (req.method === 'POST' && req.url === '/api/assets') {
    try {
      const record = await readJsonBody(req);
      const id = await db.createAssetRecord({
        recordedAt: beijingTime(),
        total: record.total, alipay: record.alipay, wechat: record.wechat,
        ths: record.ths, crypto: record.crypto, cmb: record.cmb,
        provident: record.provident, receivable: record.receivable, debt: record.debt,
      });
      invalidateCache('assets');
      sendJson(res, 200, { success: true, id });
    } catch (error) {
      console.error('Error creating asset record:', error);
      sendJson(res, 500, { error: 'Failed to create asset record' });
    }
    return true;
  }

  // DELETE /api/assets/:id
  if (req.method === 'DELETE' && req.url.startsWith('/api/assets/')) {
    const id = req.url.split('/api/assets/')[1];
    try {
      await db.deleteAssetRecord(id);
      invalidateCache('assets');
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Error deleting asset record:', error);
      sendJson(res, 500, { error: 'Failed to delete asset record' });
    }
    return true;
  }

  // DELETE /api/assets — 删除全部
  if (req.method === 'DELETE' && req.url === '/api/assets') {
    try {
      await db.deleteAllAssetRecords();
      invalidateCache('assets');
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Error deleting all asset records:', error);
      sendJson(res, 500, { error: 'Failed to delete asset records' });
    }
    return true;
  }

  return false;
}

module.exports = { handleAssetRoutes };
