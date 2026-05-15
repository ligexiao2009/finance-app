/**
 * Server酱 微信通知服务
 */
const db = require('../db/db');

let SERVERCHAN_KEY = '';

async function initServerchanKey() {
  const key = process.env.SERVERCHAN_KEY || await db.getConfig('serverchanKey') || '';
  SERVERCHAN_KEY = key;
  if (!key) console.log('Server酱 Key 未设置，无法发送微信通知');
}

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
      body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(content)}`,
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

module.exports = { sendWechatMessage, initServerchanKey, getServerchanKey: () => SERVERCHAN_KEY };
