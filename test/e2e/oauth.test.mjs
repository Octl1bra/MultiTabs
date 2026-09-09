import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { launch, waitFor } from "./harness.mjs";

let h;
before(async () => {
  h = await launch();
});
after(async () => {
  await h?.close();
  await h?.site?.close(); // 重启用例复用了站点，close() 不会关它；不关的话 server 会把测试进程挂住
});

test("5. 跳转式 OAuth：state cookie 注入、callback 的 Set-Cookie 进会话罐、idp cookie 留在主会话", async () => {
  const main = await h.browser.newPage();
  await main.goto(h.urls.app("/"));
  const s = await h.openSession("OAuth 跳转", h.urls.app("/"));
  // 一路 302：app → idp → app/callback → app/。callback 的 Set-Cookie 之后扩展会重导航一次，
  // puppeteer 这边的 goto 会以 ERR_ABORTED 收场，属预期。
  await s.page
    .goto(h.urls.app("/oauth/start?mode=redirect&user=B"), { waitUntil: "load" })
    .catch((e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
    });
  await waitFor(
    async () => {
      if (new URL(s.page.url()).pathname !== "/") return false;
      const u = await s.page.$eval("#user", (e) => e.textContent).catch(() => null);
      return u === "B";
    },
    { label: "back home as B" },
  );
  assert.equal((await h.me(s.page)).user, "B");
  // 主会话没登录；idp 的 cookie 在主罐里（第三方走主会话）
  assert.equal((await h.me(main)).user, null);
  const idp = await h.api.cookies({ url: h.urls.idp("/") });
  assert.deepEqual(
    idp.map((c) => c.name),
    ["idp_session"],
    `all cookies: ${JSON.stringify((await h.api.cookies({})).map((c) => [c.domain, c.name]))}`,
  );
  const app = await h.api.cookies({ domain: "app.localtest.me" });
  assert.deepEqual(app, [], "app 的 cookie 一个都不该进主罐");
  const { sessions } = await h.api.call("listAllSessions");
  const me = sessions.find((x) => x.id === s.session.id);
  assert.ok(me.cookieCount >= 1, "会话罐里有 sid");
  h.main = main;
  h.S = s;
});

test("5b. 跳转式 OAuth 的 state 校验靠会话罐里的 oauth_state cookie", async () => {
  // 直接访问 callback 且 state 不匹配 → 400，证明校验确实在跑
  await h.S.page.goto(h.urls.app("/callback?code=B&state=wrong"));
  assert.equal(await h.S.page.$eval("#err", (e) => e.textContent), "state mismatch");
});

test("6. 弹窗式 OAuth：弹窗进入 pending，回跳后转正，原 tab 不刷新即可拿到新身份", async () => {
  const s = await h.openSession("OAuth 弹窗", h.urls.app("/"));
  await s.page.goto(h.urls.app("/oauth/start?mode=popup&user=B"));
  await s.page.bringToFront(); // 后台 tab 里 click 会悬住
  const before = new Set((await h.api.tabs()).map((t) => t.id));
  await s.page.click("#go");
  const popupTab = await waitFor(
    async () => (await h.api.tabs()).find((t) => !before.has(t.id) && t.openerTabId === s.tabId),
    { label: "popup tab" },
  );
  // 弹窗停在 idp（范围外）时是 pending，规则已在位
  const store1 = await h.api.sessionStore();
  assert.ok(
    store1[`pending:${popupTab.id}`] || store1[`tab:${popupTab.id}`],
    "弹窗立刻进入 pending",
  );
  assert.ok(store1[`rules:${popupTab.id}`]?.length > 0, "规则已在位");
  // 弹窗自己会 postMessage 并关闭；原 tab 收到后 fetch /me
  const meText = await waitFor(
    async () => {
      const t = await s.page.$eval("#me", (e) => e.textContent).catch(() => "");
      return t && t.startsWith("{") ? t : null;
    },
    { label: "opener got /me after popup", timeout: 15000 },
  );
  assert.equal(JSON.parse(meText).user, "B");
  assert.equal((await h.me(s.page)).user, "B");
  assert.equal((await h.me(h.main)).user, null, "主会话不受影响");
  // 弹窗关闭后它的挂载和规则都清掉
  await waitFor(
    async () => {
      const st = await h.api.sessionStore();
      return (
        !st[`tab:${popupTab.id}`] && !st[`pending:${popupTab.id}`] && !st[`rules:${popupTab.id}`]
      );
    },
    { label: "popup tab cleaned up" },
  );
});

test("11. 浏览器重启：会话列表和罐子仍在，tab 挂载丢失", async () => {
  const { sessions: before } = await h.api.call("listAllSessions");
  assert.ok(before.length >= 2);
  const udd = h.userDataDir;
  const site = h.site;
  await h.browser.close();
  h = await launch({ userDataDir: udd, site });
  const { sessions: after } = await h.api.call("listAllSessions");
  assert.deepEqual(
    after.map((s) => [s.name, s.cookieCount]).sort(),
    before.map((s) => [s.name, s.cookieCount]).sort(),
  );
  assert.equal(Object.keys(await h.api.sessionStore()).length, 0, "storage.session 已清空");
  assert.equal((await h.api.rules()).length, 0);
});
