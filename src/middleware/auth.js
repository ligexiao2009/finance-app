/**
 * JWT 认证中间件
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'stock-app-secret-key-change-in-production';
const JWT_EXPIRES = '30d';

// 签发 token
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// 验证 token，返回 payload 或 null
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (_) { return null; }
}

// HTTP 请求中提取并验证 token
function authRequired(req, res) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未登录或登录已过期' }));
    return null;
  }
  return payload;
}

module.exports = { signToken, verifyToken, authRequired, JWT_SECRET, JWT_EXPIRES };
