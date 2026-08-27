// tools/dev-server.mjs — the whole site, locally, including /api.
//
//   node tools/dev-server.mjs [port]
//
// Vercel serves the static files and runs api/*.js as functions; this does both so you can
// exercise a real checkout against PayPal sandbox without deploying. Reads .env if present.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.argv[2] || 8123);

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  console.log('· loaded .env');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.sql': 'text/plain; charset=utf-8' };

/** Give the handler the small slice of Vercel's req/res API that api/*.js actually uses. */
function shim(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = c => { res.statusCode = c; return res; };
  res.send = body => { res.end(body); return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  return { req, res };
}

const readJson = req => new Promise(resolve => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const t0 = Date.now();

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `No such endpoint: /api/${name}` }));
    }
    try {
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);   // reload on each hit
      shim(req, res, url);
      if (req.method === 'POST' && mod.config?.api?.bodyParser !== false) req.body = await readJson(req);
      await mod.default(req, res);
    } catch (err) {
      console.error(`  ! /api/${name}`, err);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    }
    console.log(`${req.method} ${url.pathname} → ${res.statusCode} ${Date.now() - t0}ms`);
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  const have = k => process.env[k] ? 'set' : 'MISSING';
  console.log(`\n  Brand My 911 → http://localhost:${PORT}\n`);
  console.log(`  SUPABASE_URL              ${have('SUPABASE_URL')}`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY ${have('SUPABASE_SERVICE_ROLE_KEY')}`);
  console.log(`  PAYPAL_CLIENT_ID          ${have('PAYPAL_CLIENT_ID')}  (${process.env.PAYPAL_ENV || 'sandbox'})`);
  console.log(`  PAYPAL_WEBHOOK_ID         ${have('PAYPAL_WEBHOOK_ID')}`);
  console.log(`\n  Without those, /api answers with a clear 500 and the board still renders.\n`);
});
