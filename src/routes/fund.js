/**
 * 基金相关路由 — 实时估算、回撤分析、详情、转换
 */
const db = require('../db/db');
const { fetchFundNetValue } = require('../utils/quotes');
const { analyzeFund, analyzeMultipleFunds } = require('../utils/fund-drawdown');
const { getFundDetail } = require('../utils/fund-detail');

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

function beijingTime() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

/** 获取基金实时估算 */
async function fetchFundEstimate(fundCode) {
  try {
    const url = `http://fundgz.1234567.com.cn/js/${fundCode}.js`;
    const response = await fetch(url);
    const text = await response.text();
    const jsonMatch = text.match(/jsonpgz\((\{.*?\})\s*\);?/s);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      return {
        success: true,
        fundCode: data.fundcode,
        fundName: data.name,
        estimateValue: parseFloat(data.gsz) || 0,
        estimateChange: parseFloat(data.gszzl) || 0,
        estimateTime: data.gztime || '',
      };
    }
    return { success: false, error: '解析失败' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleFundRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix }) {
  // ========== 基金实时估算 ==========

  // GET /api/fund-estimate/:code
  if (req.method === 'GET' && req.url.startsWith('/api/fund-estimate/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const fundCode = parsedUrl.pathname.split('/api/fund-estimate/')[1].replace(/\/$/, '');
      const result = await fetchFundEstimate(fundCode);
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/fund-estimate/batch
  if (req.method === 'POST' && req.url === '/api/fund-estimate/batch') {
    try {
      const { fundCodes } = await readJsonBody(req);
      if (!fundCodes || !Array.isArray(fundCodes)) {
        sendJson(res, 400, { success: false, error: 'fundCodes 必须是数组' });
        return true;
      }
      const results = [];
      for (const code of fundCodes) {
        results.push(await fetchFundEstimate(code));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      sendJson(res, 200, { success: true, results });
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  // ========== 基金回撤分析 ==========

  // GET /api/fund-drawdown/:code
  if (req.method === 'GET' && req.url.startsWith('/api/fund-drawdown/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const fundCode = parsedUrl.pathname.split('/api/fund-drawdown/')[1].replace(/\/$/, '');
      const days = parseInt(parsedUrl.searchParams.get('days')) || 365;
      const costBasis = parseFloat(parsedUrl.searchParams.get('costBasis')) || null;
      const result = await analyzeFund(fundCode, days, costBasis);
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/fund-drawdown/batch
  if (req.method === 'POST' && req.url === '/api/fund-drawdown/batch') {
    try {
      const { fundCodes, days = 365, costBasisMap = {} } = await readJsonBody(req);
      if (!fundCodes || !Array.isArray(fundCodes)) {
        sendJson(res, 400, { success: false, error: 'fundCodes 必须是数组' });
        return true;
      }
      const results = await analyzeMultipleFunds(fundCodes, days, costBasisMap);
      sendJson(res, 200, { success: true, results });
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  // ========== 基金详情 ==========

  // GET /api/fund-detail/:code
  if (req.method === 'GET' && req.url.startsWith('/api/fund-detail/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const fundCode = parsedUrl.pathname.split('/api/fund-detail/')[1].replace(/\/$/, '');

      let positionData = null;
      try {
        const rows = await db.getPositions(userId);
        const pos = rows.find(r => r.isFund && r.code === fundCode);
        if (pos) positionData = { shares: pos.shares, cost: pos.cost };
      } catch (_) {}

      const cacheKey = `fund-detail:${fundCode}`;
      await sendCachedJson(req, res, cacheKey, async () => {
        const detail = await getFundDetail(fundCode, positionData);
        return { ...detail, updatedAt: Date.now() };
      }, { ttlMs: 2 * 60 * 1000 });
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  // ========== 基金转换 ==========

  // POST /api/fund-convert
  if (req.method === 'POST' && req.url === '/api/fund-convert') {
    try {
      const { fromId, toId, fromShares, isBefore15 } = await readJsonBody(req);
      const fromPos = await db.getPosition(fromId);
      const toPos = await db.getPosition(toId);
      if (!fromPos || !toPos) { sendJson(res, 400, { error: '持仓不存在' }); return true; }
      if (fromPos.shares < fromShares) { sendJson(res, 400, { error: '份额不足' }); return true; }

      const fundData = await fetchFundNetValue(toPos.code);
      if (!fundData || !fundData.netValue) {
        sendJson(res, 400, { error: '获取基金净值失败' });
        return true;
      }

      let fromPriceDate = '';
      const fromFundData = await fetchFundNetValue(fromPos.code);
      if (fromFundData) fromPriceDate = fromFundData.priceDate;

      const now = beijingTime();
      const tradeId = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      // 转出
      const fromRemain = parseFloat((fromPos.shares - fromShares).toFixed(2));
      await db.updatePosition(fromId, { shares: fromRemain, cost: fromPos.cost });
      await db.createPendingTrade({
        id: `${tradeId}-out`, rowId: fromId, code: fromPos.code, name: fromPos.name,
        type: 'reduce', amount: 0, shares: fromShares, isBefore15, createdAt: now,
      });

      // 转入
      const fromAmount = fromShares * (fromFundData?.netValue || 0);
      const toNewShares = fromAmount / fundData.netValue;
      const toTotalShares = (toPos.shares || 0) + toNewShares;
      const toNewCost = toTotalShares > 0 ? ((toPos.shares || 0) * (toPos.cost || 0) + fromAmount) / toTotalShares : fundData.netValue;

      await db.updatePosition(toId, {
        shares: parseFloat(toTotalShares.toFixed(2)),
        cost: parseFloat(toNewCost.toFixed(4)),
      });
      await db.createPendingTrade({
        id: `${tradeId}-in`, rowId: toId, code: toPos.code, name: toPos.name,
        type: 'add', amount: Math.round(fromAmount), shares: parseFloat(toNewShares.toFixed(2)),
        isBefore15, createdAt: now,
      });

      invalidateCache('data', 'pending-trades');
      invalidateCacheByPrefix('quotes:');
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleFundRoutes, fetchFundEstimate };
