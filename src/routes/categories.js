/**
 * 分类 CRUD 路由
 */
const db = require('../db/db');

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

async function handleCategoryRoutes(req, res, { isAdmin, sendCachedJson, invalidateCache }) {
  // GET /api/categories
  if (req.method === 'GET' && req.url === '/api/categories') {
    try {
      await sendCachedJson(req, res, 'categories', async () => {
        return await db.getCategories();
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Failed to get categories' });
    }
    return true;
  }

  // POST /api/categories — 新建
  if (req.method === 'POST' && req.url === '/api/categories') {
    try {
      const { id, name, sortOrder } = await readJsonBody(req);
      await db.createCategory({ id: id || Date.now().toString(), name, sortOrder: sortOrder || 0 });
      invalidateCache('categories');
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // PUT /api/categories/:id — 更新
  if (req.method === 'PUT' && req.url.startsWith('/api/categories/')) {
    const id = req.url.split('/api/categories/')[1];
    try {
      const { name, sortOrder } = await readJsonBody(req);
      await db.updateCategory(id, { name, sortOrder });
      invalidateCache('categories');
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // DELETE /api/categories/:id — 删除
  if (req.method === 'DELETE' && req.url.startsWith('/api/categories/')) {
    const id = req.url.split('/api/categories/')[1];
    try {
      await db.deleteCategory(id);
      invalidateCache('categories');
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  // POST /api/admin/categories/sort — 排序（管理员）
  if (isAdmin && req.method === 'POST' && req.url === '/api/admin/categories/sort') {
    try {
      const { ids } = await readJsonBody(req);
      for (let i = 0; i < ids.length; i++) {
        await db.query('UPDATE categories SET sort_order = $1 WHERE id = $2', [i, ids[i]]);
      }
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 400, { success: false, message: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleCategoryRoutes };
