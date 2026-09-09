// Does the HTTP cache store responses from a self-signed host when only --ignore-certificate-errors is used
// (no --ignore-certificate-errors-spki-list)? Uses ports 9443/9080 so it can run alongside run.mjs.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, state } from './server.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spki = fs.readFileSync(path.join(__dirname, 'spki.txt'), 'utf8').trim();
const server = await start({ httpsPort: 9443, httpPort: 9080 });
const out = {};
for (const variant of ['ignore-only', 'ignore+spki']) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-spike-cert-'));
  const args = ['--ignore-certificate-errors', '--host-resolver-rules=MAP *.localtest.me 127.0.0.1', '--no-first-run'];
  if (variant === 'ignore+spki') args.push(`--ignore-certificate-errors-spki-list=${spki}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, userDataDir, args });
  const page = await browser.newPage();
  const base = 'https://plain.localtest.me:9443';
  delete state.hits['plain.localtest.me:9443/cached'];
  await page.goto(`${base}/cached`);
  await page.goto('about:blank');
  await page.goto(`${base}/cached`);
  const body2 = await page.evaluate(() => document.getElementById('hit')?.textContent);
  const nav = await page.evaluate(() => ({ deliveryType: performance.getEntriesByType('navigation')[0]?.deliveryType, transferSize: performance.getEntriesByType('navigation')[0]?.transferSize }));
  out[variant] = { body2, serverHits: state.hits['plain.localtest.me:9443/cached'], nav };
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 1));
await server.close();
