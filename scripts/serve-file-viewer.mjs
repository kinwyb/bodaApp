#!/usr/bin/env node
/**
 * file-viewer 独立站的本地静态服务（零依赖，node 直接跑）。
 *
 *   npm run file-viewer:serve            # 默认 http://127.0.0.1:8090
 *   PORT=9000 npm run file-viewer:serve
 *
 * 开发时 vite 把 /file-viewer 代理到这里（见 vite.config.ts），iframe 因此同源。
 * 生产请改用 nginx 等托管 services/file-viewer/site/，本脚本只为开发便利。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(HERE, '..', 'services', 'file-viewer', 'site');
const PORT = Number(process.env.PORT || 8090);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(SITE_DIR, 'iframe.html'))) {
  console.error('[file-viewer] 站点未安装，先执行：npm run file-viewer:setup');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = path.normalize(path.join(SITE_DIR, pathname));
  // 越界防护：解析后的路径必须仍在站点目录内
  if (!target.startsWith(SITE_DIR + path.sep) && target !== SITE_DIR) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      // worker/wasm 版本随站点目录整体替换，开发态禁用缓存最省心
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[file-viewer] serving ${SITE_DIR} at http://127.0.0.1:${PORT}/`);
});
