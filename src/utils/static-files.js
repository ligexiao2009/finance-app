const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', '..', 'public');

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function resolvePublicPath(urlPath) {
  const normalizedPath = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, '');
  return path.join(publicDir, safePath);
}

function servePublicFile(req, res, urlPath) {
  const filePath = resolvePublicPath(urlPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, { 'Content-Type': getContentType(filePath) });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  fs.createReadStream(filePath).pipe(res);
  return true;
}

module.exports = {
  servePublicFile,
};
