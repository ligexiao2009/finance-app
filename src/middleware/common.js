/**
 * 通用中间件：JSON body 解析、响应工具
 */

// 解析 POST 请求的 JSON body
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

// JSON 响应便捷方法
function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function ok(res, data = { success: true }) { sendJson(res, 200, data); }
function badRequest(res, msg) { sendJson(res, 400, { error: msg }); }
function serverError(res, msg) { sendJson(res, 500, { error: msg }); }

module.exports = { parseBody, sendJson, ok, badRequest, serverError };
