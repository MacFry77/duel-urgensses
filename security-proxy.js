const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT) || 3000;
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT) || 3100;
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || 'https://duel-urgensses.onrender.com').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set([PUBLIC_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000']);
const windows = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function limited(req, limit = 180, windowMs = 60_000) {
  const key = clientIp(req), now = Date.now();
  let entry = windows.get(key);
  if (!entry || now - entry.start >= windowMs) entry = { start: now, count: 0 };
  entry.count++;
  windows.set(key, entry);
  return entry.count > limit;
}
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, value] of windows) if (value.start < cutoff) windows.delete(key);
}, 60_000).unref();

function secureEqual(a, b) {
  const aa = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function adminAuthorized(req) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return secureEqual(decoded.slice(0, separator), ADMIN_USER) && secureEqual(decoded.slice(separator + 1), ADMIN_PASSWORD);
}
function isAdminPath(url = '') {
  const pathname = String(url).split('?')[0];
  return pathname === '/admin-stats' || pathname === '/admin-stats.html' || pathname === '/admin-stats.js' || pathname === '/admin-stats.css' || pathname === '/api/admin/stats';
}
function securityHeaders(headers = {}) {
  return {
    ...headers,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  };
}

const child = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(INTERNAL_PORT) }
});
child.on('exit', code => process.exit(code ?? 1));

const proxy = http.createServer((req, res) => {
  if (limited(req)) {
    res.writeHead(429, securityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' }));
    return res.end('Trop de requêtes. Réessayez dans un instant.');
  }
  if (isAdminPath(req.url) && !adminAuthorized(req)) {
    res.writeHead(401, securityHeaders({
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': 'Basic realm="Duel Urgensses administration", charset="UTF-8"'
    }));
    return res.end('Authentification requise.');
  }
  const upstream = http.request({
    hostname: '127.0.0.1', port: INTERNAL_PORT, method: req.method, path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${INTERNAL_PORT}` }
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, securityHeaders(upstreamRes.headers));
    upstreamRes.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Serveur momentanément indisponible.');
  });
  req.pipe(upstream);
});

proxy.on('upgrade', (req, socket, head) => {
  if (limited(req, 60, 60_000)) return socket.destroy();
  const origin = String(req.headers.origin || '');
  if (!ALLOWED_ORIGINS.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const upstream = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    let request = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.toLowerCase() === 'host') request += `host: 127.0.0.1:${INTERNAL_PORT}\r\n`;
      else if (Array.isArray(value)) value.forEach(v => request += `${name}: ${v}\r\n`);
      else if (value !== undefined) request += `${name}: ${value}\r\n`;
    }
    request += '\r\n';
    upstream.write(request);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

proxy.listen(PUBLIC_PORT, () => console.log(`Passerelle sécurisée sur le port ${PUBLIC_PORT} -> ${INTERNAL_PORT}`));
