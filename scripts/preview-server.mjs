import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { sites } from './sites.mjs';
const root = new URL('../', import.meta.url);
const allowed = new Set(['/', '/index.html', '/assets/contact-form.js', '/assets/contact-form.css', ...sites.flatMap(s => [`/${s.id}/`, `/${s.id}/index.html`])]);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method !== 'GET' || !allowed.has(path)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const file = path.endsWith('/') ? path + 'index.html' : path;
    const body = await readFile(new URL('.' + file, root));
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(8788, '127.0.0.1', () => console.log('Preview server: http://127.0.0.1:8788 (demo forms only; no emails sent)'));
