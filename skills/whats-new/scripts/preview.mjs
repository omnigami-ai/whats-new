// Local review: node scripts/preview.mjs <film-dir> [--port 4322] [--out dir]
// Word edits are saved inside the film for subsequent checks and renders.
import { createServer } from 'node:http';
import { readFile, writeFile, realpath, stat, rename } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
if (!args[0] || args[0].startsWith('--')) throw new Error('usage: node scripts/preview.mjs <film-dir> [--port 4322] [--out dir]');
const film = await realpath(path.resolve(args[0]));
await stat(path.join(film, 'index.html'));
const out = path.resolve(opt('out', path.join(film, '..', 'out')));
const html = await readFile(new URL('./preview.html', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
let origin;
const server = createServer(async (req, res) => {
  const reply = (code, body, type = 'text/plain') => res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  // The editor is for this localhost page, including its save endpoint.
  if (req.headers.host !== new URL(origin).host) return reply(403, 'Invalid host');
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/values' && req.method === 'POST') {
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(403, 'Save from the preview page');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) return reply(413, 'Too many words');
      }
      const values = JSON.parse(body);
      if (!values || Array.isArray(values) || typeof values !== 'object' || Object.entries(values).some(([key, value]) =>
        ['__proto__', 'constructor', 'prototype'].includes(key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) return reply(400, 'Invalid field values');
      const tmp = path.join(film, 'values.json.tmp');
      await writeFile(tmp, JSON.stringify(values, null, 2) + '\n');
      await rename(tmp, path.join(film, 'values.json'));
      return reply(200, '{}', 'application/json');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'Method not allowed');
    if (url.pathname === '/') return reply(200, req.method === 'HEAD' ? '' : html, 'text/html');
    if (url.pathname === '/values') {
      let values = '{}';
      try { values = await readFile(path.join(film, 'values.json'), 'utf8'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
      return reply(200, values, 'application/json');
    }
    let root, relative;
    if (url.pathname.startsWith('/film/')) { root = film; relative = decodeURIComponent(url.pathname.slice(6)); }
    else if (/^\/video\/(1x1|16x9|9x16|886x1920)\.mp4$/.test(url.pathname)) { root = await realpath(out); relative = url.pathname.slice(7); }
    else return reply(404, 'Not found');
    const file = await realpath(path.resolve(root, relative));
    if (!file.startsWith(root + path.sep)) return reply(403, 'Outside the film');
    const body = await readFile(file);
    if (path.extname(file) === '.mp4') {
      let start = 0, end = body.length - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) return res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end();
        start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
        if (start > end || start >= body.length || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end();
      }
      res.writeHead(req.headers.range ? 206 : 200, {
        'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1,
        ...(req.headers.range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
        'cache-control': 'no-store',
      });
      return res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-length': body.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    reply(err.code === 'ENOENT' ? 404 : 400, err.code === 'ENOENT' ? 'Not found' : 'Could not read or save the film');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(opt('port', '0')), '127.0.0.1', resolve);
});
origin = `http://127.0.0.1:${server.address().port}`;
console.log(`Preview: ${origin}\nWord edits save to ${path.join(film, 'values.json')}\nRender again to update the MP4. Ctrl+C stops the preview.`);
