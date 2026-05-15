/**
 * 投资助手 - 后端服务主入口
 * 端口 4000，提供持仓管理、行情查询、基金分析等 API
 */
require('dotenv').config();

const http = require('http');
const cron = require('node-cron');
const db = require('./db/db');

// 中间件
const { authRequired } = require('./middleware/auth');
const { sendCachedJson, invalidateCache, invalidateCacheByPrefix, QUOTES_CACHE_TTL_MS, KLINE_CACHE_TTL_MS } = require('./middleware/cache');

// 工具
const { fetchQuotesBatch } = require('./utils/quotes');

// 服务
const { checkFundsAndAlert } = require('./services/fund-alert');
const { calculateAndSaveDailyProfit } = require('./services/daily-profit');
const { autoConfirmPendingTrades } = require('./services/auto-confirm');
const { sendWechatMessage, initServerchanKey } = require('./services/wechat');

// 路由模块
const { handleAuthRoutes } = require('./routes/auth');
const { handlePositionRoutes } = require('./routes/positions');
const { handleTradeRoutes } = require('./routes/trades');
const { handleCategoryRoutes } = require('./routes/categories');
const { handleAssetRoutes } = require('./routes/assets');
const { handleFundRoutes } = require('./routes/fund');
const { handleMarketRoutes } = require('./routes/market');
const { handleConfigRoutes } = require('./routes/config');
const { handleDailyProfitRoutes } = require('./routes/daily-profit');
const { handleAlertRulesRoutes, checkPriceAlerts } = require('./routes/alert-rules');
const { handleFundScreenshotRoutes, loadCodeFixMap } = require('./routes/fund-screenshot');

const PORT = 4000;

// ==================== 配置初始化 ====================
async function initConfig() {
  try {
    const configs = await db.getAllConfigs();

    // 设置默认配置
    if (!configs.serverchanKey) {
      await db.setConfig('serverchanKey', process.env.SERVERCHAN_KEY || '');
    }
    if (!configs.alertTime) {
      await db.setConfig('alertTime', process.env.ALERT_TIME || '0 22 * * *');
    }
    if (!configs.editUnlockPassword) {
      await db.setConfig('editUnlockPassword', process.env.EDIT_UNLOCK_PASSWORD || '8957');
    }

    await initServerchanKey();
    await loadCodeFixMap();
  } catch (error) {
    console.error('初始化配置失败:', error);
    await initServerchanKey();
  }
}

// ==================== 定时任务 ====================
async function setupCronJob() {
  const configs = await db.getAllConfigs();
  const cronTime = process.env.ALERT_TIME || configs.alertTime || '0 22 * * *';

  // 清理旧任务
  ['cronJob', 'profitCronJob', 'confirmCronJob', 'alertCheckCronJob', 'alertResetCronJob']
    .forEach(k => { if (global[k]) global[k].stop(); });

  // 基金提醒
  global.cronJob = cron.schedule(cronTime, () => checkFundsAndAlert(),
    { timezone: 'Asia/Shanghai' });

  // 每日收益（周一到周五 23:00）
  global.profitCronJob = cron.schedule('0 0 23 * * 1-5', () => calculateAndSaveDailyProfit(),
    { timezone: 'Asia/Shanghai' });

  // 自动确认交易（每天 09:00）
  global.confirmCronJob = cron.schedule('0 3 0 * * *', () =>
    autoConfirmPendingTrades(invalidateCache, invalidateCacheByPrefix),
    { timezone: 'Asia/Shanghai' });

  // 股票涨跌幅提醒（交易时间每分钟）
  global.alertCheckCronJob = cron.schedule('* 9-11,13-14 * * 1-5', () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute <= 30);
    const isAfternoon = hour === 13 || hour === 14 || (hour === 15 && minute === 0);
    if (isMorning || isAfternoon) checkPriceAlerts(fetchQuotesBatch, sendWechatMessage);
  }, { timezone: 'Asia/Shanghai' });

  // 开盘前重置提醒状态
  global.alertResetCronJob = cron.schedule('25 9 * * 1-5', () => {
    console.log('重置股票涨跌幅提醒状态...');
    db.resetAlertRulesDaily();
  }, { timezone: 'Asia/Shanghai' });

  console.log(`定时任务已设置: 基金提醒 ${cronTime}, 收益计算 23:00(工作日), 自动确认 09:00, 涨跌提醒 交易时间`);
}

// ==================== 启动服务器 ====================
async function startServer() {
  try {
    await db.initDatabase();
    await db.runMigration();
    console.log('数据库连接初始化完成');

    await initConfig();
    await setupCronJob();

    server.listen(PORT, () => {
      console.log(`\n服务器运行在 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();

// ==================== HTTP 路由调度 ====================
const ctx = { sendCachedJson, invalidateCache, invalidateCacheByPrefix, QUOTES_CACHE_TTL_MS, KLINE_CACHE_TTL_MS, loadCodeFixMap, fetchQuotesBatch, sendWechatMessage };

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // 认证路由（无需登录）
  if (await handleAuthRoutes(req, res)) return;

  // 鉴权
  const isPublic = !req.url.startsWith('/api/') || req.url === '/api/config' || req.url.startsWith('/api/trigger-') || req.url.startsWith('/api/indices');
  const auth = isPublic ? { uid: 'default' } : authRequired(req, res);
  if (!auth) return;
  const userId = auth.uid || 'default';
  if (!global._adminEmail) { global._adminEmail = process.env.ADMIN_EMAIL || (await db.getConfig('admin_email')) || ''; }
  const isAdmin = !!(auth?.email && global._adminEmail && auth.email === global._adminEmail);

  // 分发到各路由模块
  if (await handleConfigRoutes(req, res, { isAdmin, sendCachedJson, invalidateCache })) return;
  if (await handlePositionRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix, loadCodeFixMap })) return;
  if (await handleTradeRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix })) return;
  if (await handleCategoryRoutes(req, res, { isAdmin, sendCachedJson, invalidateCache })) return;
  if (await handleAssetRoutes(req, res, { userId, sendCachedJson, invalidateCache })) return;
  if (await handleDailyProfitRoutes(req, res, userId)) return;
  if (await handleAlertRulesRoutes(req, res, ctx)) return;
  if (await handleFundRoutes(req, res, { userId, sendCachedJson, invalidateCache, invalidateCacheByPrefix })) return;
  if (await handleMarketRoutes(req, res, { userId, sendCachedJson, QUOTES_CACHE_TTL_MS, KLINE_CACHE_TTL_MS })) return;
  if (await handleFundScreenshotRoutes(req, res, { fetchQuotesBatch })) return;

  // 手动触发 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-check') {
    checkFundsAndAlert();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '检查已触发' }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/trigger-profit') {
    calculateAndSaveDailyProfit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '每日收益计算已触发' }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/trigger-confirm') {
    autoConfirmPendingTrades(invalidateCache, invalidateCacheByPrefix);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '自动确认交易已触发' }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});
