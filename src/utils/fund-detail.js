/**
 * 基金详情模块 — 解析东方财富 pingzhongdata 完整数据
 */
const fetch = require('node-fetch');

// 解析 JS 变量值（支持字符串、数字、数组、对象）
function extractValue(text, varName) {
  const startIdx = text.indexOf(`var ${varName}`);
  if (startIdx === -1) return null;

  const eqIdx = text.indexOf('=', startIdx);
  if (eqIdx === -1) return null;

  let valStart = eqIdx + 1;
  while (valStart < text.length && /\s/.test(text[valStart])) valStart++;

  const firstChar = text[valStart];
  if (firstChar === '"') {
    const endQuote = text.indexOf('"', valStart + 1);
    return endQuote === -1 ? '' : text.substring(valStart + 1, endQuote);
  }

  if (firstChar === '[' || firstChar === '{') {
    const closeChar = firstChar === '[' ? ']' : '}';
    let depth = 0, inString = false, escape = false;
    for (let i = valStart; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === firstChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.substring(valStart, i + 1)); }
          catch (_) { return null; }
        }
      }
    }
    return null;
  }

  if (firstChar === '-' || firstChar === '.' || /\d/.test(firstChar)) {
    let end = valStart;
    while (end < text.length && /[-\d.eE+]/.test(text[end])) end++;
    return parseFloat(text.substring(valStart, end));
  }

  const remaining = text.substring(valStart, valStart + 10);
  if (remaining.startsWith('true')) return true;
  if (remaining.startsWith('false')) return false;
  return null;
}

// 批量获取股票名称和实时涨跌幅
async function fetchStockQuotes(stockCodesNew) {
  if (!stockCodesNew || stockCodesNew.length === 0) return [];

  const symbols = stockCodesNew.map(raw => {
    const s = String(raw).trim();
    const dotIdx = s.indexOf('.');
    if (dotIdx === -1) return null;
    const market = s.substring(0, dotIdx);
    const code = s.substring(dotIdx + 1);
    return market === '1' ? `sh${code}` : `sz${code}`;
  }).filter(Boolean);

  if (symbols.length === 0) return [];

  try {
    const query = symbols.map(s => `s_${s}`).join(',');
    const url = `https://qt.gtimg.cn/q=${query}`;
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);

    const result = [];
    for (const sym of symbols) {
      const pattern = new RegExp(`v_s_${escapeRegex(sym)}="(.*?)";?`);
      const match = text.match(pattern);
      if (match) {
        const fields = match[1].split('~');
        result.push({
          code: sym.replace(/^(sh|sz)/, ''),
          name: fields[1] || '',
          price: parseFloat(fields[3]) || 0,
          change: parseFloat(fields[5]) || 0,
        });
      }
    }
    return result;
  } catch (e) {
    console.error('获取重仓股行情失败:', e.message);
    return [];
  }
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 获取基金持仓明细（含占比）
async function fetchFundHoldings(fundCode) {
  try {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=10`;
    const resp = await fetch(url, { headers: { Referer: 'https://fund.eastmoney.com' } });
    const text = await resp.text();
    // 解析 var apidata={ content:"<html>...", ... };
    const contentMatch = text.match(/content:"((?:\\.|[^"\\])*)"/);
    if (!contentMatch) return [];
    const html = contentMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '');

    // 解析表格行
    const rows = [];
    const trRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let trMatch;
    while ((trMatch = trRegex.exec(html)) !== null) {
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      const cells = [];
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
      }
      // cells: [序号, 代码, 名称, 最新价(动态), 涨跌幅(动态), 相关资讯, 占净值比例, 持股数, 持仓市值]
      if (cells.length >= 7) {
        const code = cells[1];
        const name = cells[2];
        const ratio = parseFloat(cells[6]) || 0;
        if (code && name) {
          rows.push({ code, name, ratio });
        }
      }
    }
    return rows;
  } catch (e) {
    console.error('获取基金持仓明细失败:', e.message);
    return [];
  }
}

// 格式化日期（北京时间 UTC+8）
function formatDate(ts) {
  const d = new Date(ts + 8 * 3600000);
  return d.toISOString().slice(0, 10);
}

// 合并持仓明细与实时行情
async function mergeWithStockQuotes(holdings) {
  const symbols = holdings.map(h => {
    const code = h.code;
    // 5位港股代码走 hk 前缀
    if (code.length === 5 && /^\d+$/.test(code)) return `hk${code}`;
    // 纯字母美股代码走 us 前缀
    if (/^[A-Z]+$/.test(code)) return `us${code}`;
    const first = code.charAt(0);
    return first === '6' || first === '5' ? `sh${code}` : `sz${code}`;
  });
  let quotes = {};
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
        const fields = match[1].split('~');
        quotes[sym.replace(/^(sh|sz|hk|us)/, '')] = {
          price: parseFloat(fields[3]) || 0,
          change: parseFloat(fields[5]) || 0,
        };
      }
    }
  } catch (e) {
    console.error('获取重仓股行情失败:', e.message);
  }

  return holdings.map(h => ({
    code: h.code,
    name: h.name,
    ratio: h.ratio,
    price: quotes[h.code]?.price || 0,
    change: quotes[h.code]?.change || 0,
  }));
}

// 获取基金当日行情
async function fetchFundQuote(fundCode) {
  try {
    const url = `https://qt.gtimg.cn/q=s_jj${fundCode}`;
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);
    if (!text || text.indexOf('~') === -1) return null;
    const fields = text.split('~');
    let priceDate = '';
    for (const f of fields) {
      if (f && /^\d{4}[-]?\d{2}[-]?\d{2}$/.test(f)) {
        priceDate = f.replace(/-/g, '');
        break;
      }
    }
    return {
      price: parseFloat(fields[3]) || 0,
      change: parseFloat(fields[5]) || 0,
      priceDate,
    };
  } catch (e) {
    return null;
  }
}

// 获取基金详情
async function getFundDetail(fundCode, positionData = null) {
  // 并行：pingzhongdata + 持仓明细 + 当日行情（减少串行等待）
  const pingzhongUrl = `http://fund.eastmoney.com/pingzhongdata/${fundCode}.js`;
  const [pingzhongResp, holdingDetails, fundQuote] = await Promise.all([
    fetch(pingzhongUrl),
    fetchFundHoldings(fundCode),
    fetchFundQuote(fundCode),
  ]);

  if (!pingzhongResp.ok) throw new Error(`HTTP ${pingzhongResp.status}`);
  const text = await pingzhongResp.text();

  // 基本信息
  const fundName = extractValue(text, 'fS_name') || '';
  const rate = parseFloat(extractValue(text, 'fund_Rate')) || 0;
  const sourceRate = parseFloat(extractValue(text, 'fund_sourceRate')) || 0;
  const minSubscription = parseFloat(extractValue(text, 'fund_minsg')) || 0;

  // 阶段收益
  const returns = {
    oneMonth: parseFloat(extractValue(text, 'syl_1y')) || 0,
    threeMonth: parseFloat(extractValue(text, 'syl_3y')) || 0,
    sixMonth: parseFloat(extractValue(text, 'syl_6y')) || 0,
    oneYear: parseFloat(extractValue(text, 'syl_1n')) || 0,
  };

  // 净值走势
  const rawNavTrend = extractValue(text, 'Data_netWorthTrend') || [];
  const navTrend = rawNavTrend.map(item => ({
    date: formatDate(item.x),
    unitNav: item.y,
    equityReturn: item.equityReturn || 0,
  }));

  // 累计净值
  const rawAccumNav = extractValue(text, 'Data_ACWorthTrend') || [];
  const accumNavMap = {};
  rawAccumNav.forEach(item => {
    accumNavMap[formatDate(item[0])] = item[1];
  });

  // 仓位变化
  const rawPositionHistory = extractValue(text, 'Data_fundSharesPositions') || [];
  const positionHistory = rawPositionHistory.map(item => ({
    date: formatDate(item[0]),
    ratio: item[1],
  }));

  // 前十大重仓股（含占比）— 并行获取实时行情
  const topHoldings = holdingDetails.length > 0
    ? await mergeWithStockQuotes(holdingDetails)
    : await fetchStockQuotes(extractValue(text, 'stockCodesNew') || []);

  // 资产配置
  const assetAllocation = extractValue(text, 'Data_assetAllocation');

  // 持有人结构
  const holderStructure = extractValue(text, 'Data_holderStructure');

  // 基金经理
  const rawManager = extractValue(text, 'Data_currentFundManager');
  const fundManager = rawManager && rawManager.length > 0 ? {
    name: rawManager[0].name || '',
    star: rawManager[0].star || 0,
    workTime: rawManager[0].workTime || '',
    fundSize: rawManager[0].fundSize || '',
  } : null;

  // 波动率
  const fluctuationScale = extractValue(text, 'Data_fluctuationScale');

  // 用户持仓数据
  let myPosition = null;
  if (positionData && positionData.shares > 0) {
    const shares = positionData.shares;
    const cost = positionData.cost;
    // 优先用实时净值，比 pingzhongdata 的 navTrend 更新
    const latestNav = (fundQuote && fundQuote.price > 0) ? fundQuote.price : (navTrend.length > 0 ? navTrend[navTrend.length - 1].unitNav : 0);
    const marketValue = shares * latestNav;
    const profitLoss = shares * (latestNav - cost);
    const todayChange = fundQuote ? fundQuote.change : 0;
    const priceDate = fundQuote ? fundQuote.priceDate : '';
    const prevMkt = (1 + todayChange / 100) !== 0 ? marketValue / (1 + todayChange / 100) : marketValue;
    const todayProfit = prevMkt * (todayChange / 100);
    myPosition = {
      shares,
      cost,
      latestNav,
      marketValue: Math.round(marketValue),
      profitLoss: Math.round(profitLoss),
      profitLossPercent: cost > 0 ? ((latestNav - cost) / cost * 100) : 0,
      todayChange,
      todayProfit: Math.round(todayProfit),
      priceDate,
    };
  }

  return {
    success: true,
    fundCode,
    fundName,
    basicInfo: { rate, sourceRate, minSubscription },
    returns,
    navTrend,
    accumNavMap,
    positionHistory,
    topHoldings,
    assetAllocation,
    holderStructure,
    fundManager,
    fluctuationScale,
    myPosition,
  };
}

module.exports = { getFundDetail };
