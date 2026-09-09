import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, state } from './server.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spki = fs.readFileSync(path.join(__dirname, 'spki.txt'), 'utf8').trim();
const server = await start({ httpsPort: 9443, httpPort: 9080 });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-spike-embed-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, userDataDir,
  args: ['--ignore-certificate-errors', `--ignore-certificate-errors-spki-list=${spki}`, '--host-resolver-rules=MAP *.localtest.me 127.0.0.1', '--no-first-run'] });
const withExt = !process.argv.includes('--noext');
if (withExt) { const id = await browser.installExtension(path.join(__dirname, 'ext')); await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes(id)); await new Promise(r => setTimeout(r, 500)); }
const page = await browser.newPage();
page.on('requestfailed', r => console.log('REQFAILED', r.url(), r.failure()?.errorText));
page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
page.on('frameattached', f => console.log('frameattached')); page.on('framedetached', f => console.log('framedetached', f.url()));
page.on('framenavigated', f => console.log('framenavigated', f.url()));
for (const top of ['https://app.localtest.me:9443/', 'http://app.localtest.me:9080/', 'http://localhost:9080/embed', 'about:blank', 'http://localhost:9080/embed']) {
  console.log('--- goto', top, 'ext=', withExt);
  await page.goto(top);
  await new Promise(r => setTimeout(r, 1500));
  console.log('frames', page.frames().map(f => f.url()));
  console.log('server saw', state.requests.map(r => r.host + r.path));
  state.requests.length = 0;
}
await browser.close(); await server.close(); fs.rmSync(userDataDir, { recursive: true, force: true });
