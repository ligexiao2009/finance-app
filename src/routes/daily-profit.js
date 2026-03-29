const db = require('../db/db');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function handleDailyProfitRoutes(req, res) {
  if (req.method === 'POST' && req.url === '/api/save-daily-profit') {
    try {
      const profitData = await readJsonBody(req);
      await db.createDailyProfit(profitData);
      sendJson(res, 200, { success: true, message: '保存成功' });
    } catch (error) {
      console.error('Save daily profit error:', error);
      sendJson(res, 400, { success: false, message: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && req.url === '/api/daily-profit') {
    try {
      const records = await db.getDailyProfits();
      sendJson(res, 200, { records });
    } catch (error) {
      console.error('Error getting daily profits:', error);
      sendJson(res, 500, { error: 'Failed to get daily profits' });
    }
    return true;
  }

  if (req.method === 'POST' && req.url === '/api/daily-profit/delete') {
    try {
      const { date } = await readJsonBody(req);
      if (!date) {
        sendJson(res, 400, { success: false, message: 'date is required' });
        return true;
      }
      await db.deleteDailyProfit(date);
      sendJson(res, 200, { success: true, message: '删除成功' });
    } catch (error) {
      console.error('Delete daily profit error:', error);
      sendJson(res, 400, { success: false, message: error.message });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleDailyProfitRoutes,
};
