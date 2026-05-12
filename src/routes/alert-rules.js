/**
 * 股票涨跌幅提醒路由模块
 */

const db = require('../db/db');

// ==================== 缓存配置 ====================
// 价格缓存，避免频繁请求
const priceCheckCache = new Map();

// 数据库查询缓存
let alertRulesCache = { data: null, expiresAt: 0 };
let positionsCache = { data: null, expiresAt: 0 };
const DB_CACHE_TTL = 90 * 1000 * 1000; // 90秒缓存，覆盖下一个检查周期
const PRICE_CHECK_CACHE_TTL = 10 * 1000; // 45秒价格缓存

// ==================== 缓存函数 ====================
async function getCachedAlertRules() {
  const now = Date.now();
  if (alertRulesCache.data && alertRulesCache.expiresAt > now) {
    return alertRulesCache.data;
  }
  const rules = await db.getEnabledAlertRules();
  alertRulesCache = { data: rules, expiresAt: now + DB_CACHE_TTL };
  return rules;
}

async function getCachedPositions() {
  const now = Date.now();
  if (positionsCache.data && positionsCache.expiresAt > now) {
    return positionsCache.data;
  }
  const positions = await db.getPositions();
  positionsCache = { data: positions, expiresAt: now + DB_CACHE_TTL };
  return positions;
}

// 清除缓存（在规则变更时调用）
function invalidateAlertCache() {
  alertRulesCache = { data: null, expiresAt: 0 };
  positionsCache = { data: null, expiresAt: 0 };
}

// ==================== 核心检查函数 ====================
async function checkPriceAlerts(fetchQuotesBatch, sendWechatMessage) {
  console.log('\n========== 开始检查股票涨跌幅提醒 ==========');
  
  // 获取所有启用的提醒规则（带缓存）
  const rules = await getCachedAlertRules();
  
  if (rules.length === 0) {
    console.log('没有需要检查的股票涨跌幅提醒规则');
    console.log('========== 检查完成 ==========\n');
    return;
  }

  // 过滤掉今天已触发的规则
  const rulesToCheck = rules.filter(rule => !rule.triggeredToday);
  
  if (rulesToCheck.length === 0) {
    console.log('所有规则今天已触发过，跳过检查');
    console.log('========== 检查完成 ==========\n');
    return;
  }

  // 获取所有涉及的持仓（带缓存）
  const positions = await getCachedPositions();
  const positionMap = new Map(positions.map(p => [p.id, p]));

  // 收集需要获取价格的股票代码（去重）
  const stockCodes = new Set();
  for (const rule of rulesToCheck) {
    const position = positionMap.get(rule.positionId);
    if (position && !position.isFund && position.code) {
      stockCodes.add(position.code);
    }
  }

  if (stockCodes.size === 0) {
    console.log('没有需要检查的股票');
    console.log('========== 检查完成 ==========\n');
    return;
  }

  // 批量获取股票价格（带缓存）
  const now = Date.now();
  const quotes = {};
  const codesToFetch = [];

  // 检查缓存
  for (const code of stockCodes) {
    const cached = priceCheckCache.get(code);
    if (cached && cached.expiresAt > now) {
      quotes[code] = cached.data;
    } else {
      codesToFetch.push(code);
    }
  }

  // 批量获取未缓存的股票价格
  if (codesToFetch.length > 0) {
    console.log(`批量获取 ${codesToFetch.length} 只股票价格...`);
    const items = codesToFetch.map(code => ({ code, isFund: false }));
    const freshQuotes = await fetchQuotesBatch(items);
    
    // 存入缓存
    for (const [key, data] of Object.entries(freshQuotes)) {
      const code = data.code;
      if (code) {
        priceCheckCache.set(code, {
          data: { price: data.price, change: data.change, name: data.name },
          expiresAt: now + PRICE_CHECK_CACHE_TTL
        });
        quotes[code] = data;
      }
    }
  }

  const alerts = [];

  for (const rule of rulesToCheck) {
    const position = positionMap.get(rule.positionId);
    if (!position || position.isFund) {
      continue;
    }

    const stockData = quotes[position.code];
    if (!stockData || stockData.price <= 0) continue;

    const changePercent = stockData.change;
    console.log(`检查股票: ${position.name || position.code}, 涨跌: ${changePercent}%, 规则: ${rule.direction} >= ${rule.threshold}%`);

    // 判断是否达到阈值
    let shouldAlert = false;
    if (rule.direction === 'up' && changePercent >= rule.threshold) {
      shouldAlert = true;
    } else if (rule.direction === 'down' && changePercent <= -rule.threshold) {
      shouldAlert = true;
    } else if (rule.direction === 'both' && (changePercent >= rule.threshold || changePercent <= -rule.threshold)) {
      shouldAlert = true;
    }

    if (shouldAlert) {
      alerts.push({
        rule,
        position,
        stockData,
        changePercent
      });
    }
  }

  if (alerts.length > 0) {
    console.log(`\n有 ${alerts.length} 条提醒达到阈值`);

    let title = '【股票提醒】';
    let content = '## 股票涨跌幅提醒\n\n';

    for (const alert of alerts) {
      const { rule, position, stockData, changePercent } = alert;
      const isUp = changePercent >= 0;
      const directionText = rule.direction === 'both' ? (isUp ? '涨' : '跌') : (rule.direction === 'up' ? '涨' : '跌');
      const changeStr = changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
      
      title += `${position.name} ${changeStr} `;
      
      content += `### ${directionText} ${position.name} (${position.code})\n\n`;
      content += `- 当前价格: ¥${stockData.price.toFixed(2)}\n`;
      content += `- 当日涨跌幅: ${changeStr}\n`;
      content += `- 提醒阈值: ${rule.direction === 'both' ? '涨跌幅' : (rule.direction === 'up' ? '涨幅' : '跌幅')} >= ${rule.threshold}%\n`;
      content += `- 触发时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;

      // 更新规则状态为已触发
      await db.updateAlertRule(rule.id, {
        triggeredToday: true,
        triggerTime: new Date().toISOString()
      });
    }

    await sendWechatMessage(title.slice(0, 100), content);
  } else {
    console.log('没有股票达到提醒阈值');
  }

  console.log('========== 检查完成 ==========\n');
}

// ==================== 路由处理 ====================
async function handleAlertRulesRoutes(req, res, { sendCachedJson, invalidateCache, fetchQuotesBatch, sendWechatMessage }) {
  // 获取所有提醒规则（按position_id分组）
  if (req.method === 'GET' && req.url === '/api/alert-rules') {
    try {
      await sendCachedJson(req, res, 'alert-rules', async () => {
        const rules = await db.getAlertRules();
        // 按 position_id 分组
        const grouped = {};
        for (const rule of rules) {
          if (!grouped[rule.positionId]) {
            grouped[rule.positionId] = [];
          }
          grouped[rule.positionId].push(rule);
        }
        return { rules: grouped };
      });
    } catch (error) {
      console.error('Error getting alert rules:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get alert rules' }));
    }
    return true;
  }

  // 获取某持仓的提醒规则
  if (req.method === 'GET' && req.url.startsWith('/api/alert-rules/position/')) {
    try {
      const positionId = req.url.split('/api/alert-rules/position/')[1];
      const rules = await db.getAlertRulesByPositionId(positionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rules }));
    } catch (error) {
      console.error('Error getting alert rules by position:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get alert rules' }));
    }
    return true;
  }

  // 新增提醒规则
  if (req.method === 'POST' && req.url === '/api/alert-rules') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const rule = JSON.parse(body);
        // 检查该持仓是否已有3条规则
        const existingRules = await db.getAlertRulesByPositionId(rule.positionId);
        if (existingRules.length >= 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: '每只股票最多只能配置3条提醒规则' }));
          return;
        }
        rule.id = rule.id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
        await db.createAlertRule(rule);
        invalidateCache('alert-rules');
        invalidateAlertCache();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, rule }));
      } catch (e) {
        console.error('Error creating alert rule:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return true;
  }

  // 更新提醒规则
  if (req.method === 'PUT' && req.url.startsWith('/api/alert-rules/')) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const ruleId = req.url.split('/api/alert-rules/')[1];
        const updates = JSON.parse(body);
        await db.updateAlertRule(ruleId, updates);
        invalidateCache('alert-rules');
        invalidateAlertCache();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Error updating alert rule:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return true;
  }

  // 删除提醒规则
  if (req.method === 'DELETE' && req.url.startsWith('/api/alert-rules/')) {
    try {
      const ruleId = req.url.split('/api/alert-rules/')[1];
      await db.deleteAlertRule(ruleId);
      invalidateCache('alert-rules');
      invalidateAlertCache();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      console.error('Error deleting alert rule:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return true;
  }

  // 手动触发股票涨跌幅提醒检查 (测试用)
  if (req.method === 'GET' && req.url === '/api/trigger-alert-check') {
    checkPriceAlerts(fetchQuotesBatch, sendWechatMessage);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '股票涨跌幅提醒检查已触发' }));
    return true;
  }

  return false;
}

module.exports = {
  checkPriceAlerts,
  handleAlertRulesRoutes,
  invalidateAlertCache,
};
