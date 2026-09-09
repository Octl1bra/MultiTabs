// MultiTabs e2e 本地测试站。
//
// 一个 https（默认 8443）+ 一个 http（默认 8080，只给 getPartitionKey / 非 secure cookie 用例），
// 两个监听共用同一套路由，按 Host 头的主机名分发，端口忽略。零依赖。
//
//   import { startSite } from './server.mjs';
//   const site = await startSite({ port: 0, httpPort: 0 });   // 0 = 随机端口
//   site.port / site.httpPort / site.hits / site.reset() / await site.close()
//
// 或直接 `node server.mjs`（环境变量 PORT / HTTP_PORT 可改端口）。
// 路由表和用例映射见同目录 README.md。

import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureCerts, DEFAULT_CERT_DIR } from './certs.mjs';

const USER_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HOST_ALIASES = { '127.0.0.1': 'localhost', '::1': 'localhost' };
const NO_STORE = { 'Cache-Control': 'no-store' };

// ---------- 小工具 ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 嵌进 <script> 的 JS 字面量；转义 < 以免 </script> 提前闭合。
const js = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim(); // 同名取第一个（浏览器把最具体的排前面）
  }
  return out;
}

/** 解析 Cookie 头得到身份。raw 是原始 Cookie 头，没有则为 ''。 */
export function whoami(req) {
  const raw = req.headers.cookie ?? '';
  const c = parseCookies(raw);
  return { user: c.sid ?? null, who: c.who ?? null, raw };
}

function hostnameOf(req) {
  let h = (req.headers.host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']')); // [::1]:8443
  else if (h.includes(':')) h = h.slice(0, h.lastIndexOf(':')); // app.localtest.me:8443
  return HOST_ALIASES[h] ?? h;
}

const bump = (map, key) => {
  const n = (map.get(key) ?? 0) + 1;
  map.set(key, n);
  return n;
};

// ---------- 响应 ----------

function send(res, status, body, headers) {
  res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function page(ctx, body, { status = 200, head = '', headers = {} } = {}) {
  // head 放在 <head> 最前面（/inline 需要“第一个子元素是内联脚本”）
  const html =
    `<!doctype html>\n<html><head>${head}<meta charset="utf-8">` +
    `<title>${esc(ctx.host + ctx.url.pathname)}</title></head>\n<body>\n${body}\n</body></html>\n`;
  send(ctx.res, status, html, { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE, ...headers });
}

function json(ctx, obj, headers = {}) {
  send(ctx.res, 200, JSON.stringify(obj) + '\n', {
    'Content-Type': 'application/json; charset=utf-8',
    ...NO_STORE,
    ...headers,
  });
}

function text(res, status, body, headers = {}) {
  send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE, ...headers });
}

function redirect(ctx, location) {
  send(ctx.res, 302, `302 -> ${location}\n`, {
    Location: location,
    'Content-Type': 'text/plain; charset=utf-8',
    ...NO_STORE,
  });
}

function badRequest(ctx, msg) {
  page(ctx, `<div id="err">${esc(msg)}</div>`, { status: 400 });
}

// 只回显白名单里的 Origin。https 两个固定；请求从 http 监听进来时额外放行对应的 http origin。
function cors(ctx) {
  const { req, res } = ctx;
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = [`https://app.localtest.me:${ctx.port}`, `https://localhost:${ctx.port}`];
  if (!ctx.secure) allowed.push(`http://app.localtest.me:${ctx.httpPort}`, `http://localhost:${ctx.httpPort}`);
  if (!allowed.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ---------- 共享 handler ----------

function me(ctx) {
  cors(ctx);
  if (ctx.req.method === 'OPTIONS') {
    return send(ctx.res, 204, '', {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': ctx.req.headers['access-control-request-headers'] ?? 'content-type',
      ...NO_STORE,
    });
  }
  json(ctx, whoami(ctx.req));
}
me.methods = ['GET', 'HEAD', 'OPTIONS'];

const userDiv = (ctx) => `<div id="user">${esc(whoami(ctx.req).user ?? 'anonymous')}</div>`;

// ---------- app.localtest.me ----------

const app = {
  '/': (ctx) =>
    page(
      ctx,
      `${userDiv(ctx)}
<div id="cookie"></div>
<div id="ls"></div>
<script>
document.getElementById('cookie').textContent = document.cookie;
try { document.getElementById('ls').textContent = localStorage.getItem('token') ?? ''; }
catch (e) { document.getElementById('ls').textContent = 'err:' + e.name; }
</script>
<nav>
<a href="/login?user=A">login A</a> <a href="/login?user=B">login B</a> <a href="/me">me</a> <a href="/logout">logout</a>
<a href="/inline">inline</a> <a href="/profile">profile</a> <a href="/counter">counter</a> <a href="/open">open</a>
<a href="/with-third-party">with-third-party</a> <a href="/storage">storage</a> <a href="/sw">sw</a> <a href="/jscookie">jscookie</a>
<a href="/oauth/start?mode=redirect">oauth redirect</a> <a href="/oauth/start?mode=popup">oauth popup</a>
</nav>`,
    ),

  '/login': (ctx) => {
    const user = ctx.url.searchParams.get('user');
    if (!user || !USER_RE.test(user)) return badRequest(ctx, 'bad user');
    ctx.res.setHeader('Set-Cookie', [
      `sid=${user}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      `who=${user}; Domain=.localtest.me; Path=/; Secure`,
      `theme=dark; Path=/`,
    ]);
    page(
      ctx,
      `<div id="user">${esc(user)}</div>
<div id="done"></div>
<script>
try { localStorage.setItem('token', ${js(user)}); document.getElementById('done').textContent = 'ok'; }
catch (e) { document.getElementById('done').textContent = 'err:' + e.name; }
</script>`,
    );
  },

  '/me': me,

  '/logout': (ctx) =>
    page(ctx, `<div id="done">logged out</div>`, { headers: { 'Clear-Site-Data': '"cookies"' } }),

  '/inline': (ctx) =>
    page(
      ctx,
      `<div id="first"></div>
<script>document.getElementById('first').textContent = JSON.stringify(window.__first);</script>`,
      {
        head:
          `<script>try{window.__first={token:localStorage.getItem('token'),cookie:document.cookie,ls_len:localStorage.length}}` +
          `catch(e){window.__first={error:e.name}}</script>`,
      },
    ),

  '/profile': (ctx) => {
    const n = bump(ctx.hits, 'profile');
    const now = Date.now();
    page(ctx, `${userDiv(ctx)}\n<div id="served-at">${now}</div>\n<div id="hit">${n}</div>`, {
      headers: { 'Cache-Control': 'private, max-age=600', 'X-Served-At': String(now) },
    });
  },

  '/counter': (ctx) => {
    const n = bump(ctx.hits, 'counter');
    text(ctx.res, 200, `hit=${n}`, { 'Cache-Control': 'private, max-age=600', 'X-Served-At': String(Date.now()) });
  },

  '/open': (ctx) =>
    page(
      ctx,
      `<a id="plain" href="/">plain</a>
<a id="blank" target="_blank" href="/">blank</a>
<button id="win" onclick="window.open('/')">win</button>`,
    ),

  '/with-third-party': (ctx) =>
    page(ctx, `${userDiv(ctx)}\n<iframe id="tp" src="https://localhost:${ctx.port}/embed"></iframe>`),

  '/storage': (ctx) =>
    page(
      ctx,
      `<div id="ls_keys"></div>
<div id="idb"></div>
<div id="caches"></div>
<div id="done"></div>
<script>
(async () => {
  const $ = (id) => document.getElementById(id);
  const step = async (id, fn) => { try { $(id).textContent = await fn(); } catch (e) { $(id).textContent = 'err:' + e.name; } };
  await step('ls_keys', () => {
    localStorage.setItem('k', location.search.slice(1) || 'v');
    return Object.keys(localStorage).join(',');
  });
  await step('idb', async () => {
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('db1');
      r.onsuccess = () => { r.result.close(); resolve(); };
      r.onerror = () => reject(r.error);
    });
    return (await indexedDB.databases()).map((d) => d.name).join(',');
  });
  await step('caches', async () => {
    await caches.open('c1');
    return (await caches.keys()).join(',');
  });
  $('done').textContent = 'ok';
})();
</script>`,
    ),

  '/sw': (ctx) =>
    page(
      ctx,
      `<div id="sw"></div>
<script>
(async () => {
  const el = document.getElementById('sw');
  if (!('serviceWorker' in navigator)) { el.textContent = 'unavailable'; return; }
  try { await navigator.serviceWorker.register('/sw.js'); el.textContent = 'registered'; }
  catch (e) { el.textContent = 'blocked:' + e.name; }
})();
</script>`,
    ),

  '/sw.js': (ctx) =>
    send(ctx.res, 200, `self.addEventListener('fetch', () => {});\n`, {
      'Content-Type': 'application/javascript; charset=utf-8',
      ...NO_STORE,
    }),

  '/jscookie': (ctx) =>
    page(
      ctx,
      `<div id="cookie"></div>
<div id="me"></div>
<script>
(async () => {
  document.cookie = 'js=1; path=/';
  document.getElementById('cookie').textContent = document.cookie;
  try { const r = await fetch('/me', { credentials: 'include' }); document.getElementById('me').textContent = await r.text(); }
  catch (e) { document.getElementById('me').textContent = 'err:' + e.message; }
})();
</script>`,
    ),

  '/oauth/start': (ctx) => {
    const mode = ctx.url.searchParams.get('mode');
    if (mode !== 'redirect' && mode !== 'popup') return badRequest(ctx, 'bad mode');
    const user = ctx.url.searchParams.get('user') ?? '';
    const state = randomBytes(16).toString('hex');
    ctx.res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; Secure; HttpOnly`);

    const authorize = (redirectUri) => {
      const u = new URL(`https://localhost:${ctx.port}/authorize`);
      u.searchParams.set('state', state);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('user', user); // 透传，可为空
      return u.href;
    };

    if (mode === 'redirect') {
      return redirect(ctx, authorize(`https://app.localtest.me:${ctx.port}/callback`));
    }

    const url = authorize(`https://app.localtest.me:${ctx.port}/callback?popup=1`);
    page(
      ctx,
      `<div id="state">${state}</div>
<button id="go" data-url="${esc(url)}" onclick="window.open(this.dataset.url)">go</button>
<div id="me"></div>
<script>
window.addEventListener('message', async (ev) => {
  if (ev.data !== 'oauth-done') return;
  try { const r = await fetch('/me', { credentials: 'include' }); document.getElementById('me').textContent = await r.text(); }
  catch (e) { document.getElementById('me').textContent = 'err:' + e.message; }
});
</script>`,
    );
  },

  '/callback': (ctx) => {
    const q = ctx.url.searchParams;
    const code = q.get('code');
    const state = q.get('state');
    const expected = ctx.cookies.oauth_state;
    if (!state || !expected || expected !== state) {
      // 故意的：state cookie 没被注入回会话罐就会走到这里
      return page(
        ctx,
        `<div id="err">state mismatch</div>\n<div id="detail">cookie=${esc(expected ?? '')} query=${esc(state ?? '')}</div>`,
        { status: 400 },
      );
    }
    if (!code || !USER_RE.test(code)) return badRequest(ctx, 'bad code');
    ctx.res.setHeader('Set-Cookie', `sid=${code}; Path=/; Secure; HttpOnly; SameSite=Lax`);
    if (q.get('popup') === '1') {
      return page(
        ctx,
        `<div id="done">ok</div>
<script>window.opener && window.opener.postMessage('oauth-done', '*'); window.close();</script>`,
      );
    }
    redirect(ctx, '/');
  },
};

// ---------- api.localtest.me ----------

const api = { '/me': me };

// ---------- IdP：挂在 localhost 上（与 app 不同 eTLD+1，才算第三方；原来的 idp.localtest.me 在会话范围内，cookie 会进会话罐） ----------

const idp = {
  '/authorize': (ctx) => {
    const q = ctx.url.searchParams;
    const state = q.get('state') ?? '';
    const redirectUri = q.get('redirect_uri');
    const user = q.get('user');
    ctx.res.setHeader('Set-Cookie', 'idp_session=1; Path=/; Secure');

    let target;
    try {
      target = new URL(redirectUri);
    } catch {
      return badRequest(ctx, 'bad redirect_uri');
    }

    if (user) {
      // redirect_uri 可能自带 query（popup=1），用 searchParams 追加而不是字符串拼
      target.searchParams.append('code', user);
      target.searchParams.append('state', state);
      return redirect(ctx, target.href);
    }

    const pick = (u) => {
      const p = new URLSearchParams(ctx.url.search);
      p.set('user', u);
      return `?${p.toString()}`;
    };
    page(ctx, `<a id="pick-A" href="${esc(pick('A'))}">A</a>\n<a id="pick-B" href="${esc(pick('B'))}">B</a>`);
  },

  '/whoami': (ctx) => json(ctx, { idp: 'idp_session' in ctx.cookies }),
};

// ---------- localhost（第三方，eTLD+1 不同） ----------

const third = {
  '/embed': (ctx) =>
    page(
      ctx,
      `<div id="me"></div>
<script>
fetch(${js(`https://app.localtest.me:${ctx.port}/me`)}, { credentials: 'include' })
  .then((r) => r.text())
  .then((t) => { document.getElementById('me').textContent = t; },
        (e) => { document.getElementById('me').textContent = 'err:' + e.message; });
</script>`,
    ),
};

export const HOSTS = {
  'app.localtest.me': app,
  'api.localtest.me': api,
  localhost: { ...third, ...idp },
};

// ---------- 分发 ----------

function makeHandler(state) {
  return (req, res) => {
    const host = hostnameOf(req);
    res.setHeader('X-Site-Host', host);

    const routes = HOSTS[host];
    if (!routes) return text(res, 421, `421 unknown host: ${req.headers.host ?? ''}\n`);

    const secure = Boolean(req.socket.encrypted);
    const url = new URL(req.url ?? '/', `${secure ? 'https' : 'http'}://${host}`);
    const route = routes[url.pathname];
    if (!route) return text(res, 404, `404 ${host}${url.pathname}\n`);

    const methods = route.methods ?? ['GET', 'HEAD'];
    if (!methods.includes(req.method)) return text(res, 405, `405 ${req.method}\n`, { Allow: methods.join(', ') });

    const ctx = {
      req,
      res,
      url,
      host,
      secure,
      port: state.port,
      httpPort: state.httpPort,
      hits: state.hits,
      cookies: parseCookies(req.headers.cookie),
    };
    try {
      route(ctx);
    } catch (e) {
      if (!res.headersSent) text(res, 500, `500 ${e?.stack ?? e}\n`);
      else res.destroy();
    }
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function shutdown(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/**
 * @param {{ port?: number, httpPort?: number, certDir?: string }} [opts]  端口传 0 走随机端口
 * @returns {Promise<{ close(): Promise<void>, port: number, httpPort: number, hits: Map<string, number>, reset(): void }>}
 */
export async function startSite({ port = 8443, httpPort = 8080, certDir = DEFAULT_CERT_DIR } = {}) {
  const { key, cert } = ensureCerts(certDir);
  const hits = new Map();
  const state = { port: 0, httpPort: 0, hits };
  const handler = makeHandler(state);

  const tls = https.createServer({ key, cert }, handler);
  const plain = http.createServer(handler);
  await Promise.all([listen(tls, port), listen(plain, httpPort)]);
  state.port = tls.address().port;
  state.httpPort = plain.address().port;

  return {
    port: state.port,
    httpPort: state.httpPort,
    hits,
    reset() {
      hits.clear();
    },
    async close() {
      await Promise.all([shutdown(tls), shutdown(plain)]);
    },
  };
}

// ---------- node server.mjs ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const site = await startSite({
    port: Number(process.env.PORT ?? 8443),
    httpPort: Number(process.env.HTTP_PORT ?? 8080),
  });
  console.log(`[site] https://app.localtest.me:${site.port}/   http://app.localtest.me:${site.httpPort}/`);
  console.log(`[site] hosts: ${Object.keys(HOSTS).join(', ')}   (Ctrl-C to stop)`);
  const stop = () => site.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
