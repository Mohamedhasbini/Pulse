// Delivery layer for the dashboard: compressed responses, fingerprinted assets that browsers may cache for a year,
// a short-lived cache of the signed-in user, and the content security policy. No dependencies: Node's zlib only.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------- compression: gzip or brotli for text answers (JSON, HTML, JS, CSS, SVG); streams (SSE) stay untouched ----------
const TEXT = /^(text\/|application\/(json|javascript|manifest\+json|xml)|image\/svg)/;
export function compress() {
  return (req, res, next) => {
    const accept = req.get('accept-encoding') || '';
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!enc || req.method === 'HEAD') return next();
    const write = res.write.bind(res), end = res.end.bind(res);
    let z = null, decided = false;
    const decide = () => {
      decided = true;
      const type = String(res.get('content-type') || '');
      if (res.statusCode === 204 || res.statusCode === 304 || res.get('content-encoding') || !TEXT.test(type) || /event-stream/.test(type)) return;
      const len = +res.get('content-length'); if (len && len < 1024) return; // small answers are not worth the CPU
      res.removeHeader('content-length'); res.set({ 'Content-Encoding': enc, Vary: 'Accept-Encoding' });
      z = enc === 'br' ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) : zlib.createGzip({ level: 6 });
      // piped files wait for the response's 'drain' when a write returns false: pass the compressor's drain through
      z.on('data', c => write(c)); z.on('end', () => end()); z.on('drain', () => res.emit('drain'));
    };
    res.write = (chunk, ...a) => { if (!decided) decide(); return z ? z.write(chunk) : write(chunk, ...a); };
    res.end = (chunk, ...a) => { if (!decided) decide(); if (!z) return end(chunk, ...a); if (chunk) z.write(chunk); z.end(); return res; };
    next();
  };
}

// ---------- fingerprinted assets: /charts.js?v=<content hash>, cacheable for a year; index.html is rewritten to point at them ----------
const hashes = new Map(); // "/charts.js" -> 10-char content hash
export function fingerprint(PUBLIC) {
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|css|svg|webmanifest|woff2?)$/.test(f.name)) hashes.set('/' + path.relative(PUBLIC, p).split(path.sep).join('/'), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10));
  } };
  walk(PUBLIC);
  let html = null, seen = 0;
  const index = () => {
    const st = fs.statSync(path.join(PUBLIC, 'index.html'));
    if (!html || st.mtimeMs !== seen) {
      seen = st.mtimeMs;
      html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/(src|href)="(\/[^"?]+)(\?v=[^"]*)?"/g, (m, attr, file) => hashes.has(file) ? `${attr}="${file}?v=${hashes.get(file)}"` : m);
    }
    return html;
  };
  return {
    // the dashboard page itself: never cached, assets inside it fingerprinted
    page: (_req, res) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(index()),
    // express.static setHeaders: a request that names the current content hash may be kept for a year
    headers: (res, file) => {
      const rel = '/' + path.relative(PUBLIC, file).split(path.sep).join('/'), v = res.req?.query?.v;
      res.set('Cache-Control', v && hashes.get(rel) === v ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
    version: file => hashes.get(file),
  };
}

// ---------- the signed-in user, remembered for a few seconds so sixty asset requests don't mean sixty user lookups ----------
const users = new Map(); // uid -> { user, at }
const USER_TTL = 10000;
export const rememberUser = (uid, user) => { users.set(uid, { user, at: Date.now() }); if (users.size > 5000) users.delete(users.keys().next().value); };
export const recallUser = uid => { const e = users.get(uid); return e && Date.now() - e.at < USER_TTL ? e.user : null; };
export const forgetUser = uid => users.delete(uid);

// ---------- content security policy for the app pages (dashboard and sign-in) ----------
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'self' https: http:", // the Website tab previews the client's site on its own domain
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');
