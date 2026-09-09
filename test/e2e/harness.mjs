// e2e 骨架：起测试站点、启动带扩展的 Chrome、提供一个"控制页"（options.html）直接调 chrome.*。
// 启动方式见 docs/decisions.md 第 0 节。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { ensureCerts } from "../fixtures/site/certs.mjs";
import { startSite } from "../fixtures/site/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(__dirname, "../../.output/chrome-mv3");
export const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function spkiOf(certPath) {
  const pub = execFileSync("openssl", ["x509", "-in", certPath, "-pubkey", "-noout"]);
  const der = execFileSync("openssl", ["pkey", "-pubin", "-outform", "der"], { input: pub });
  const dgst = execFileSync("openssl", ["dgst", "-sha256", "-binary"], { input: der });
  return dgst.toString("base64");
}

// 注意：puppeteer 的 page.click 在后台 tab 里会悬住（可见性检查靠 IntersectionObserver，后台不回调），
// 点击前先 page.bringToFront()。evaluate 不受影响。
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (...a) => process.env.E2E_DEBUG && console.error("[e2e]", ...a);

/** 轮询直到 fn 返回真值（或不抛） */
export async function waitFor(fn, { timeout = 8000, interval = 100, label = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(
    `waitFor(${label}) timed out; last=${last instanceof Error ? last.message : JSON.stringify(last)}`,
  );
}

export async function launch({ userDataDir, site } = {}) {
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) {
    throw new Error(`extension not built: ${EXT_DIR}（先 pnpm build）`);
  }
  const ownSite = !site;
  site ??= await startSite({ port: 0, httpPort: 0 });
  const { certPath } = ensureCerts();
  const spki = spkiOf(certPath);
  const udd = userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "mt-e2e-"));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HEADFUL ? false : true,
    pipe: true,
    enableExtensions: true,
    protocolTimeout: 20000, // 挂住的 evaluate 早点报错，别等 180s
    userDataDir: udd,
    args: [
      "--ignore-certificate-errors",
      `--ignore-certificate-errors-spki-list=${spki}`,
      "--host-resolver-rules=MAP *.localtest.me 127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const extId = await browser.installExtension(EXT_DIR);
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().startsWith(`chrome-extension://${extId}/`),
    { timeout: 15000 },
  );
  // 把 service worker 的异常和 error 级日志打到 stderr，不然 SW 崩了只会表现成消息超时
  const swSession = await swTarget.createCDPSession();
  await swSession.send("Runtime.enable");
  swSession.on("Runtime.exceptionThrown", (e) =>
    console.error(
      "[sw exception]",
      e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text,
    ),
  );
  swSession.on("Runtime.consoleAPICalled", (e) => {
    if (e.type === "error" || e.type === "warning" || process.env.SW_LOG) {
      console.error(`[sw ${e.type}]`, ...e.args.map((a) => a.value ?? a.description ?? ""));
    }
  });

  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/options.html`);

  const urls = {
    app: (p = "/") => `https://app.localtest.me:${site.port}${p}`,
    appHttp: (p = "/") => `http://app.localtest.me:${site.httpPort}${p}`,
    api: (p = "/") => `https://api.localtest.me:${site.port}${p}`,
    idp: (p = "/") => `https://localhost:${site.port}${p}`, // IdP 和第三方都挂在 localhost，eTLD+1 与 app 不同
    third: (p = "/") => `https://localhost:${site.port}${p}`,
  };

  const api = {
    /** 走 popup 同一条消息通道 */
    async call(type, payload = {}) {
      const r = await ctl.evaluate((m) => chrome.runtime.sendMessage(m), { type, payload });
      if (!r || !r.ok) throw new Error(`api ${type}: ${r?.error ?? "no response"}`);
      return r.data;
    },
    rules: () => ctl.evaluate(() => chrome.declarativeNetRequest.getSessionRules()),
    cookies: (filter = {}) => ctl.evaluate((f) => chrome.cookies.getAll(f), filter),
    tabs: (q = {}) => ctl.evaluate((q) => chrome.tabs.query(q), q),
    tab: (id) => ctl.evaluate((id) => chrome.tabs.get(id), id),
    local: () => ctl.evaluate(() => chrome.storage.local.get(null)),
    sessionStore: () => ctl.evaluate(() => chrome.storage.session.get(null)),
    closeTab: (id) => ctl.evaluate((id) => chrome.tabs.remove(id), id),
    badge: (id) =>
      ctl.evaluate(
        async (id) => ({
          text: await chrome.action.getBadgeText({ tabId: id }),
          title: await chrome.action.getTitle({ tabId: id }),
          color: await chrome.action.getBadgeBackgroundColor({ tabId: id }),
        }),
        id,
      ),
  };

  /** puppeteer page → chrome tabId */
  async function tabIdOf(page) {
    await page.bringToFront();
    const url = page.url();
    return waitFor(
      async () => {
        const tabs = await api.tabs({ active: true });
        return tabs.find((t) => t.url === url)?.id;
      },
      { label: `tabIdOf ${url}` },
    );
  }

  /** chrome tabId → puppeteer page（等到它离开 about:blank）。URL 可能重复，用 executeScript 打标记精确匹配 */
  async function pageForTab(tabId) {
    const tab = await waitFor(
      async () => {
        const t = await api.tab(tabId);
        return t.url && t.url !== "about:blank" ? t : null;
      },
      { label: `tab ${tabId} url` },
    );
    const marker = `mt-e2e-${tabId}-${Math.random().toString(36).slice(2)}`;
    return waitFor(
      async () => {
        await ctl
          .evaluate(
            (id, m) =>
              Promise.race([
                chrome.scripting.executeScript({
                  target: { tabId: id },
                  world: "MAIN",
                  func: (m) => {
                    window.__mtE2eMarker = m;
                  },
                  args: [m],
                }),
                new Promise((r) => setTimeout(r, 1500)), // 目标正在导航时 executeScript 可能悬着
              ]),
            tabId,
            marker,
          )
          .catch(() => {});
        for (const t of browser.targets()) {
          if (t.type() !== "page" || t.url() !== tab.url) continue;
          dbg("pageForTab candidate", t.url());
          const page = await t.page();
          const v = await Promise.race([
            page.evaluate(() => window.__mtE2eMarker).catch(() => null),
            sleep(2000).then(() => "TIMEOUT"),
          ]);
          dbg("pageForTab marker", v === marker ? "match" : v);
          if (v === marker) return page;
        }
        return null;
      },
      { label: `pageForTab ${tabId}`, timeout: 10000 },
    );
  }

  /** 新建会话并在新 tab 打开 url，返回 { session, page, tabId } */
  async function openSession(name, url, { scope = "site", fromPage } = {}) {
    const base = fromPage ?? (await browser.newPage());
    if (!fromPage) await base.goto(url);
    const tabId = await tabIdOf(base);
    const { session, tabId: newTabId } = await api.call("createSession", {
      tabId,
      name,
      scope,
      action: "newTab",
    });
    const page = await pageForTab(newTabId);
    if (!fromPage) await base.close();
    return { session, page, tabId: newTabId };
  }

  /**
   * 在某个 tab 里执行 fn。tab 刚被扩展重导航时 evaluate 可能悬住，
   * 所以每次重新定位页面，并给 evaluate 套 3s 超时，失败就重试。
   */
  async function evalTab(tabId, fn, ...args) {
    return waitFor(
      async () => {
        const page = await pageForTab(tabId);
        // 输掉 race 的 evaluate 之后会以 ProtocolError reject，必须接住，否则 node --test 当 unhandled rejection
        const r = await Promise.race([
          page
            .evaluate(fn, ...args)
            .then((v) => ({ v }))
            .catch(() => null),
          sleep(3000).then(() => null),
        ]);
        return r ? { ok: true, v: r.v } : null;
      },
      { label: `evalTab ${tabId}`, timeout: 15000 },
    ).then((r) => r.v);
  }

  async function meTab(tabId, path = "/me") {
    return evalTab(tabId, (p) => fetch(p, { credentials: "include" }).then((r) => r.json()), path);
  }

  async function me(page, path = "/me") {
    return page.evaluate((p) => fetch(p, { credentials: "include" }).then((r) => r.json()), path);
  }

  async function close() {
    await browser.close().catch(() => {});
    if (ownSite) await site.close();
    if (!userDataDir) fs.rmSync(udd, { recursive: true, force: true });
  }

  return {
    browser,
    site,
    extId,
    ctl,
    api,
    urls,
    tabIdOf,
    pageForTab,
    openSession,
    me,
    evalTab,
    meTab,
    close,
    userDataDir: udd,
  };
}
