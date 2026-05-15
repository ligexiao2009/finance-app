/**
 * 内存缓存中间件 — ETag / If-None-Match + TTL
 */
const crypto = require('crypto');

const store = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

// 行情数据缓存 TTL 常量
const QUOTES_CACHE_TTL_MS = Number(process.env.QUOTES_CACHE_TTL_MS || 30000);
const KLINE_CACHE_TTL_MS = Number(process.env.KLINE_CACHE_TTL_MS || 5 * 60 * 1000);

function makeETag(data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').substring(0, 16);
}

/** 带缓存的 JSON 响应。如果客户端发来 If-None-Match 且匹配，返回 304。 */
async function sendCachedJson(req, res, key, dataFn, opts = {}) {
  const { ttlMs = DEFAULT_TTL_MS, bypassCache = false } = opts;

  // 检查 If-None-Match
  const clientETag = req.headers['if-none-match'];
  const cached = store.get(key);

  if (!bypassCache && cached && clientETag && cached.etag === clientETag) {
    res.writeHead(304, { 'ETag': cached.etag });
    res.end();
    return;
  }

  // 缓存命中且未过期
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'ETag': cached.etag,
      'Cache-Control': `max-age=${Math.floor(ttlMs / 1000)}`,
    });
    res.end(cached.body);
    return;
  }

  // 执行数据获取函数
  const data = await dataFn();
  const body = JSON.stringify(data);
  const etag = makeETag(body);

  store.set(key, { body, etag, expiresAt: Date.now() + ttlMs });

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'ETag': etag,
    'Cache-Control': `max-age=${Math.floor(ttlMs / 1000)}`,
  });
  res.end(body);
}

/** 使指定缓存键失效 */
function invalidateCache(...keys) {
  for (const key of keys) {
    store.delete(key);
  }
}

/** 按前缀失效缓存 */
function invalidateCacheByPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

module.exports = {
  sendCachedJson,
  invalidateCache,
  invalidateCacheByPrefix,
  QUOTES_CACHE_TTL_MS,
  KLINE_CACHE_TTL_MS,
};
