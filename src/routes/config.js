/**
 * 配置 + 管理员路由
 */
const db = require('../db/db');

let EDIT_UNLOCK_PASSWORD_CACHE = undefined;

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

async function getEditUnlockPassword() {
  if (EDIT_UNLOCK_PASSWORD_CACHE !== undefined) return EDIT_UNLOCK_PASSWORD_CACHE;
  const password = process.env.EDIT_UNLOCK_PASSWORD || await db.getConfig('editUnlockPassword') || '8957';
  EDIT_UNLOCK_PASSWORD_CACHE = password;
  return password;
}

async function handleConfigRoutes(req, res, { isAdmin, sendCachedJson, invalidateCache }) {
  // GET /api/config — 公开汇率
  if (req.method === 'GET' && req.url === '/api/config') {
    if (!global._cachedRates) {
      global._cachedRates = {
        hkd: await db.getConfig('hkd_cny_rate') || '0.93',
        usd: await db.getConfig('crypto_fx') || '7.25',
        admin: await db.getConfig('admin_email') || '',
      };
    }
    sendJson(res, 200, {
      hkd_cny_rate: global._cachedRates.hkd,
      crypto_fx: global._cachedRates.usd,
      admin_email: global._cachedRates.admin,
    });
    return true;
  }

  // POST /api/config — 设置配置
  if (req.method === 'POST' && req.url === '/api/config') {
    try {
      const { key, value } = await readJsonBody(req);
      await db.setConfig(key, String(value));
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  // GET /api/app-settings
  if (req.method === 'GET' && req.url === '/api/app-settings') {
    try {
      await sendCachedJson(req, res, 'app-settings', async () => ({
        requiresEditUnlock: process.env.REQUIRES_EDIT_UNLOCK,
      }));
    } catch (error) {
      sendJson(res, 500, { error: 'Failed to get app settings' });
    }
    return true;
  }

  // POST /api/verify-unlock
  if (req.method === 'POST' && req.url === '/api/verify-unlock') {
    try {
      const { password } = await readJsonBody(req);
      const unlockPassword = await getEditUnlockPassword();
      const success = password === unlockPassword;
      sendJson(res, success ? 200 : 401, { success, message: success ? '解锁成功' : '密码错误' });
    } catch (e) {
      console.error('Error verifying unlock password:', e);
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // ========== 管理员 API ==========

  // GET /api/admin/configs
  if (isAdmin && req.method === 'GET' && req.url === '/api/admin/configs') {
    const configs = await db.getAllConfigs();
    sendJson(res, 200, configs);
    return true;
  }

  // POST /api/admin/config
  if (isAdmin && req.method === 'POST' && req.url === '/api/admin/config') {
    try {
      const { key, value } = await readJsonBody(req);
      await db.setConfig(key, value);
      global._adminEmail = undefined;
      global._cachedRates = undefined;
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleConfigRoutes };
