const http = require('http');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const fetch = require('node-fetch');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DAILY_PROFIT_FILE = path.join(__dirname, 'daily-profit.json');
const PENDING_TRADES_FILE = path.join(__dirname, 'pending-trades.json');
const TRADE_HISTORY_FILE = path.join(__dirname, 'trade-history.json');

// ==================== 配置部分 ====================
// Server酱配置 - 需要在 config.json 中设置或直接修改这里
let SERVERCHAN_KEY = '';

// 初始化配置文件
function initConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      serverchanKey: '',
      alertTime: '0 22 * * *'
    }, null, 2));
    console.log('已创建配置文件 config.json，请填写 Server酱 Key');
  } else {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    SERVERCHAN_KEY = config.serverchanKey || '';
    if (!SERVERCHAN_KEY) {
      console.log('请在 config.json 中配置 serverchanKey 以接收微信通知');
    }
  }
}

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ rows: [] }, null, 2));
}

// 初始化每日收益文件
if (!fs.existsSync(DAILY_PROFIT_FILE)) {
  fs.writeFileSync(DAILY_PROFIT_FILE, JSON.stringify({ records: [] }, null, 2));
}

// 初始化待确认交易文件
if (!fs.existsSync(PENDING_TRADES_FILE)) {
  fs.writeFileSync(PENDING_TRADES_FILE, JSON.stringify({ trades: [] }, null, 2));
}

// 初始化交易历史文件
if (!fs.existsSync(TRADE_HISTORY_FILE)) {
  fs.writeFileSync(TRADE_HISTORY_FILE, JSON.stringify({ history: {} }, null, 2));
}

// 读取每日收益数据
function readDailyProfit() {
  try {
    const data = fs.readFileSync(DAILY_PROFIT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { records: [] };
  }
}

// 写入每日收益数据
function writeDailyProfit(data) {
  fs.writeFileSync(DAILY_PROFIT_FILE, JSON.stringify(data, null, 2));
}

// 读取待确认交易
function readPendingTrades() {
  try {
    const data = fs.readFileSync(PENDING_TRADES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { trades: [] };
  }
}

// 写入待确认交易
function writePendingTrades(data) {
  fs.writeFileSync(PENDING_TRADES_FILE, JSON.stringify(data, null, 2));
}

// 读取交易历史
function readTradeHistory() {
  try {
    const data = fs.readFileSync(TRADE_HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { history: {} };
  }
}

// 写入交易历史
function writeTradeHistory(data) {
  fs.writeFileSync(TRADE_HISTORY_FILE, JSON.stringify(data, null, 2));
}

initConfig();

// 读取数据
function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { rows: [] };
  }
}

// 写入数据
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

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
    const text = await response.text();

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
    const text = await response.text();

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

// ==================== 检查基金并发送提醒 ====================
async function checkFundsAndAlert() {
  console.log('\n========== 开始检查基金涨跌提醒 ==========');
  const data = readData();
  const funds = data.rows.filter(r => r.isFund && r.alert && r.alert > 0 && r.code);

  if (funds.length === 0) {
    console.log('没有需要检查的基金');
    return;
  }

  const alerts = [];

  for (const fund of funds) {
    console.log(`检查基金: ${fund.name || fund.code}`);
    const fundData = await fetchFundNetValue(fund.code);

    if (fundData && fundData.netValue > 0 && fund.cost > 0) {
      const changePercent = ((fundData.netValue - fund.cost) / fund.cost) * 100;

      console.log(`  成本: ${fund.cost}, 最新净值: ${fundData.netValue}, 涨跌幅: ${changePercent.toFixed(2)}%, 提醒阈值: ${fund.alert}%`);

      if (Math.abs(changePercent) >= fund.alert) {
        alerts.push({
          name: fund.name || fundData.name || fund.code,
          code: fund.code,
          cost: fund.cost,
          netValue: fundData.netValue,
          changePercent: changePercent,
          alert: fund.alert
        });
      }
    }
  }

  if (alerts.length > 0) {
    console.log(`\n有 ${alerts.length} 只基金达到提醒阈值`);

    let title = '【基金提醒】';
    let content = '## 基金涨跌提醒\n\n';

    alerts.forEach((a) => {
      const isUp = a.changePercent >= 0;
      const emoji = isUp ? '涨' : '跌';
      title += `${a.name} ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}% `;
      content += `### ${emoji} ${a.name} (${a.code})\n\n`;
      content += `- 成本价: ${a.cost.toFixed(3)}\n`;
      content += `- 最新净值: ${a.netValue.toFixed(3)}\n`;
      content += `- 涨跌幅: ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}%\n`;
      content += `- 提醒阈值: ${a.alert}%\n\n`;
    });

    await sendWechatMessage(title.slice(0, 100), content);
  } else {
    console.log('没有基金达到提醒阈值');
  }

  console.log('========== 检查完成 ==========\n');
}

// ==================== 计算并保存每日收益 ====================
async function calculateAndSaveDailyProfit() {
  console.log('\n========== 开始计算每日收益 ==========');
  const data = readData();
  const now = new Date();
  const dateStr = now.getFullYear().toString() + '-' +
                 (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
                 now.getDate().toString().padStart(2, '0');

  // 检查今天是否已经有数据
  const dailyData = readDailyProfit();
  const existingRecord = dailyData.records.find(r => r.date === dateStr);
  if (existingRecord) {
    console.log(`今日(${dateStr})收益数据已存在，跳过计算`);
    console.log('========== 计算完成 ==========\n');
    return;
  }

  let stockToday = 0, fundToday = 0;
  const stocks = data.rows.filter(r => !r.isFund && r.code);
  const funds = data.rows.filter(r => r.isFund && r.code);

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

  dailyData.records.push(profitRecord);
  writeDailyProfit(dailyData);

  console.log(`\n收益计算完成！`);
  console.log(`股票今日收益: ¥${profitRecord.stockToday.toLocaleString()}`);
  console.log(`基金今日收益: ¥${profitRecord.fundToday.toLocaleString()}`);
  console.log(`总今日收益: ¥${profitRecord.totalToday.toLocaleString()}`);
  console.log('========== 计算完成 ==========\n');
}

// ==================== 自动确认待确认交易 ====================
async function autoConfirmPendingTrades() {
  console.log('\n========== 开始自动确认待确认交易 ==========');
  const pendingData = readPendingTrades();
  const data = readData();
  const tradeHistory = readTradeHistory();

  if (pendingData.trades.length === 0) {
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
  console.log(`待确认交易数量: ${pendingData.trades.length}`);

  let confirmedCount = 0;
  const remainingTrades = [];

  for (const trade of pendingData.trades) {
    // 将 UTC 时间转换为北京时间
    const tradeDateUTC = new Date(trade.createdAt);
    const tradeDateBeijing = new Date(tradeDateUTC.getTime() + 8 * 60 * 60 * 1000);
    const tradeDateStr = tradeDateBeijing.toISOString().slice(0, 10);
    const tradeHour = tradeDateBeijing.getUTCHours(); // 因为已经加了8小时，用getUTCHours获取北京时间的小时

    console.log(`\n处理交易: ${trade.name} (${trade.code})`);
    console.log(`  交易时间(北京): ${tradeDateStr} ${tradeHour.toString().padStart(2, '0')}:${tradeDateBeijing.getUTCMinutes().toString().padStart(2, '0')}`);
    console.log(`  15点前: ${trade.isBefore15 ? '是' : '否'}`);

    // 判断是否应该自动确认：
    // 1. 如果是昨天15点前的交易，今天确认
    // 2. 如果是昨天15点后的交易，明天确认（暂时不处理）
    let shouldConfirm = false;

    if (tradeDateStr === yesterdayStr && trade.isBefore15) {
      shouldConfirm = true;
      console.log('  → 符合条件：昨天15点前的交易，今天确认');
    } else if (tradeDateStr === yesterdayStr && !trade.isBefore15) {
      console.log('  → 跳过：昨天15点后的交易，明天确认');
    } else if (tradeDateStr < yesterdayStr) {
      shouldConfirm = true;
      console.log('  → 符合条件：更早的交易，现在确认');
    } else {
      console.log('  → 跳过：今天的交易，之后再确认');
    }

    if (shouldConfirm) {
      // 找到对应的持仓
      const rowIndex = data.rows.findIndex(r => r.id === trade.rowId);
      if (rowIndex < 0) {
        console.log(`  → 找不到对应的持仓，跳过`);
        remainingTrades.push(trade);
        continue;
      }

      const row = data.rows[rowIndex];

      // 获取基金净值
      const fundData = await fetchFundNetValue(trade.code);
      if (!fundData || !fundData.netValue || fundData.netValue <= 0) {
        console.log(`  → 获取基金净值失败，跳过`);
        remainingTrades.push(trade);
        continue;
      }

      console.log(`  当前净值: ${fundData.netValue}`);

      // 计算新的份额和成本
      const newShares = trade.amount / fundData.netValue;
      const totalShares = (row.shares || 0) + newShares;
      const totalCost = ((row.shares || 0) * (row.cost || 0)) + trade.amount;
      const newCost = totalCost / totalShares;

      console.log(`  新增份额: ${newShares.toFixed(4)}, 总份额: ${totalShares.toFixed(4)}, 新成本: ${newCost.toFixed(4)}`);

      // 更新持仓（shares保留2位小数，cost保留4位小数）
      row.shares = parseFloat(totalShares.toFixed(2));
      row.cost = parseFloat(newCost.toFixed(4));

      // 扣除拟加仓金额
      if (row.planBuy && row.planBuy > 0) {
        row.planBuy = Math.max(0, row.planBuy - trade.amount);
      }

      // 添加交易历史记录
      if (!tradeHistory.history[trade.rowId]) {
        tradeHistory.history[trade.rowId] = [];
      }
      tradeHistory.history[trade.rowId].unshift({
        id: trade.id,
        type: 'add',
        amount: trade.amount,
        shares: parseFloat(newShares.toFixed(2)),
        netValue: parseFloat(fundData.netValue.toFixed(4)),
        isBefore15: trade.isBefore15,
        createdAt: trade.createdAt,
        localDate: tradeDateStr
      });

      confirmedCount++;
      console.log(`  ✓ 确认成功`);
    } else {
      remainingTrades.push(trade);
    }
  }

  if (confirmedCount > 0) {
    // 保存更新后的数据
    writeData(data);
    writeTradeHistory(tradeHistory);
    writePendingTrades({ trades: remainingTrades });
    console.log(`\n自动确认完成！共确认 ${confirmedCount} 笔交易`);
  } else {
    console.log(`\n没有需要确认的交易`);
  }

  console.log('========== 确认完成 ==========\n');
}

// ==================== 设置定时任务 ====================
// 配置时间: 秒 分 时 日 月 周
// 晚上10点: '0 0 22 * * *'
function setupCronJob() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const cronTime = config.alertTime || '0 16 01 * * *';

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

  // 基金提醒定时任务
  global.cronJob = cron.schedule(cronTime, () => {
    checkFundsAndAlert();
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 每日收益计算定时任务 - 每天晚上11点执行
  global.profitCronJob = cron.schedule('0 0 23 * * *', () => {
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

  console.log(`基金提醒定时任务已设置: 每天 ${cronTime} 执行`);
  console.log(`每日收益计算定时任务已设置: 每天 23:00 执行`);
  console.log(`自动确认交易定时任务已设置: 每天 09:00 执行`);
  console.log('提示: 可以在 config.json 中修改 alertTime');
}

setupCronJob();

// ==================== HTTP 服务器 ====================
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 手动触发检查 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-check') {
    checkFundsAndAlert();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '检查已触发' }));
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

  // ========== 待确认交易 API ==========
  // 获取待确认交易列表
  if (req.method === 'GET' && req.url === '/api/pending-trades') {
    const data = readPendingTrades();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // 新增待确认交易
  if (req.method === 'POST' && req.url === '/api/pending-trades') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const trade = JSON.parse(body);
        const data = readPendingTrades();
        data.trades.push(trade);
        writePendingTrades(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
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
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body);
        const data = readPendingTrades();
        data.trades = data.trades.filter(t => t.id !== id);
        writePendingTrades(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // ========== 交易历史 API ==========
  // 获取交易历史（全部）
  if (req.method === 'GET' && req.url === '/api/trade-history') {
    const data = readTradeHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // 获取某持仓的交易历史
  if (req.method === 'GET' && req.url.startsWith('/api/trade-history/')) {
    const rowId = req.url.split('/api/trade-history/')[1];
    const data = readTradeHistory();
    const records = data.history[rowId] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ records }));
    return;
  }

  // 新增交易历史记录
  if (req.method === 'POST' && req.url === '/api/trade-history') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { rowId, record } = JSON.parse(body);
        const data = readTradeHistory();
        if (!data.history[rowId]) {
          data.history[rowId] = [];
        }

        // 格式化数值：shares保留2位小数，netValue保留4位小数
        const formattedRecord = { ...record };
        if (typeof formattedRecord.shares === 'number') {
          formattedRecord.shares = parseFloat(formattedRecord.shares.toFixed(2));
        }
        if (typeof formattedRecord.netValue === 'number') {
          formattedRecord.netValue = parseFloat(formattedRecord.netValue.toFixed(4));
        }

        data.history[rowId].push(formattedRecord);
        writeTradeHistory(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
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
    req.on('end', () => {
      try {
        const rowData = JSON.parse(body);
        const data = readData();

        // 用 code 和 isFund 共同判断是否存在
        let index = -1;
        if (rowData.code) {
          index = data.rows.findIndex(r => r.code === rowData.code && r.isFund === rowData.isFund);
        }
        // 如果没找到，再用 id 判断（兼容旧数据）
        if (index < 0 && rowData.id) {
          index = data.rows.findIndex(r => r.id === rowData.id);
        }

        // 格式化数值：shares保留2位小数，cost保留4位小数
        if (typeof rowData.shares === 'number') {
          rowData.shares = parseFloat(rowData.shares.toFixed(2));
        }
        if (typeof rowData.cost === 'number') {
          rowData.cost = parseFloat(rowData.cost.toFixed(4));
        }

        if (index >= 0) {
          // 更新时保留原 id
          rowData.id = data.rows[index].id;
          data.rows[index] = rowData;
        } else {
          data.rows.push(rowData);
        }

        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
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
    req.on('end', () => {
      try {
        const { id, code, isFund } = JSON.parse(body);
        const data = readData();

        // 先用 code + isFund 删除
        let deleted = false;
        if (code) {
          const initialLength = data.rows.length;
          data.rows = data.rows.filter(r => !(r.code === code && r.isFund === isFund));
          deleted = data.rows.length !== initialLength;
        }
        // 如果没删除成功，再用 id 删除
        if (!deleted && id) {
          const initialLength = data.rows.length;
          data.rows = data.rows.filter(r => r.id !== id);
          deleted = data.rows.length !== initialLength;
        }

        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deleted }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 获取所有数据
  if (req.method === 'GET' && req.url === '/api/data') {
    const data = readData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // 保存今日收益
  if (req.method === 'POST' && req.url === '/api/save-daily-profit') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const profitData = JSON.parse(body);
        const data = readDailyProfit();

        // 检查该日期是否已存在，存在则更新，不存在则添加
        const existingIndex = data.records.findIndex(r => r.date === profitData.date);
        if (existingIndex >= 0) {
          data.records[existingIndex] = profitData;
        } else {
          data.records.push(profitData);
        }

        writeDailyProfit(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '保存成功' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 获取每日收益历史
  if (req.method === 'GET' && req.url === '/api/daily-profit') {
    const data = readDailyProfit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n服务器运行在 http://localhost:${PORT}`);
  console.log(`数据文件: ${DATA_FILE}`);
  console.log(`配置文件: ${CONFIG_FILE}`);
  console.log(`每日收益文件: ${DAILY_PROFIT_FILE}`);
  console.log(`待确认交易文件: ${PENDING_TRADES_FILE}`);
  console.log(`交易历史文件: ${TRADE_HISTORY_FILE}`);
  console.log('\n可用接口:');
  console.log('  GET  /api/data                    - 获取所有数据');
  console.log('  POST /api/save-row                - 保存单行数据');
  console.log('  GET  /api/trigger-check           - 手动触发基金检查 (测试)');
  console.log('  GET  /api/trigger-profit          - 手动触发每日收益计算 (测试)');
  console.log('  GET  /api/trigger-confirm         - 手动触发自动确认交易 (测试)');
  console.log('  POST /api/save-daily-profit       - 保存今日收益');
  console.log('  GET  /api/daily-profit            - 获取每日收益历史');
  console.log('  --- 待确认交易 ---');
  console.log('  GET  /api/pending-trades          - 获取待确认交易列表');
  console.log('  POST /api/pending-trades          - 新增待确认交易');
  console.log('  POST /api/pending-trades/delete   - 删除待确认交易');
  console.log('  --- 交易历史 ---');
  console.log('  GET  /api/trade-history           - 获取全部交易历史');
  console.log('  GET  /api/trade-history/:rowId    - 获取某持仓的交易历史');
  console.log('  POST /api/trade-history           - 新增交易历史记录');
  console.log('\n配置说明:');
  console.log('  1. 在 config.json 中填写 serverchanKey (Server酱 SendKey)');
  console.log('  2. Server酱获取地址: https://sct.ftqq.com/');
  console.log('  3. 在前端页面为基金设置涨跌提醒值 (%)');
  console.log('  4. 每日收益定时任务: 每天 23:00 自动计算并保存');
  console.log('  5. 自动确认交易定时任务: 每天 09:00 自动确认昨天15点前的交易');
  console.log('');
});
