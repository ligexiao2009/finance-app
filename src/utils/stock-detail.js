/**
 * 股票/ETF 详情模块 — 分时图 + K线 + 实时行情
 */
const fetch = require('node-fetch');

const { getFundDetail } = require('./fund-detail');

// 判断是否 ETF（代码以 5 开头且不是基金）
function isETF(code) { return code.startsWith('5'); }

// 构建行情 symbol
function buildSymbol(code) {
  if (code.length === 5) return `hk${code}`;
  return /^[569]/.test(code) ? `sh${code}` : `sz${code}`;
}

// 获取分时图分钟线
async function fetchMinuteData(symbol) {
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.code !== 0 || !json.data) return [];
    const stockData = json.data[symbol];
    if (!stockData?.data?.data) return [];
    return stockData.data.data.map(line => {
      const parts = line.split(' ');
      return {
        time: parts[0],
        price: parseFloat(parts[1]),
        volume: parseFloat(parts[2]) || 0,
        turnover: parseFloat(parts[3]) || 0,
      };
    });
  } catch (e) {
    console.error('获取分时图失败:', e.message);
    return [];
  }
}

// 获取 K 线数据（前复权）
async function fetchKline(symbol) {
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_day&param=${symbol},day,,,365,qfq`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    const jsonText = text.includes('=') ? text.slice(text.indexOf('=') + 1).replace(/;$/, '').trim() : text;
    const payload = JSON.parse(jsonText);
    const stockData = payload?.data?.[symbol];
    const list = stockData ? (stockData.qfqday || stockData.day || []) : [];
    return list.map(item => {
      if (Array.isArray(item) && item.length >= 5) {
        return { day: String(item[0]), open: String(item[1]), close: String(item[2]), high: String(item[3]), low: String(item[4]), volume: String(item[5] || '0') };
      }
      return null;
    }).filter(Boolean);
  } catch (e) {
    console.error('获取K线失败:', e.message);
    return [];
  }
}

// 批量获取实时行情
async function fetchQuotes(symbols) {
  const result = {};
  if (!symbols.length) return result;
  try {
    const query = symbols.map(s => `s_${s}`).join(',');
    const url = `https://qt.gtimg.cn/q=${query}`;
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);
    for (const sym of symbols) {
      const pattern = new RegExp(`v_s_${escapeRegex(sym)}="(.*?)";?`);
      const match = text.match(pattern);
      if (match) {
        const f = match[1].split('~');
        const code = sym.replace(/^(sh|sz|hk)/, '');
        result[code] = {
          code,
          name: f[1] || '',
          price: parseFloat(f[3]) || 0,
          change: parseFloat(f[5]) || 0,
          volume: parseFloat(f[6]) || 0,
          turnover: parseFloat(f[7]) || 0,
          marketCap: parseFloat(f[9]) || 0,
          high: parseFloat(f[9]) || 0,
          isHK: sym.startsWith('hk'),
        };
      }
    }
  } catch (e) {
    console.error('获取行情失败:', e.message);
  }
  return result;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 主入口
async function getStockDetail(code) {
  const symbol = buildSymbol(code);
  const [minuteData, klineData, quotes] = await Promise.all([
    fetchMinuteData(symbol),
    fetchKline(symbol),
    fetchQuotes([symbol]),
  ]);

  const quote = quotes[code] || { code, name: '', price: 0, change: 0, volume: 0, turnover: 0, marketCap: 0, isHK: code.length === 5 };

  // ETF 持仓
  let topHoldings = null;
  if (isETF(code)) {
    try {
      const fd = await getFundDetail(code);
      topHoldings = fd.topHoldings;
    } catch (_) {}
  }

  // 昨收
  let prevClose = 0;
  if (quote.price > 0 && quote.change !== 0) {
    prevClose = quote.price / (1 + quote.change / 100);
  }

  // 最高最低（从K线最后一天取）
  const lastK = klineData.length > 0 ? klineData[klineData.length - 1] : null;

  return {
    success: true,
    code,
    symbol,
    name: quote.name,
    isHK: quote.isHK,
    quote: {
      price: quote.price,
      change: quote.change,
      prevClose: Math.round(prevClose * 1000) / 1000,
      volume: quote.volume,
      turnover: quote.turnover,
      marketCap: quote.marketCap,
      high: parseFloat(lastK?.high) || 0,
      low: parseFloat(lastK?.low) || 0,
    },
    minuteData,
    klineData,
    topHoldings,
  };
}

module.exports = { getStockDetail };
