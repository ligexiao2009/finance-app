/**
 * 市场行情路由 — 指数、加密币、K线、股票详情、行情、静态文件
 */
const db = require('../db/db');
const { fetchQuotesBatch, parseQuoteResponse, decodeQtResponse } = require('../utils/quotes');
const { fetchKlineData } = require('../utils/kline');
const { getStockDetail } = require('../utils/stock-detail');
const { servePublicFile } = require('../utils/static-files');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const CRYPTO_PAIRS = [
  { pair: 'BTC_USDT', code: 'BTC', name: 'Bitcoin' },
  { pair: 'ETH_USDT', code: 'ETH', name: 'Ethereum' },
  { pair: 'OKB_USDT', code: 'OKB', name: 'OKB' },
];

async function fetchSingleGateioQuote(pair, code, name) {
  const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const ticker = Array.isArray(data) ? data[0] : data;
  return {
    code, name,
    price: parseFloat(ticker.last) || 0,
    change: parseFloat(ticker.change_percentage) || 0,
    priceDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    isFund: false,
  };
}

async function handleMarketRoutes(req, res, { userId, sendCachedJson, QUOTES_CACHE_TTL_MS, KLINE_CACHE_TTL_MS }) {
  // ========== 静态文件 ==========
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/') {
    if (servePublicFile(req, res, '/stock.html')) return true;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/mobile') {
    if (servePublicFile(req, res, '/index.html')) return true;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/')) {
    if (servePublicFile(req, res, req.url)) return true;
  }

  // ========== 指数行情 ==========
  if (req.method === 'GET' && req.url === '/api/indices') {
    try {
      await sendCachedJson(req, res, 'indices', async () => {
        const url = 'https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_hkHSTECH';
        const resp = await fetch(url);
        const text = await decodeQtResponse(resp);
        const parsed = parseQuoteResponse(text);
        const result = {};
        for (const code of ['sh000001', 'sz399001', 'sz399006', 'hkHSTECH']) {
          const parts = parsed.get(`s_${code}`);
          if (parts) {
            result[code] = {
              code, name: (parts[1] || '').replace(' ', ''),
              price: parseFloat(parts[3]) || 0, change: parseFloat(parts[5]) || 0,
            };
          }
        }
        return result;
      }, { ttlMs: 30000 });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  // ========== 加密币行情 ==========
  if (req.method === 'GET' && req.url === '/api/crypto-quotes') {
    try {
      await sendCachedJson(req, res, 'crypto-quotes', async () => {
        const result = {};
        for (const { pair, code, name } of CRYPTO_PAIRS) {
          try {
            const quote = await fetchSingleGateioQuote(pair, code, name);
            result[`${code}:crypto`] = quote;
          } catch (e) {
            console.error(`Gate.io ${pair} fetch error:`, e.message);
          }
        }
        return { quotes: result };
      }, { ttlMs: 60000 });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  // ========== 批量行情 ==========
  if (req.method === 'GET' && req.url.startsWith('/api/quotes')) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const fresh = requestUrl.searchParams.get('fresh') === '1';
      const itemsParam = requestUrl.searchParams.get('items');

      let items;
      if (itemsParam) {
        items = itemsParam.split(',').map(entry => entry.trim()).filter(Boolean)
          .map(entry => { const [code, isFundFlag] = entry.split(':'); return { code, isFund: isFundFlag === '1' }; });
      } else {
        const rows = await db.getPositions(userId);
        items = rows.map(row => ({ code: row.code, isFund: row.isFund }));
      }

      const cacheKey = 'quotes:' + items
        .map(item => `${String(item.code || '').trim()}:${item.isFund ? 1 : 0}`)
        .filter(Boolean).sort().join(',');

      await sendCachedJson(req, res, cacheKey, async () => ({
        quotes: await fetchQuotesBatch(items), updatedAt: Date.now(),
      }), { ttlMs: QUOTES_CACHE_TTL_MS, bypassCache: fresh });
    } catch (error) {
      console.error('Error getting quotes:', error);
      sendJson(res, 500, { error: 'Failed to get quotes' });
    }
    return true;
  }

  // ========== K 线代理 ==========
  if (req.method === 'GET' && req.url.startsWith('/api/kline/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathParts = parsedUrl.pathname.split('/');
      const symbol = pathParts[pathParts.length - 1];
      const scale = parseInt(parsedUrl.searchParams.get('scale')) || 240;
      const datalen = parseInt(parsedUrl.searchParams.get('datalen')) || 1023;

      if (!symbol || !['sh', 'sz', 'hk'].some(p => symbol.startsWith(p))) {
        sendJson(res, 400, { success: false, error: '无效的股票代码格式' });
        return true;
      }

      const cacheKey = `kline:${symbol}:${scale}:${datalen}`;
      await sendCachedJson(req, res, cacheKey, async () => {
        const data = await fetchKlineData(symbol, scale, datalen);
        return { success: true, data, updatedAt: Date.now() };
      }, { ttlMs: KLINE_CACHE_TTL_MS });
    } catch (error) {
      console.error('获取K线数据失败:', error.message);
      sendJson(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  // ========== 股票/ETF 详情 ==========
  if (req.method === 'GET' && req.url.startsWith('/api/stock-detail/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const code = parsedUrl.pathname.split('/api/stock-detail/')[1].replace(/\/$/, '');
      const detail = await getStockDetail(code);
      sendJson(res, 200, detail);
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleMarketRoutes };
