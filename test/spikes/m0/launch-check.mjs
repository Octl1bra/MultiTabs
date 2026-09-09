import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, 'ext');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spki = fs.readFileSync(path.join(__dirname, 'spki.txt'), 'utf8').trim();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-spike-'));
const headless = process.argv.includes('--headed') ? false : true;
console.log('headless', headless, 'userDataDir', userDataDir);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless,
  pipe: true,
  enableExtensions: true,
  userDataDir,
  args: [
    '--ignore-certificate-errors',
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--host-resolver-rules=MAP *.localtest.me 127.0.0.1',
    '--no-first-run', '--no-default-browser-check',
  ],
});
console.log('version', await browser.version());
let extId;
try {
  extId = await browser.installExtension(EXT);
  console.log('installExtension ->', extId);
} catch (e) {
  console.error('installExtension failed:', e);
}
const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes(extId ?? 'chrome-extension'), { timeout: 10000 }).catch(e => null);
console.log('sw target', sw?.url());
console.log('targets', (await browser.targets()).map(t => [t.type(), t.url()]));
await browser.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
