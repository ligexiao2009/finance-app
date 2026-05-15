/**
 * K 线数据获取 — 新浪 + 腾讯港股
 */
const { decodeQtResponse } = require('./quotes');

function mapKlineScaleToPeriod(scale) {
  if (scale >= 7200) return 'month';
  if (scale >= 1200) return 'week';
  return 'day';
}

function normalizeTencentKlineItem(item) {
  if (!Array.isArray(item) || item.length < 5) return null;
  return {
    day: item[0],
    open: item[1],
    close: item[2],
    high: item[3],
    low: item[4],
    volume: item[5] || '0',
  };
}

/** 腾讯港股 K 线（前复权） */
async function fetchTencentHkKlineData(symbol, scale = 240, datalen = 1023) {
  const period = mapKlineScaleToPeriod(scale);
  const variableName = `kline_${period}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?_var=${variableName}&param=${symbol},${period},,,${datalen},qfq`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  const jsonText = (text.includes('=') ? text.slice(text.indexOf('=') + 1) : text)
    .trim()
    .replace(/;$/, '');
  const payload = JSON.parse(jsonText);
  const stockData = payload?.data?.[symbol];
  if (!stockData) throw new Error('腾讯港股K线返回为空');

  const list = stockData[`qfq${period}`] || stockData[period] || [];
  return list.map(normalizeTencentKlineItem).filter(Boolean);
}

/** 获取 K 线数据（港股走腾讯，A股走新浪） */
async function fetchKlineData(symbol, scale = 240, datalen = 1023) {
  if (String(symbol || '').startsWith('hk')) {
    return await fetchTencentHkKlineData(symbol, scale, datalen);
  }

  const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${datalen}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await decodeQtResponse(response);
  return JSON.parse(text);
}

module.exports = { fetchKlineData, fetchTencentHkKlineData, mapKlineScaleToPeriod, normalizeTencentKlineItem };
