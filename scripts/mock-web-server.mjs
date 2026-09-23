// 本地模拟 nginx 运行时：/healthz + dist 静态文件（容器内由 nginx 提供）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  try {
    const rel = url === '/' ? 'index.html' : normalize(url).replace(/^\/+/, '');
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8090, () => console.log('mock-web on 8090'));
