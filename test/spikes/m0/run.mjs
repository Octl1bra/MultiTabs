// M0 spike runner. See docs/decisions.md.
//   pnpm install && ./gen-cert.sh && node run.mjs [--headed]
// Needs: Chrome 152 at CHROME (env) or the default macOS path; ports 8443/8080 free.
// Writes results.json next to this file.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, state, resetState } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, 'ext');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spki = fs.readFileSync(path.join(__dirname, 'spki.txt'), 'utf8').trim();
const headless = !process.argv.includes('--headed');

const APP = 'https://app.localtest.me:8443';
const PLAIN = 'https://plain.localtest.me:8443';
const APP_HTTP = 'http://app.localtest.me:8080';
const PLAIN_HTTP = 'http://plain.localtest.me:8080';

const results = { meta: {}, q1: {}, q2: {}, q3: {}, q4: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await start();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-spike-'));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless,
  pipe: true,                 // Extensions.loadUnpacked is only allowed over the pipe transport
  enableExtensions: true,     // just drops --disable-extensions; we install explicitly below to get the id
  userDataDir,
  args: [
    '--ignore-certificate-errors',
    `--ignore-certificate-errors-spki-list=${spki}`,   // makes the self-signed cert "clean" so the HTTP cache will store responses
    '--host-resolver-rules=MAP *.localtest.me 127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const extId = await browser.installExtension(EXT);   // CDP Extensions.loadUnpacked
const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`), { timeout: 15000 });
results.meta = {
  chrome: await browser.version(),
  puppeteerCore: JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules/puppeteer-core/package.json'), 'utf8')).version,
  headless,
  extId,
  swUrl: swTarget.url(),
  userDataDir,
};
console.log('meta', results.meta);

// ---- probe page ----
const probePage = await browser.newPage();
await probePage.goto(`chrome-extension://${extId}/probe.html`);
const probe = {
  send: (msg) => probePage.evaluate(m => window.probe.send(m), msg),
  rules: () => probePage.evaluate(() => window.probe.rules()),
  storage: () => probePage.evaluate(() => window.probe.storage()),
  cookies: (f) => probePage.evaluate(f => window.probe.cookies(f), f),
  partitionKey: (d) => probePage.evaluate(d => window.probe.partitionKey(d).then(v => ({ ok: v })).catch(e => ({ error: String(e?.message ?? e) })), d),
  tabs: (q) => probePage.evaluate(q => window.probe.tabs(q), q),
  frames: (tabId) => probePage.evaluate(t => window.probe.frames(t), tabId),
  log: async () => (await probePage.evaluate(() => window.probe.storage())).wrLog ?? [],
  clearLog: () => probePage.evaluate(() => window.probe.send({ cmd: 'clearLog' })),
};
// wait for onInstalled rules
for (let i = 0; i < 50; i++) {
  const r = await probe.rules();
  if (r.length >= 2) break;
  await sleep(100);
}
results.meta.sessionRulesAtStart = await probe.rules();
results.meta.rulesInstall = (await probe.storage()).rulesInstall;
console.log('rules', JSON.stringify(results.meta.sessionRulesAtStart));

const page = await browser.newPage();
const pageDiag = [];
page.on('requestfailed', r => pageDiag.push({ ev: 'requestfailed', url: r.url(), err: r.failure()?.errorText }));
page.on('console', m => pageDiag.push({ ev: 'console', type: m.type(), text: m.text() }));
page.on('framenavigated', f => pageDiag.push({ ev: 'framenavigated', url: f.url() }));
const logFor = async (substr) => {
  const all = await probe.log();
  const started = new Map(all.filter(r => r.event === 'responseStarted').map(r => [r.requestId, r]));
  return all.filter(r => r.event === 'headersReceived' && r.url.includes(substr)).map(r => {
    const s = started.get(r.requestId);
    return { ...r, fromCache: s ? s.fromCache : '(no onResponseStarted record)', ip: s?.ip ?? null };
  });
};
const serverReqs = (host, p) => state.requests.filter(r => r.host === host && r.path === p).map(r => ({ host: r.host, path: r.path, 'cache-control': r.headers['cache-control'] ?? null, pragma: r.headers['pragma'] ?? null, cookie: r.headers['cookie'] ?? null }));

// =====================================================================
// Q1: DNR removes Set-Cookie; does webRequest.onHeadersReceived still see it?
// =====================================================================
{
  await probe.clearLog();
  await page.goto(`${APP}/setcookie`);
  await sleep(300);
  results.q1.app = {
    url: `${APP}/setcookie`,
    documentCookie: await page.evaluate(() => document.cookie),
    cookiesGetAll_app: await probe.cookies({ domain: 'app.localtest.me' }),
    webRequest: await logFor('/setcookie'),
  };
  await probe.clearLog();
  await page.goto(`${PLAIN}/setcookie`);
  await sleep(300);
  results.q1.plainControl = {
    url: `${PLAIN}/setcookie`,
    documentCookie: await page.evaluate(() => document.cookie),
    cookiesGetAll_plain: await probe.cookies({ domain: 'plain.localtest.me' }),
    webRequest: await logFor('/setcookie'),
  };
  results.q1.allCookies = await probe.cookies({});
  console.log('Q1', JSON.stringify(results.q1, null, 1));
}

// =====================================================================
// Q2: DNR-appended Server-Timing visible to document_start MAIN-world script?
// =====================================================================
const readSt = async (frame) => ({
  url: frame.url(),
  mtProbe: await frame.evaluate(() => window.__mtProbe ?? null),
  firstScript: await frame.evaluate(() => window.__firstScript ?? null),
  datasetAfterLoad: await frame.evaluate(() => document.documentElement.dataset.mtSignal ?? null),
  serverTimingAfterLoad: await frame.evaluate(() => (performance.getEntriesByType('navigation')[0]?.serverTiming ?? []).map(e => ({ name: e.name, duration: e.duration, description: e.description }))),
  transferSize: await frame.evaluate(() => performance.getEntriesByType('navigation')[0]?.transferSize ?? null),
  deliveryType: await frame.evaluate(() => performance.getEntriesByType('navigation')[0]?.deliveryType ?? null),
});
const readStPage = async () => {
  const main = await readSt(page.mainFrame());
  const sub = page.frames().find(f => f !== page.mainFrame() && f.url().includes('/st-frame'));
  return { main, iframe: sub ? await readSt(sub) : { error: 'iframe not found', frames: page.frames().map(f => f.url()) } };
};
{
  resetState();
  await probe.clearLog();
  await page.goto(`${APP}/st`);
  await sleep(300);
  results.q2.firstLoad = { ...(await readStPage()), webRequest: await logFor('/st'), serverRequests: serverReqs('app.localtest.me:8443', '/st').length + serverReqs('app.localtest.me:8443', '/st-frame').length };

  await page.goto('about:blank');
  await probe.clearLog();
  const before = state.requests.length;
  await page.goto(`${APP}/st`);
  await sleep(300);
  results.q2.secondLoadViaBlank = { ...(await readStPage()), webRequest: await logFor('/st'), newServerRequests: state.requests.slice(before).map(r => r.host + r.path) };

  // third: same-URL goto without about:blank in between (does Chrome treat it as reload?)
  await probe.clearLog();
  const before3 = state.requests.length;
  await page.goto(`${APP}/st`);
  await sleep(300);
  results.q2.thirdLoadSameUrlDirect = { ...(await readStPage()), webRequest: await logFor('/st'), newServerRequests: state.requests.slice(before3).map(r => r.host + r.path) };

  // control: plain host (no DNR rules) — site's own Server-Timing only
  await probe.clearLog();
  await page.goto(`${PLAIN}/st`);
  await sleep(300);
  results.q2.plainControl = { ...(await readStPage()), webRequest: await logFor('/st') };
  console.log('Q2', JSON.stringify(results.q2, null, 1));
}

// =====================================================================
// Q4: getPartitionKey actual return shape
// =====================================================================
{
  const q4 = {};
  await page.goto(`${APP}/`);
  let [tab] = await probe.tabs({ url: `${APP}/*` });
  q4.httpsTop = { tabId: tab?.id, url: tab?.url, result: await probe.partitionKey({ tabId: tab.id }), withFrameId0: await probe.partitionKey({ tabId: tab.id, frameId: 0 }) };

  await page.goto(`${APP_HTTP}/`);
  [tab] = await probe.tabs({ url: `${APP_HTTP}/*` });
  q4.httpTop = { tabId: tab?.id, url: tab?.url, result: await probe.partitionKey({ tabId: tab.id }) };

  // cross-site embed: top = http://localhost:8080, iframe = https://app.localtest.me:8443/
  pageDiag.length = 0;
  const beforeEmbed = state.requests.length;
  await page.goto('http://localhost:8080/embed');
  const embedWait = await page.waitForFrame(f => f.url() === `${APP}/`, { timeout: 5000 }).then(() => 'ok', e => String(e));
  await sleep(300);
  [tab] = await probe.tabs({ url: 'http://localhost:8080/*' });
  const frames = await probe.frames(tab.id);
  q4.embedDiag = { embedWait, puppeteerFrames: page.frames().map(f => f.url()), serverSaw: state.requests.slice(beforeEmbed).map(r => r.host + r.path), pageDiag: [...pageDiag] };
  const sub = frames.find(f => f.frameId !== 0);
  q4.crossSiteEmbed = {
    tabId: tab.id, frames,
    topResult: await probe.partitionKey({ tabId: tab.id }),
    iframeResult: sub ? await probe.partitionKey({ tabId: tab.id, frameId: sub.frameId }) : { error: 'no subframe' },
    iframeByDocumentId: sub?.documentId ? await probe.partitionKey({ documentId: sub.documentId }) : { error: 'no documentId' },
  };
  // probe page itself (extension tab)
  const [ptab] = await probe.tabs({ url: `chrome-extension://${extId}/*` });
  q4.extensionPageTab = { tabId: ptab?.id, result: ptab ? await probe.partitionKey({ tabId: ptab.id }) : null };
  results.q4 = q4;
  console.log('Q4', JSON.stringify(results.q4, null, 1));
}

// =====================================================================
// Q3: DNR request header Cache-Control: no-cache — honored by HTTP cache?
// =====================================================================
const cacheRun = async (base, label) => {
  const key = base.replace(/^https?:\/\//, '') + '/cached';
  await probe.clearLog();
  delete state.hits[key];
  await page.goto(`${base}/cached`);
  const body1 = await page.evaluate(() => document.getElementById('hit')?.textContent);
  await page.goto('about:blank');
  await page.goto(`${base}/cached`);
  const body2 = await page.evaluate(() => document.getElementById('hit')?.textContent);
  // fetch (xmlhttprequest type) x2 from the same origin
  const fkey = key + '?via=fetch';
  delete state.hits[fkey];
  const f1 = await page.evaluate(() => fetch('/cached?via=fetch').then(r => r.text()));
  const f2 = await page.evaluate(() => fetch('/cached?via=fetch').then(r => r.text()));
  await sleep(200);
  const wr = (await logFor('/cached')).map(r => ({ url: r.url, type: r.type, fromCache: r.fromCache, statusCode: r.statusCode }));
  return { label, base, nav: { body1, body2, serverHits: state.hits[key] ?? 0 }, fetch: { f1, f2, serverHits: state.hits[fkey] ?? 0 }, webRequest: wr };
};
const noCacheCheck = async (base) => {
  await page.goto(`${base}/nocache-check`);
  const j = JSON.parse(await page.evaluate(() => document.body.textContent));
  return { base, 'cache-control': j.headers['cache-control'] ?? null, pragma: j.headers['pragma'] ?? null, allHeaders: j.headers };
};
{
  const q3 = { phaseA_noRule3: {}, phaseB_rule3: {} };
  resetState();
  q3.phaseA_noRule3.rules = (await probe.rules()).map(r => r.id);
  q3.phaseA_noRule3.plainHttps = await cacheRun(PLAIN, 'plain https (control)');
  q3.phaseA_noRule3.appHttps = await cacheRun(APP, 'app https (rules 1,2 only)');
  q3.phaseA_noRule3.plainHttp = await cacheRun(PLAIN_HTTP, 'plain http (control)');
  q3.phaseA_noRule3.appHttp = await cacheRun(APP_HTTP, 'app http (rules 1,2 only)');
  q3.phaseA_noRule3.nocacheCheck = { app: await noCacheCheck(APP), plain: await noCacheCheck(PLAIN) };

  q3.phaseB_rule3.install = await probe.send({ cmd: 'installRules', ids: [3] });
  q3.phaseB_rule3.rules = await probe.rules();
  resetState();
  q3.phaseB_rule3.appHttps = await cacheRun(APP, 'app https (rule 3 on)');
  q3.phaseB_rule3.plainHttps = await cacheRun(PLAIN, 'plain https (control)');
  q3.phaseB_rule3.appHttp = await cacheRun(APP_HTTP, 'app http (rule 3 on)');
  q3.phaseB_rule3.nocacheCheck = { app: await noCacheCheck(APP), plain: await noCacheCheck(PLAIN), appHttp: await noCacheCheck(APP_HTTP) };
  // and: does /st (max-age=600) still get served from cache with rule 3 on?
  await probe.clearLog();
  const b = state.requests.length;
  await page.goto(`${APP}/st`); await page.goto('about:blank'); await page.goto(`${APP}/st`);
  await sleep(300);
  q3.phaseB_rule3.stWithRule3 = { newServerRequests: state.requests.slice(b).map(r => r.host + r.path), webRequest: (await logFor('/st')).map(r => ({ url: r.url, type: r.type, fromCache: r.fromCache })), main: (await readSt(page.mainFrame())).mtProbe };
  results.q3 = q3;
  console.log('Q3', JSON.stringify(results.q3, null, 1));
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
console.log('wrote results.json');
await browser.close();
await server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
