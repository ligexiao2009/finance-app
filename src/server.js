// 加载环境变量
require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const cron = require('node-cron');
const fetch = require('node-fetch');
const db = require('./db/db');
const { handleDailyProfitRoutes } = require('./routes/daily-profit');
const { handleAlertRulesRoutes, checkPriceAlerts, invalidateAlertCache } = require('./routes/alert-rules');
const { servePublicFile } = require('./utils/static-files');
const { analyzeFund, analyzeMultipleFunds } = require('./utils/fund-drawdown');

const PORT = 3000;
const DATA_CACHE_TTL_MS = Number(process.env.DATA_CACHE_TTL_MS || 30 * 60 * 1000);
const QUOTES_CACHE_TTL_MS = Number(process.env.QUOTES_CACHE_TTL_MS || 30 * 1000);
const QUOTES_BATCH_SIZE = Number(process.env.QUOTES_BATCH_SIZE || 60);
const KLINE_CACHE_TTL_MS = Number(process.env.KLINE_CACHE_TTL_MS || 5 * 60 * 1000);
const responseCache = new Map();
let EDIT_UNLOCK_PASSWORD_CACHE = undefined;

function invalidateCache(...keys) {
  keys.forEach(key => responseCache.delete(key));
}

function invalidateCacheByPrefix(prefix) {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
}

// 格式化金额，添加千位分隔符
function formatMoney(amount) {
  if (typeof amount !== 'number') return '0.00';
  // 保留两位小数，添加千位分隔符
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function getCachedJsonResponse(cacheKey, producer, options = {}) {
  const { ttlMs = DATA_CACHE_TTL_MS, bypassCache = false } = options;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (!bypassCache && cached && cached.expiresAt > now) {
    return cached;
  }

  const data = await producer();
  const payload = JSON.stringify(data);
  const etag = `"${crypto.createHash('sha1').update(payload).digest('hex')}"`;
  const nextCache = {
    expiresAt: now + ttlMs,
    etag,
    payload,
  };

  responseCache.set(cacheKey, nextCache);
  return nextCache;
}

async function sendCachedJson(req, res, cacheKey, producer, options = {}) {
  const cached = await getCachedJsonResponse(cacheKey, producer, options);
  if (req.headers['if-none-match'] === cached.etag) {
    res.writeHead(304, {
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'ETag': cached.etag,
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'ETag': cached.etag,
  });
  res.end(cached.payload);
}

function buildQuoteSymbol(code, isFund) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return '';
  if (normalizedCode.length === 5) return `hk${normalizedCode}`;
  if (isFund) return `jj${normalizedCode}`;
  return /^[569]/.test(normalizedCode) ? `sh${normalizedCode}` : `sz${normalizedCode}`;
}

function parseFundPriceDate(parts) {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && /^\d{4}[-]?\d{2}[-]?\d{2}$/.test(parts[i])) {
      return parts[i].replace(/-/g, '');
    }
  }
  return '';
}

function parseQuoteResponse(text) {
  const result = new Map();
  const lines = String(text || '').split('\n');

  for (const line of lines) {
    const match = line.match(/^v_(.+?)="(.*)";?$/);
    if (!match) continue;
    const variableName = match[1];
    const raw = match[2];
    if (!raw || raw.indexOf('~') === -1) continue;
    result.set(variableName, raw.split('~'));
  }

  return result;
}

async function decodeQtResponse(response) {
  const buffer = await response.arrayBuffer();
  return new TextDecoder('gb18030').decode(buffer);
}

async function fetchQuotesBatch(items) {
  const normalizedItems = [];
  const seen = new Set();

  for (const item of items || []) {
    const code = String(item.code || '').trim();
    if (!code) continue;
    const isFund = item.isFund === true || item.isFund === 'true' || item.isFund === 1 || item.isFund === '1';
    const cacheKey = `${code}:${isFund ? 1 : 0}`;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    normalizedItems.push({
      code,
      isFund,
      symbol: buildQuoteSymbol(code, isFund),
      key: cacheKey,
    });
  }

  const quotes = {};
  for (let i = 0; i < normalizedItems.length; i += QUOTES_BATCH_SIZE) {
    const batch = normalizedItems.slice(i, i + QUOTES_BATCH_SIZE);
    if (!batch.length) continue;

    const query = batch.map(item => `s_${item.symbol}`).join(',');

    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${query}`);
      const text = await decodeQtResponse(response);
      const parsed = parseQuoteResponse(text);

      batch.forEach(item => {
        const parts = parsed.get(`s_${item.symbol}`);
        if (!parts) return;
        quotes[item.key] = {
          code: item.code,
          isFund: item.isFund,
          name: item.isFund ? (parts[1] ? parts[1].replace('[基金] ', '') : '') : (parts[1] || ''),
          price: parseFloat(parts[3]) || 0,
          change: parseFloat(parts[5]) || 0,
          priceDate: item.isFund ? parseFundPriceDate(parts) : '',
        };
      });
    } catch (error) {
      console.error('批量获取行情失败:', error.message);
    }
  }

  return quotes;
}

function mapKlineScaleToPeriod(scale) {
  if (scale >= 7200) return 'month';
  if (scale >= 1200) return 'week';
  return 'day';
}

function normalizeTencentKlineItem(item) {
  if (!Array.isArray(item) || item.length < 5) {
    return null;
  }

  return {
    day: item[0],
    open: item[1],
    close: item[2],
    high: item[3],
    low: item[4],
    volume: item[5] || '0',
  };
}

async function fetchTencentHkKlineData(symbol, scale = 240, datalen = 1023) {
  const period = mapKlineScaleToPeriod(scale);
  const variableName = `kline_${period}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?_var=${variableName}&param=${symbol},${period},,,${datalen},qfq`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const jsonText = (text.includes('=') ? text.slice(text.indexOf('=') + 1) : text)
    .trim()
    .replace(/;$/, '');
  const payload = JSON.parse(jsonText);
  const stockData = payload?.data?.[symbol];
  if (!stockData) {
    throw new Error('腾讯港股K线返回为空');
  }

  const list = stockData[`qfq${period}`] || stockData[period] || [];
  return list.map(normalizeTencentKlineItem).filter(Boolean);
}

// ==================== 获取K线数据 ====================
async function fetchKlineData(symbol, scale = 240, datalen = 1023) {
  try {
    if (String(symbol || '').startsWith('hk')) {
      return await fetchTencentHkKlineData(symbol, scale, datalen);
    }

    const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${datalen}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await decodeQtResponse(response);
    // 新浪返回的是JSON格式字符串，直接解析
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error('获取K线数据失败:', error.message);
    throw error;
  }
}

// ==================== 获取基金实时估算 ====================
async function fetchFundEstimate(fundCode) {
  try {
    const url = `http://fundgz.1234567.com.cn/js/${fundCode}.js`;
    const response = await fetch(url);
    const text = await response.text();
    // 解析JSONP: jsonpgz({"name":"xxx",...});
    const jsonMatch = text.match(/jsonpgz\((\{.*?\})\s*\);?/s);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      return {
        success: true,
        fundCode: data.fundcode,
        fundName: data.name,
        estimateValue: parseFloat(data.gsz) || 0,     // 估算净值
        estimateChange: parseFloat(data.gszzl) || 0,   // 估算涨跌(%)
        estimateTime: data.gztime || '',                 // 估算时间
      };
    }
    return { success: false, error: '解析失败' };
  } catch (error) {
    console.error(`获取基金 ${fundCode} 实时估算失败:`, error.message);
    return { success: false, error: error.message };
  }
}

// ==================== 配置部分 ====================
// Server酱配置 - 优先从环境变量或数据库配置读取
let SERVERCHAN_KEY = '';

// 初始化配置文件
async function initConfig() {
  try {
    // 从数据库获取配置
    const configs = await db.getAllConfigs();

    // 优先使用环境变量，如果不存在则使用数据库中的配置
    const serverchanKeyFromEnv = process.env.SERVERCHAN_KEY;
    const alertTimeFromEnv = process.env.ALERT_TIME;

    // 设置默认配置（如果不存在）
    if (!configs.serverchanKey) {
      const defaultValue = serverchanKeyFromEnv || '';
      await db.setConfig('serverchanKey', defaultValue);
      if (!defaultValue) {
        console.log('Server酱 Key 未设置，请在配置中填写');
      }
    }
    if (!configs.alertTime) {
      const defaultValue = alertTimeFromEnv || '0 22 * * *';
      await db.setConfig('alertTime', defaultValue);
    }
    // 处理编辑解锁密码
    let unlockPasswordValue;
    if (!configs.editUnlockPassword) {
      unlockPasswordValue = process.env.EDIT_UNLOCK_PASSWORD || '8957';
      await db.setConfig('editUnlockPassword', unlockPasswordValue);
    } else {
      unlockPasswordValue = process.env.EDIT_UNLOCK_PASSWORD || configs.editUnlockPassword || '8957';
    }

    // 更新内存中的配置（优先使用环境变量，其次使用数据库配置）
    SERVERCHAN_KEY = serverchanKeyFromEnv || configs.serverchanKey || '';
    // 设置解锁密码缓存
    EDIT_UNLOCK_PASSWORD_CACHE = unlockPasswordValue;
    if (!SERVERCHAN_KEY) {
      console.log('Server酱 Key 未设置，无法发送微信通知');
    }
  } catch (error) {
    console.error('初始化配置失败:', error);
    // 设置默认值
    SERVERCHAN_KEY = '';
    EDIT_UNLOCK_PASSWORD_CACHE = process.env.EDIT_UNLOCK_PASSWORD || '8957';
  }
}

async function getEditUnlockPassword() {
  // 先从缓存获取
  if (EDIT_UNLOCK_PASSWORD_CACHE !== undefined) {
    return EDIT_UNLOCK_PASSWORD_CACHE;
  }
  // 缓存为空则从数据库获取并设置缓存
  const password = process.env.EDIT_UNLOCK_PASSWORD || await db.getConfig('editUnlockPassword') || '8957';
  EDIT_UNLOCK_PASSWORD_CACHE = password;
  return password;
}




// 初始化配置和启动服务器
async function startServer() {
  try {
    // 初始化数据库连接
    await db.initDatabase();
    console.log('✅ 数据库连接初始化完成');

    // 初始化配置
    await initConfig();

    // 设置定时任务
    await setupCronJob();

    // 启动HTTP服务器
    server.listen(PORT, () => {
      console.log(`\n服务器运行在 http://localhost:${PORT}`);
      console.log('📊 数据存储: PostgreSQL');
      console.log('\n可用接口:');
      console.log('  GET  /api/data                    - 获取所有数据');
      console.log('  POST /api/save-row                - 保存单行数据');
      console.log('  POST /api/delete-row              - 删除单行数据');
      console.log('  GET  /api/trigger-check           - 手动触发基金检查 (测试)');
      console.log('  GET  /api/trigger-profit          - 手动触发每日收益计算 (测试)');
      console.log('  GET  /api/trigger-confirm         - 手动触发自动确认交易 (测试)');
      console.log('  POST /api/save-daily-profit       - 保存今日收益');
      console.log('  GET  /api/daily-profit            - 获取每日收益历史');
      console.log('  --- 待确认交易 ---');
      console.log('  GET  /api/pending-trades          - 获取待确认交易列表');
      console.log('  POST /api/pending-trades          - 新增待确认交易');
      console.log('  POST /api/pending-trades/delete   - 删除待确认交易');
      console.log('  POST /api/save-pending-trades     - 批量保存待确认交易列表');
      console.log('  --- 交易历史 ---');
      console.log('  GET  /api/trade-history           - 获取全部交易历史');
      console.log('  GET  /api/trade-history/:rowId    - 获取某持仓的交易历史');
      console.log('  POST /api/trade-history           - 新增交易历史记录');
      console.log('  POST /api/save-trade-history      - 批量保存交易历史');
      console.log('\n配置说明:');
      console.log('  1. Server酱获取地址: https://sct.ftqq.com/');
      console.log('  2. 在前端页面为基金设置涨跌提醒值 (%)');
      console.log('  3. 每日收益定时任务: 周一到周五 23:00 自动计算并保存');
      console.log('  4. 自动确认交易定时任务: 每天 09:00 自动确认昨天15点前的交易');
      console.log('  5. 配置存储在 PostgreSQL configs 表中');
      console.log('');
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();


// ==================== 股票/基金价格获取 ====================
async function fetchStockPrice(code) {
  try {
    // 确定股票市场前缀
    let sym;
    if (code.length === 5) {
      // 港股
      sym = 'hk' + code;
    } else if (/^[569]/.test(code)) {
      // 上海
      sym = 'sh' + code;
    } else {
      // 深圳
      sym = 'sz' + code;
    }
    const url = `https://qt.gtimg.cn/q=s_${sym}`;
    const response = await fetch(url);
    const text = await decodeQtResponse(response);

    if (text && text.indexOf('~') > -1) {
      const parts = text.split('~');
      return {
        name: parts[1] || '',
        price: parseFloat(parts[3]) || 0,
        change: parseFloat(parts[5]) || 0
      };
    }
  } catch (e) {
    console.error('获取股票价格失败:', code, e.message);
  }
  return null;
}

async function fetchFundNetValue(code) {
  try {
    // 使用腾讯财经接口获取基金数据
    const sym = 'jj' + code;
    const url = `https://qt.gtimg.cn/q=s_${sym}`;
    const response = await fetch(url);
    const text = await decodeQtResponse(response);

    if (text && text.indexOf('~') > -1) {
      const parts = text.split('~');
      // 搜索所有字段查找日期格式 (YYYYMMDD 或 YYYY-MM-DD)
      let priceDate = '';
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] && /^\d{4}[-]?\d{2}[-]?\d{2}$/.test(parts[i])) {
          priceDate = parts[i].replace(/-/g, '');
          break;
        }
      }
      return {
        name: parts[1] ? parts[1].replace('[基金] ', '') : '',
        netValue: parseFloat(parts[3]) || 0,
        change: parseFloat(parts[5]) || 0,
        priceDate: priceDate
      };
    }
  } catch (e) {
    console.error('获取基金净值失败:', code, e.message);
  }
  return null;
}

// ==================== Server酱 微信通知 ====================
async function sendWechatMessage(title, content) {
  if (!SERVERCHAN_KEY) {
    console.log('未配置 Server酱 Key，跳过发送');
    return false;
  }

  try {
    const url = `https://sctapi.ftqq.com/${SERVERCHAN_KEY}.send`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(content)}`
    });
    const result = await response.json();
    if (result.code === 0) {
      console.log('微信通知发送成功');
      return true;
    } else {
      console.log('微信通知发送失败:', result);
      return false;
    }
  } catch (e) {
    console.error('发送微信通知失败:', e.message);
    return false;
  }
}

// 计算基金提醒指标
function calculateFundAlertMetrics(fund, quoteData) {
  const netValue = quoteData.price;
  const todayChange = quoteData.change;
  const fundName = quoteData.name || fund.name || fund.code;

  if (!(netValue > 0 && fund.cost > 0 && fund.shares > 0)) {
    return null;
  }

  const changePercent = ((netValue - fund.cost) / fund.cost) * 100;
  const positionValue = fund.shares * netValue;
  const profitLoss = fund.shares * (netValue - fund.cost);
  const todayProfit = fund.shares * netValue * (todayChange / 100);

  return {
    name: fundName,
    code: fund.code,
    cost: fund.cost,
    netValue: netValue,
    changePercent: changePercent,
    alert: fund.alert,
    shares: fund.shares,
    positionValue: positionValue,
    profitLoss: profitLoss,
    todayChange: todayChange,
    todayProfit: todayProfit
  };
}

// ==================== 检查基金并发送提醒 ====================
async function checkFundsAndAlert() {
  console.log('\n========== 开始检查基金涨跌提醒 ==========');

  try {
    const rows = await db.getPositions();
    const funds = rows.filter(r => r.isFund && r.alert && r.alert > 0 && r.code);
    console.log(`找到 ${funds.length} 只设置了提醒的基金`);

    if (funds.length === 0) {
      console.log('没有需要检查的基金');
      console.log('========== 检查完成 ==========\n');
      return;
    }

    const alerts = [];

    // 批量获取基金数据
    const items = funds.map(fund => ({ code: fund.code, isFund: true }));
    const quotes = await fetchQuotesBatch(items);
    console.log(`批量获取 ${funds.length} 只基金数据完成`);

    for (const fund of funds) {
      console.log(`检查基金: ${fund.name || fund.code}`);
      const quoteKey = `${fund.code}:1`;
      const quoteData = quotes[quoteKey];

      if (!quoteData) {
        console.log(`  数据获取失败，跳过`);
        continue;
      }

      const metrics = calculateFundAlertMetrics(fund, quoteData);
      if (!metrics) {
        console.log(`  数据无效，跳过`);
        continue;
      }

      console.log(`  成本: ${metrics.cost}, 最新净值: ${metrics.netValue}, 涨跌幅: ${metrics.changePercent.toFixed(2)}%, 提醒阈值: ${metrics.alert}%`);
      console.log(`  持仓金额: ${metrics.positionValue.toFixed(2)}, 持仓盈亏: ${metrics.profitLoss.toFixed(2)}`);
      console.log(`  今日涨幅: ${metrics.todayChange.toFixed(2)}%, 今日收益: ${metrics.todayProfit.toFixed(2)}`);

      if (Math.abs(metrics.changePercent) >= metrics.alert) {
        alerts.push(metrics);
      }
    }

    if (alerts.length > 0) {
      console.log(`\n有 ${alerts.length} 只基金达到提醒阈值`);

      // 计算今日总收益、总持仓金额和总持仓盈亏
      const totalTodayProfit = alerts.reduce((sum, a) => sum + a.todayProfit, 0);
      const totalPositionValue = alerts.reduce((sum, a) => sum + a.positionValue, 0);
      const totalProfitLoss = alerts.reduce((sum, a) => sum + a.profitLoss, 0);
      const todayReturnRate = totalPositionValue > 0 ? (totalTodayProfit / totalPositionValue) * 100 : 0;

      console.log(`今日总收益: ¥${totalTodayProfit.toFixed(2)}`);
      console.log(`总持仓金额: ¥${totalPositionValue.toFixed(2)}`);
      console.log(`总持仓盈亏: ¥${totalProfitLoss.toFixed(2)}`);
      console.log(`今日收益率: ${todayReturnRate >= 0 ? '+' : ''}${todayReturnRate.toFixed(2)}%`);

      let title = `【基金提醒】持仓¥${formatMoney(totalPositionValue)} 收益${todayReturnRate >= 0 ? '+' : ''}${todayReturnRate.toFixed(2)}%`;

      let content = `## 基金涨跌提醒\n\n`;
      content += `**汇总统计:**\n`;
      content += `- 总持仓金额: ¥${formatMoney(totalPositionValue)}\n`;
      content += `- 总持仓盈亏: ¥${formatMoney(totalProfitLoss)}\n`;
      content += `- 今日总收益: ¥${formatMoney(totalTodayProfit)}\n`;
      content += `- 今日收益率: ${todayReturnRate >= 0 ? '+' : ''}${todayReturnRate.toFixed(2)}%\n\n`;

      // 按涨跌幅倒序排序（从大到小）
      alerts.sort((a, b) => b.changePercent - a.changePercent);

      alerts.forEach((a) => {
        const isUp = a.changePercent >= 0;
        const emoji = isUp ? '涨' : '跌';
        title += `${a.name} ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}% `;
        content += `### ${emoji} ${a.name} (${a.code})\n\n`;
        content += `- 涨跌幅: ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}%\n`;
        content += `- 持仓金额: ¥${formatMoney(a.positionValue)}\n`;
        content += `- 持仓盈亏: ¥${formatMoney(a.profitLoss)}\n`;
        content += `- 今日涨幅: ${a.todayChange >= 0 ? '+' : ''}${a.todayChange.toFixed(2)}%\n`;
        content += `- 今日收益: ¥${formatMoney(a.todayProfit)}\n`;
        // content += `- 提醒阈值: ${a.alert}%\n\n`;
      });

      await sendWechatMessage(title.slice(0, 100), content);
    } else {
      console.log('没有基金达到提醒阈值');
    }
  } catch (error) {
    console.error('基金检查过程中发生错误:', error.message);
    console.error('错误堆栈:', error.stack);

    // 可以在这里发送错误通知
    if (SERVERCHAN_KEY) {
      const errorTitle = '【基金检查错误】';
      const errorContent = `## 基金检查发生错误\n\n错误信息: ${error.message}\n\n请检查服务器日志。`;
      try {
        await sendWechatMessage(errorTitle, errorContent);
      } catch (sendError) {
        console.error('发送错误通知失败:', sendError.message);
      }
    }
  }

  console.log('========== 检查完成 ==========\n');
}

// ==================== 计算并保存每日收益 ====================
async function calculateAndSaveDailyProfit() {
  console.log('\n========== 开始计算每日收益 ==========');
  const rows = await db.getPositions();
  const now = new Date();
  const dateStr = now.getFullYear().toString() + '-' +
    (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
    now.getDate().toString().padStart(2, '0');

  // 检查今天是否已经有数据
  const existingRecord = await db.getDailyProfitByDate(dateStr);
  if (existingRecord) {
    console.log(`今日(${dateStr})收益数据已存在，跳过计算`);
    console.log('========== 计算完成 ==========\n');
    return;
  }

  let stockToday = 0, fundToday = 0;
  const stocks = rows.filter(r => !r.isFund && r.code);
  const funds = rows.filter(r => r.isFund && r.code);

  console.log(`处理 ${stocks.length} 只股票，${funds.length} 只基金`);

  // 计算股票收益
  for (const stock of stocks) {
    console.log(`获取股票: ${stock.name || stock.code}`);
    const stockData = await fetchStockPrice(stock.code);
    if (stockData && stockData.price > 0 && stock.shares > 0) {
      const mkt = stock.shares * stockData.price;
      const today = mkt * (stockData.change / 100);
      stockToday += today;
      console.log(`  ${stock.name || stock.code}: 市值 ¥${mkt.toFixed(2)}, 涨跌 ${stockData.change}%, 今日收益 ¥${today.toFixed(2)}`);
    }
  }

  // 计算基金收益
  const todayStr = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.getFullYear().toString() +
    (yesterday.getMonth() + 1).toString().padStart(2, '0') +
    yesterday.getDate().toString().padStart(2, '0');
  const hour = now.getHours();
  const minute = now.getMinutes();
  const isTradingMorning = (hour > 9 || (hour === 9 && minute >= 30)) && hour < 15;

  for (const fund of funds) {
    console.log(`获取基金: ${fund.name || fund.code}`);
    const fundData = await fetchFundNetValue(fund.code);
    if (fundData && fundData.netValue > 0 && fund.shares > 0) {
      // 处理基金净值日期
      let adjustedPriceDate = fundData.priceDate;

      // QDII 境外基金特殊处理：日期 +1 天
      if (fund.isOverseas && adjustedPriceDate && adjustedPriceDate.length === 8) {
        const year = parseInt(adjustedPriceDate.substr(0, 4));
        const month = parseInt(adjustedPriceDate.substr(4, 2)) - 1;
        const day = parseInt(adjustedPriceDate.substr(6, 2));
        const date = new Date(year, month, day);
        date.setDate(date.getDate() + 1);
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        adjustedPriceDate = `${y}${m}${d}`;
        console.log(`  境外基金，净值日期从 ${fundData.priceDate} 调整为 ${adjustedPriceDate}`);
      }

      // 判断净值是否已更新
      let isTodayUpdated = false;
      if (adjustedPriceDate === todayStr) {
        isTodayUpdated = true;
      } else if (adjustedPriceDate === yesterdayStr) {
        if (isTradingMorning) {
          isTodayUpdated = false;
        } else {
          isTodayUpdated = hour < 15;
        }
      }

      if (isTodayUpdated) {
        const mkt = fund.shares * fundData.netValue;
        const today = mkt * (fundData.change / 100);
        fundToday += today;
        console.log(`  ${fund.name || fund.code}: 市值 ¥${mkt.toFixed(2)}, 涨跌 ${fundData.change}%, 今日收益 ¥${today.toFixed(2)}`);
      } else {
        console.log(`  ${fund.name || fund.code}: 净值未更新，跳过`);
      }
    }
  }

  // 保存收益数据
  const profitRecord = {
    date: dateStr,
    stockToday: Math.round(stockToday),
    fundToday: Math.round(fundToday),
    totalToday: Math.round(stockToday + fundToday)
  };

  await db.createDailyProfit(profitRecord);

  console.log(`\n收益计算完成！`);
  console.log(`股票今日收益: ¥${profitRecord.stockToday.toLocaleString()}`);
  console.log(`基金今日收益: ¥${profitRecord.fundToday.toLocaleString()}`);
  console.log(`总今日收益: ¥${profitRecord.totalToday.toLocaleString()}`);
  console.log('========== 计算完成 ==========\n');
}

// ==================== 自动确认待确认交易 ====================
async function autoConfirmPendingTrades() {
  console.log('\n========== 开始自动确认待确认交易 ==========');
  const pendingTrades = await db.getPendingTrades();

  if (pendingTrades.length === 0) {
    console.log('没有待确认交易');
    console.log('========== 确认完成 ==========\n');
    return;
  }

  // 获取当前北京时间
  const now = new Date();
  const nowBeijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayStr = nowBeijing.toISOString().slice(0, 10); // YYYY-MM-DD

  // 计算昨天的日期（北京时间）
  const yesterdayBeijing = new Date(nowBeijing);
  yesterdayBeijing.setDate(yesterdayBeijing.getDate() - 1);
  const yesterdayStr = yesterdayBeijing.toISOString().slice(0, 10);

  console.log(`今天(北京): ${todayStr}, 昨天(北京): ${yesterdayStr}`);
  console.log(`待确认交易数量: ${pendingTrades.length}`);

  let confirmedCount = 0;
  const remainingTrades = [];

  for (const trade of pendingTrades) {
    // 将 UTC 时间转换为北京时间
    const tradeDateUTC = new Date(trade.createdAt);
    const tradeDateBeijing = new Date(tradeDateUTC.getTime() + 8 * 60 * 60 * 1000);
    const tradeDateStr = tradeDateBeijing.toISOString().slice(0, 10);
    const tradeHour = tradeDateBeijing.getUTCHours(); // 因为已经加了8小时，用getUTCHours获取北京时间的小时

    console.log(`\n处理交易: ${trade.name} (${trade.code})`);
    console.log(`  交易时间(北京): ${tradeDateStr} ${tradeHour.toString().padStart(2, '0')}:${tradeDateBeijing.getUTCMinutes().toString().padStart(2, '0')}`);
    console.log(`  15点前: ${trade.isBefore_15 ? '是' : '否'}`);

    // 判断是否应该自动确认：
    // 1. 如果是昨天15点前的交易，今天确认
    // 2. 如果是昨天15点后的交易，明天确认（暂时不处理）
    let shouldConfirm = false;

    if (tradeDateStr === yesterdayStr && trade.isBefore_15) {
      shouldConfirm = true;
      console.log('  → 符合条件：昨天15点前的交易，今天确认');
    } else if (tradeDateStr === yesterdayStr && !trade.isBefore_15) {
      console.log('  → 跳过：昨天15点后的交易，明天确认');
    } else if (tradeDateStr < yesterdayStr) {
      shouldConfirm = true;
      console.log('  → 符合条件：更早的交易，现在确认');
    } else {
      console.log('  → 跳过：今天的交易，之后再确认');
    }

    if (shouldConfirm) {
      // 找到对应的持仓
      const row = await db.getPosition(trade.rowId);
      if (!row) {
        console.log(`  → 找不到对应的持仓，跳过`);
        remainingTrades.push(trade);
        continue;
      }

      // 获取基金净值
      const fundData = await fetchFundNetValue(trade.code);
      if (!fundData || !fundData.netValue || fundData.netValue <= 0) {
        console.log(`  → 获取基金净值失败，跳过`);
        remainingTrades.push(trade);
        continue;
      }

      console.log(`  当前净值: ${fundData.netValue}`);

      const tradeType = trade.type || 'add';
      if (tradeType === 'reduce') {
        const reduceShares = parseFloat(Number(trade.shares || 0).toFixed(2));
        if (!(reduceShares > 0)) {
          console.log('  → 减仓份额无效，跳过');
          remainingTrades.push(trade);
          continue;
        }
        if (reduceShares > (row.shares || 0)) {
          console.log('  → 减仓份额超过当前持仓，跳过');
          remainingTrades.push(trade);
          continue;
        }

        const remainShares = (row.shares || 0) - reduceShares;
        const redeemAmount = reduceShares * fundData.netValue;
        const updatedShares = parseFloat(remainShares.toFixed(2));

        console.log(`  减仓份额: ${reduceShares.toFixed(2)}, 剩余份额: ${updatedShares.toFixed(2)}, 赎回金额: ${redeemAmount.toFixed(2)}`);

        await db.updatePosition(row.id, {
          shares: updatedShares,
          cost: row.cost
        });

        await db.createTradeRecord({
          id: trade.id,
          rowId: trade.rowId,
          type: 'reduce',
          amount: parseFloat(redeemAmount.toFixed(2)),
          shares: reduceShares,
          netValue: parseFloat(fundData.netValue.toFixed(4)),
          isBefore15: trade.isBefore15,
          createdAt: trade.createdAt,
          localDate: tradeDateStr
        });
      } else {
        // 计算新的份额和成本
        const newShares = trade.amount / fundData.netValue;
        const totalShares = (row.shares || 0) + newShares;
        const totalCost = ((row.shares || 0) * (row.cost || 0)) + trade.amount;
        const newCost = totalCost / totalShares;

        console.log(`  新增份额: ${newShares.toFixed(4)}, 总份额: ${totalShares.toFixed(4)}, 新成本: ${newCost.toFixed(4)}`);

        // 更新持仓（shares保留2位小数，cost保留4位小数）
        const updatedShares = parseFloat(totalShares.toFixed(2));
        const updatedCost = parseFloat(newCost.toFixed(4));
        const updatedPlanBuy = row.planBuy && row.planBuy > 0 ? Math.max(0, row.planBuy - trade.amount) : row.planBuy;

        // 更新数据库中的持仓
        await db.updatePosition(row.id, {
          shares: updatedShares,
          cost: updatedCost,
          planBuy: updatedPlanBuy
        });

        // 添加交易历史记录到数据库
        await db.createTradeRecord({
          id: trade.id,
          rowId: trade.rowId,
          type: 'add',
          amount: trade.amount,
          shares: parseFloat(newShares.toFixed(2)),
          netValue: parseFloat(fundData.netValue.toFixed(4)),
          isBefore15: trade.isBefore15,
          createdAt: trade.createdAt,
          localDate: tradeDateStr
        });
      }

      // 从数据库中删除已确认的待确认交易
      await db.deletePendingTrade(trade.id);

      confirmedCount++;
      console.log(`  ✓ 确认成功`);
    } else {
      remainingTrades.push(trade);
    }
  }

  if (confirmedCount > 0) {
    invalidateCache('app-settings', 'data', 'pending-trades', 'trade-history');
    invalidateCacheByPrefix('trade-history:');
    invalidateCacheByPrefix('quotes:');
    console.log(`\n自动确认完成！共确认 ${confirmedCount} 笔交易`);
  } else {
    console.log(`\n没有需要确认的交易`);
  }

  console.log('========== 确认完成 ==========\n');
}

// ==================== 设置定时任务 ====================
// 配置时间: 秒 分 时 日 月 周
// 晚上10点: '0 0 22 * * *'
async function setupCronJob() {
  const configs = await db.getAllConfigs();
  // 优先使用环境变量，其次使用数据库配置
  const cronTime = process.env.ALERT_TIME || configs.alertTime || '0 22 * * *';

  // 清除旧任务
  if (global.cronJob) {
    global.cronJob.stop();
  }
  if (global.profitCronJob) {
    global.profitCronJob.stop();
  }
  if (global.confirmCronJob) {
    global.confirmCronJob.stop();
  }
  if (global.alertCheckCronJob) {
    global.alertCheckCronJob.stop();
  }
  if (global.alertResetCronJob) {
    global.alertResetCronJob.stop();
  }

  // 基金提醒定时任务
  global.cronJob = cron.schedule(cronTime, () => {
    checkFundsAndAlert();
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 每日收益计算定时任务 - 周一到周五晚上11点执行
  global.profitCronJob = cron.schedule('0 0 23 * * 1-5', () => {
    calculateAndSaveDailyProfit();
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 自动确认待确认交易定时任务 - 每天早上9点执行
  global.confirmCronJob = cron.schedule('0 0 9 * * *', () => {
    autoConfirmPendingTrades();
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 股票涨跌幅提醒检查定时任务 - 交易时间每分钟执行
  // 上午 9:30-11:30, 下午 13:00-15:00
  global.alertCheckCronJob = cron.schedule('* 9-11,13-14 * * 1-5', () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    // 精确控制时间段
    const isMorningSession = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute <= 30);
    const isAfternoonSession = hour === 13 || hour === 14 || (hour === 15 && minute === 0);

    if (isMorningSession || isAfternoonSession) {
      checkPriceAlerts(fetchQuotesBatch, sendWechatMessage);
    }
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 每天开盘前重置提醒状态 - 9:25执行
  global.alertResetCronJob = cron.schedule('25 9 * * 1-5', () => {
    console.log('重置股票涨跌幅提醒状态...');
    db.resetAlertRulesDaily();
  }, {
    timezone: 'Asia/Shanghai'
  });

  console.log(`基金提醒定时任务已设置: 每天 ${cronTime} 执行`);
  console.log(`每日收益计算定时任务已设置: 周一到周五 23:00 执行`);
  console.log(`自动确认交易定时任务已设置: 每天 09:00 执行`);
  console.log(`股票涨跌幅提醒检查已设置: 交易时间每分钟执行`);
  console.log(`提醒状态重置已设置: 周一到周五 09:25 执行`);
  console.log('提示: 可以在 .env 文件中修改 ALERT_TIME 环境变量');
}

// ==================== HTTP 服务器 ====================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/') {
    if (servePublicFile(req, res, '/stock.html')) {
      return;
    }
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/mobile') {
    if (servePublicFile(req, res, '/index.html')) {
      return;
    }
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/')) {
    if (servePublicFile(req, res, req.url)) {
      return;
    }
  }

  // 手动触发检查 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-check') {
    checkFundsAndAlert();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '检查已触发' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/app-settings') {
    try {
      await sendCachedJson(req, res, 'app-settings', async () => ({
        requiresEditUnlock: true
      }));
    } catch (error) {
      console.error('Error getting app settings:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get app settings' }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/verify-unlock') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { password } = JSON.parse(body || '{}');
        const unlockPassword = await getEditUnlockPassword();
        const success = password === unlockPassword;
        res.writeHead(success ? 200 : 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success,
          message: success ? '解锁成功' : '密码错误'
        }));
      } catch (e) {
        console.error('Error verifying unlock password:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 手动触发每日收益计算 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-profit') {
    calculateAndSaveDailyProfit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '每日收益计算已触发' }));
    return;
  }

  // 手动触发自动确认待确认交易 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-confirm') {
    autoConfirmPendingTrades();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '自动确认交易已触发' }));
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/quotes')) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const fresh = requestUrl.searchParams.get('fresh') === '1';
      const itemsParam = requestUrl.searchParams.get('items');

      let items;
      if (itemsParam) {
        items = itemsParam
          .split(',')
          .map(entry => entry.trim())
          .filter(Boolean)
          .map(entry => {
            const [code, isFundFlag] = entry.split(':');
            return { code, isFund: isFundFlag === '1' };
          });
      } else {
        const rows = await db.getPositions();
        items = rows.map(row => ({ code: row.code, isFund: row.isFund }));
      }

      const normalizedCacheKey = items
        .map(item => `${String(item.code || '').trim()}:${item.isFund ? 1 : 0}`)
        .filter(Boolean)
        .sort()
        .join(',');

      await sendCachedJson(req, res, `quotes:${normalizedCacheKey}`, async () => ({
        quotes: await fetchQuotesBatch(items),
        updatedAt: Date.now(),
      }), {
        ttlMs: QUOTES_CACHE_TTL_MS,
        bypassCache: fresh,
      });
    } catch (error) {
      console.error('Error getting quotes:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get quotes' }));
    }
    return;
  }

  // ========== 待确认交易 API ==========
  // 获取待确认交易列表
  if (req.method === 'GET' && req.url === '/api/pending-trades') {
    try {
      await sendCachedJson(req, res, 'pending-trades', async () => {
        const trades = await db.getPendingTrades();
        return { trades };
      });
    } catch (error) {
      console.error('Error getting pending trades:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get pending trades' }));
    }
    return;
  }

  // 新增待确认交易
  if (req.method === 'POST' && req.url === '/api/pending-trades') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const trade = JSON.parse(body);
        await db.createPendingTrade(trade);
        invalidateCache('pending-trades');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
        console.error('Error creating pending trade:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 删除待确认交易
  if (req.method === 'POST' && req.url === '/api/pending-trades/delete') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body);
        await db.deletePendingTrade(id);
        invalidateCache('pending-trades');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Error deleting pending trade:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 批量保存待确认交易（替换整个列表）
  if (req.method === 'POST' && req.url === '/api/save-pending-trades') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { trades } = JSON.parse(body);

        // 先删除所有现有交易
        await db.deleteAllPendingTrades();

        // 批量插入新交易
        for (const trade of trades) {
          await db.createPendingTrade(trade);
        }

        invalidateCache('pending-trades');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '批量保存成功' }));
      } catch (e) {
        console.error('Error saving pending trades:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // ========== 交易历史 API ==========
  // 获取交易历史（全部）
  if (req.method === 'GET' && req.url === '/api/trade-history') {
    try {
      await sendCachedJson(req, res, 'trade-history', async () => {
        const history = await db.getTradeHistory();
        return { history };
      });
    } catch (error) {
      console.error('Error getting trade history:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get trade history' }));
    }
    return;
  }

  // 获取某持仓的交易历史
  if (req.method === 'GET' && req.url.startsWith('/api/trade-history/')) {
    try {
      const rowId = req.url.split('/api/trade-history/')[1];
      await sendCachedJson(req, res, `trade-history:${rowId}`, async () => {
        const records = await db.getTradeHistoryByRowId(rowId);
        return { records };
      });
    } catch (error) {
      console.error('Error getting trade history by rowId:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get trade history' }));
    }
    return;
  }

  // 新增交易历史记录
  if (req.method === 'POST' && req.url === '/api/trade-history') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { rowId, record } = JSON.parse(body);

        // 格式化数值：shares保留2位小数，netValue保留4位小数
        const formattedRecord = { ...record };
        if (typeof formattedRecord.shares === 'number') {
          formattedRecord.shares = parseFloat(formattedRecord.shares.toFixed(2));
        }
        if (typeof formattedRecord.netValue === 'number') {
          formattedRecord.netValue = parseFloat(formattedRecord.netValue.toFixed(4));
        }

        // 创建交易记录
        await db.createTradeRecord({
          id: formattedRecord.id,
          rowId: rowId,
          type: formattedRecord.type,
          amount: formattedRecord.amount,
          shares: formattedRecord.shares,
          netValue: formattedRecord.netValue,
          isBefore15: formattedRecord.isBefore15 || true,
          createdAt: formattedRecord.createdAt,
          localDate: formattedRecord.localDate || null,
        });

        invalidateCache('trade-history', `trade-history:${rowId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
        console.error('Error creating trade record:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 批量保存交易历史（替换整个历史）
  if (req.method === 'POST' && req.url === '/api/save-trade-history') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { history } = JSON.parse(body);

        // 开始事务：先删除所有现有记录
        await db.query('BEGIN');
        await db.query('DELETE FROM trade_history');

        // 批量插入新记录
        for (const [rowId, records] of Object.entries(history)) {
          for (const record of records) {
            // 格式化数值：shares保留2位小数，netValue保留4位小数
            const formattedRecord = { ...record };
            if (typeof formattedRecord.shares === 'number') {
              formattedRecord.shares = parseFloat(formattedRecord.shares.toFixed(2));
            }
            if (typeof formattedRecord.netValue === 'number') {
              formattedRecord.netValue = parseFloat(formattedRecord.netValue.toFixed(4));
            }

            await db.createTradeRecord({
              id: formattedRecord.id,
              rowId: rowId,
              type: formattedRecord.type,
              amount: formattedRecord.amount,
              shares: formattedRecord.shares,
              netValue: formattedRecord.netValue,
              isBefore15: formattedRecord.isBefore15 || true,
              createdAt: formattedRecord.createdAt,
              localDate: formattedRecord.localDate || null,
            });
          }
        }

        await db.query('COMMIT');
        invalidateCache('trade-history');
        invalidateCacheByPrefix('trade-history:');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '批量保存成功' }));
      } catch (e) {
        // 回滚事务
        await db.query('ROLLBACK').catch(() => { });
        console.error('Error saving trade history:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 保存单行数据
  if (req.method === 'POST' && req.url === '/api/save-row') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const rowData = JSON.parse(body);

        // 格式化数值：shares保留2位小数，cost保留4位小数
        if (typeof rowData.shares === 'number') {
          rowData.shares = parseFloat(rowData.shares.toFixed(2));
        }
        if (typeof rowData.cost === 'number') {
          rowData.cost = parseFloat(rowData.cost.toFixed(4));
        }

        // 检查是否已存在（根据id或code+isFund）
        let existingPosition = null;
        if (rowData.id) {
          existingPosition = await db.getPosition(rowData.id);
        }
        if (!existingPosition && rowData.code && rowData.isFund !== undefined) {
          existingPosition = await db.getPositionByCode(rowData.code, rowData.isFund);
        }

        if (existingPosition) {
          // 更新现有记录
          await db.updatePosition(existingPosition.id, {
            code: rowData.code,
            name: rowData.name,
            shares: rowData.shares,
            cost: rowData.cost,
            isFund: rowData.isFund,
            isOverseas: rowData.isOverseas || false,
            planBuy: rowData.planBuy || 0,
            alert: rowData.alert || null,
            targetPrice: rowData.targetPrice || null,
          });
        } else {
          // 创建新记录
          await db.createPosition({
            id: rowData.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            code: rowData.code,
            name: rowData.name,
            shares: rowData.shares,
            cost: rowData.cost,
            isFund: rowData.isFund || false,
            isOverseas: rowData.isOverseas || false,
            planBuy: rowData.planBuy || 0,
            alert: rowData.alert || null,
            targetPrice: rowData.targetPrice || null,
          });
        }

        invalidateCache('data');
        invalidateCacheByPrefix('quotes:');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
        console.error('Save row error:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 删除单行数据
  if (req.method === 'POST' && req.url === '/api/delete-row') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { id, code, isFund } = JSON.parse(body);
        let deleted = false;

        // 先用 code + isFund 删除
        if (code && isFund !== undefined) {
          try {
            await db.deletePositionByCode(code, isFund);
            deleted = true;
          } catch (e) {
            // 可能不存在，继续尝试用id删除
          }
        }
        // 如果没删除成功，再用 id 删除
        if (!deleted && id) {
          try {
            await db.deletePosition(id);
            deleted = true;
          } catch (e) {
            // 可能不存在
          }
        }

        if (deleted) {
          invalidateCache('data');
          invalidateCacheByPrefix('quotes:');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deleted }));
      } catch (e) {
        console.error('Delete row error:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 获取所有数据
  if (req.method === 'GET' && req.url === '/api/data') {
    try {
      await sendCachedJson(req, res, 'data', async () => {
        const rows = await db.getPositions();
        return { rows };
      });
    } catch (error) {
      console.error('Error getting positions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get data' }));
    }
    return;
  }

  if (await handleDailyProfitRoutes(req, res)) {
    return;
  }

  // 股票涨跌幅提醒规则 API
  if (await handleAlertRulesRoutes(req, res, {
    sendCachedJson,
    invalidateCache,
    fetchQuotesBatch,
    sendWechatMessage
  })) {
    return;
  }

  // ========== 基金实时估算 API ==========
  if (req.method === 'GET' && req.url.startsWith('/api/fund-estimate/')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const fundCode = parsedUrl.pathname.split('/api/fund-estimate/')[1].replace(/\/$/, '');
      const result = await fetchFundEstimate(fundCode);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('Error fetching fund estimate:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 批量获取基金实时估算
  if (req.method === 'POST' && req.url === '/api/fund-estimate/batch') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { fundCodes } = JSON.parse(body);
        if (!fundCodes || !Array.isArray(fundCodes)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'fundCodes 必须是数组' }));
          return;
        }
        const results = [];
        for (const code of fundCodes) {
          const result = await fetchFundEstimate(code);
          results.push(result);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, results }));
      } catch (e) {
        console.error('Error batch fetching fund estimates:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ========== 基金回撤分析 API ==========
  // 分析单只基金
  if (req.method === 'GET' && req.url.startsWith('/api/fund-drawdown/')) {
    try {
      // 1. 使用 URL 构造函数解析完整路径
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

      // 2. 从 pathname 提取 fundCode (去掉末尾可能存在的斜杠)
      const fundCode = parsedUrl.pathname.split('/api/fund-drawdown/')[1].replace(/\/$/, '');

      // 3. 获取 days 参数，如果没有则默认 365
      const days = parseInt(parsedUrl.searchParams.get('days')) || 365;

      // 4. 获取持仓成本参数（可选）
      const costBasis = parseFloat(parsedUrl.searchParams.get('costBasis')) || null;

      // 执行分析
      const result = await analyzeFund(fundCode, days, costBasis);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('Error analyzing fund:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }


  // 批量分析多只基金
  if (req.method === 'POST' && req.url === '/api/fund-drawdown/batch') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { fundCodes, days = 365, costBasisMap = {} } = JSON.parse(body);
        if (!fundCodes || !Array.isArray(fundCodes)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'fundCodes 必须是数组' }));
          return;
        }
        const results = await analyzeMultipleFunds(fundCodes, days, costBasisMap);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, results }));
      } catch (e) {
        console.error('Error batch analyzing funds:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ========== K线数据代理API ==========
  if (req.method === 'GET' && req.url.startsWith('/api/kline/')) {
    try {
      // 解析参数: /api/kline/sz159321?scale=240&datalen=1023
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathParts = parsedUrl.pathname.split('/');
      const symbol = pathParts[pathParts.length - 1];
      const scale = parseInt(parsedUrl.searchParams.get('scale')) || 240;
      const datalen = parseInt(parsedUrl.searchParams.get('datalen')) || 1023;

      // 验证参数
      if (!symbol || !['sh', 'sz', 'hk'].some(prefix => symbol.startsWith(prefix))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '无效的股票代码格式' }));
        return;
      }

      // 使用缓存
      const cacheKey = `kline:${symbol}:${scale}:${datalen}`;
      await sendCachedJson(req, res, cacheKey, async () => {
        const klineData = await fetchKlineData(symbol, scale, datalen);
        return {
          success: true,
          data: klineData,
          updatedAt: Date.now()
        };
      }, {
        ttlMs: KLINE_CACHE_TTL_MS
      });
    } catch (error) {
      console.error('获取K线数据失败:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});
