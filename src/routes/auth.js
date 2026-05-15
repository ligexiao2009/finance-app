/**
 * 认证路由 — 注册、登录、重发验证码
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../db/db');
const { signToken, JWT_SECRET, JWT_EXPIRES } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ========== 邮件服务 ==========
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (process.env.SMTP_HOST) {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465'),
      secure: process.env.SMTP_SECURE !== 'false',
      auth: { user: process.env.EMAIL_SENDER, pass: process.env.EMAIL_PASSWORD },
    });
  }
  return mailer;
}

async function sendVerifyCode(email, code) {
  const transport = getMailer();
  if (!transport) return false;
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_SENDER,
      to: email,
      subject: '投资助手 - 邮箱验证码',
      text: `您的验证码是：${code}，10分钟内有效。`,
    });
    return true;
  } catch (e) {
    console.error('发送邮件失败:', e.message);
    return false;
  }
}

// ========== 路由处理 ==========
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleAuthRoutes(req, res) {
  // POST /api/register
  if (req.method === 'POST' && req.url === '/api/register') {
    try {
      const { email, password, code } = await parseBody(req);
      if (!email || !password || password.length < 4) {
        sendJson(res, 400, { error: '邮箱不能为空，密码至少4位' });
        return true;
      }

      const existCheck = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existCheck.rows.length > 0) {
        sendJson(res, 409, { error: '该邮箱已注册' });
        return true;
      }

      const verifyConfig = await db.getConfig('require_email_verify');
      if (verifyConfig === 'true' || verifyConfig === true) {
        if (!code) {
          const verifyCode = String(Math.floor(100000 + Math.random() * 900000));
          global.pendingVerifies = global.pendingVerifies || {};
          global.pendingVerifies[email] = { code: verifyCode, expires: Date.now() + 10 * 60 * 1000 };
          const sent = await sendVerifyCode(email, verifyCode);
          sendJson(res, 200, { needVerify: true, message: sent ? '验证码已发送' : '验证码发送失败，请检查邮箱' });
          return true;
        }
        const pending = (global.pendingVerifies || {})[email];
        if (!pending || pending.code !== code || pending.expires < Date.now()) {
          sendJson(res, 400, { error: '验证码错误或已过期' });
          return true;
        }
        delete global.pendingVerifies[email];
      }

      const hash = await bcrypt.hash(password, 10);
      const uid = crypto.randomBytes(12).toString('hex');
      await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [uid, email, hash]);
      const token = jwt.sign({ uid, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      sendJson(res, 200, { token, uid, email });
    } catch (e) {
      if (e.code === '23505') {
        sendJson(res, 409, { error: '该邮箱已注册' });
      } else {
        sendJson(res, 500, { error: e.message });
      }
    }
    return true;
  }

  // POST /api/resend-code
  if (req.method === 'POST' && req.url === '/api/resend-code') {
    try {
      const { email } = await parseBody(req);
      if (!email) { sendJson(res, 400, { error: '缺少邮箱' }); return true; }
      const verifyCode = String(Math.floor(100000 + Math.random() * 900000));
      global.pendingVerifies = global.pendingVerifies || {};
      global.pendingVerifies[email] = { code: verifyCode, expires: Date.now() + 10 * 60 * 1000 };
      const sent = await sendVerifyCode(email, verifyCode);
      sendJson(res, 200, { success: sent, message: sent ? '验证码已重新发送' : '发送失败' });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  // POST /api/login
  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const { email, password } = await parseBody(req);
      const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        sendJson(res, 401, { error: '邮箱或密码错误' });
        return true;
      }
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        sendJson(res, 401, { error: '邮箱或密码错误' });
        return true;
      }
      const token = jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      sendJson(res, 200, { token, uid: user.id, email: user.email });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };
