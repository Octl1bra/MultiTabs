// Spike test server. ESM, no deps.
// https :8443 + http :8080, routes by Host header (host is recorded, routes are shared).
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const state = {
  hits: {},          // key `${host}${path}` -> count
  requests: [],      // every request: {host, path, headers, ts}
};

export function resetState() {
  state.hits = {};
  state.requests = [];
}

function bump(key) {
  state.hits[key] = (state.hits[key] ?? 0) + 1;
  return state.hits[key];
}

const FIRST_SCRIPT = `<script>window.__firstScript = { st: JSON.stringify(performance.getEntriesByType('navigation')[0]?.serverTiming ?? null), marker: document.documentElement.dataset.mtSignal ?? null, readyState: document.readyState };</script>`;

function html(res, body, extraHeaders = {}) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(body);
}
function json(res, obj, extraHeaders = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(obj, null, 2));
}

export function handler(req, res) {
  const host = req.headers.host ?? '';
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname;
  state.requests.push({ host, path: p, headers: { ...req.headers }, ts: Date.now() });

  switch (p) {
    case '/':
      return html(res, `<!doctype html><title>root</title><h1>root ${host}</h1>`);

    case '/setcookie':
      res.setHeader('Set-Cookie', ['spike=1; Path=/; Secure', 'spike2=2; Path=/; Secure; HttpOnly']);
      return html(res, `<!doctype html><title>setcookie</title><h1>setcookie ${host}</h1>`);

    case '/st':
      return html(res,
        `<!doctype html><html><head>${FIRST_SCRIPT}<title>st</title></head><body><h1>st ${host}</h1><iframe id="f" src="/st-frame"></iframe></body></html>`,
        { 'Cache-Control': 'max-age=600', 'Server-Timing': 'site;dur=1' });

    case '/st-frame':
      return html(res,
        `<!doctype html><html><head>${FIRST_SCRIPT}<title>st-frame</title></head><body><h1>st-frame ${host}</h1></body></html>`,
        { 'Cache-Control': 'max-age=600', 'Server-Timing': 'site;dur=1' });

    case '/cached': {
      const n = bump(host + p + url.search);
      return html(res, `<!doctype html><title>cached</title><pre id="hit">hit=${n}</pre>`, { 'Cache-Control': 'max-age=600' });
    }

    case '/hits':
      return json(res, state.hits);

    case '/reset':
      resetState();
      return json(res, { ok: true });

    case '/nocache-check':
      return json(res, { host, headers: req.headers });

    case '/embed': {
      // cross-site embed helper for getPartitionKey: top-level = this host, iframe = https://app.localtest.me:8443/
      return html(res, `<!doctype html><title>embed</title><h1>embed ${host}</h1><iframe id="f" src="https://app.localtest.me:${process.env.SPIKE_HTTPS_PORT ?? 8443}/"></iframe>`);
    }

    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
  }
}

export function start({ httpsPort = 8443, httpPort = 8080 } = {}) {
  const tls = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
  };
  const s1 = https.createServer(tls, handler);
  const s2 = http.createServer(handler);
  return Promise.all([
    new Promise(r => s1.listen(httpsPort, '127.0.0.1', () => r(s1))),
    new Promise(r => s2.listen(httpPort, '127.0.0.1', () => r(s2))),
  ]).then(servers => ({
    servers,
    close: () => Promise.all(servers.map(s => new Promise(r => s.close(r)))),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then(() => console.log('listening https://127.0.0.1:8443 http://127.0.0.1:8080'));
}
