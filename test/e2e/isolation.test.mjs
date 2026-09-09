import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { launch, waitFor } from "./harness.mjs";

let h;
before(async () => {
  h = await launch();
});
after(async () => {
  await h?.close();
});

async function login(page, user) {
  await page.goto(h.urls.app(`/login?user=${user}`));
  await page.waitForSelector("#done");
  // 捕获 → 罐子 → 规则刷新是异步的，等 /me 认出来
  await waitFor(async () => (await h.me(page)).user === user, { label: `login ${user}` });
}

test("1. 两个会话各登 A/B，主会话不受影响", async () => {
  const a = await h.openSession("A 会话", h.urls.app("/"));
  const b = await h.openSession("B 会话", h.urls.app("/"));
  await login(a.page, "A");
  await login(b.page, "B");

  // 各自刷新几次身份不串
  for (let i = 0; i < 3; i++) {
    await a.page.reload();
    await b.page.reload();
    assert.equal(await a.page.$eval("#user", (e) => e.textContent), "A");
    assert.equal(await b.page.$eval("#user", (e) => e.textContent), "B");
  }
  assert.equal((await h.me(a.page)).user, "A");
  assert.equal((await h.me(b.page)).user, "B");

  // 主会话：未登录，主罐里没有 app 的 cookie
  const main = await h.browser.newPage();
  await main.goto(h.urls.app("/"));
  assert.equal(await main.$eval("#user", (e) => e.textContent), "anonymous");
  const mainCookies = await h.api.cookies({ domain: "localtest.me" });
  assert.deepEqual(mainCookies.map((c) => c.name).sort(), [], "主罐不该有 app 的 cookie");

  // 角标：会话色 + title
  const badge = await h.api.badge(a.tabId);
  assert.equal(badge.text, " ");
  assert.match(badge.title, /A 会话 · localtest\.me/);

  h.A = a;
  h.B = b;
  h.main = main;
});

test("2. site 作用域：api 子域的 fetch 带本会话的 Domain cookie，不带 app 的 hostOnly cookie", async () => {
  const r = await h.A.page.evaluate(
    (u) => fetch(u, { credentials: "include" }).then((r) => r.json()),
    h.urls.api("/me"),
  );
  assert.equal(r.who, "A");
  assert.equal(r.user, null, "sid 是 app 的 hostOnly cookie，不该发给 api");
  assert.equal(r.raw, "who=A");
});

test("4. document.cookie 只看到本会话的非 HttpOnly cookie；localStorage 互不可见", async () => {
  const ca = await h.A.page.evaluate(() => document.cookie);
  const cb = await h.B.page.evaluate(() => document.cookie);
  assert.match(ca, /who=A/);
  assert.match(ca, /theme=dark/);
  assert.doesNotMatch(ca, /sid=/, "HttpOnly 不可见");
  assert.match(cb, /who=B/);
  assert.equal(await h.A.page.evaluate(() => localStorage.getItem("token")), "A");
  assert.equal(await h.B.page.evaluate(() => localStorage.getItem("token")), "B");
  assert.equal(await h.main.evaluate(() => localStorage.getItem("token")), null);
  // 主会话看不到会话的前缀 key 之外的东西
  assert.equal(await h.A.page.evaluate(() => Object.keys(localStorage).join(",")), "token");
});

test("12. 首段内联脚本读到的就是会话的 localStorage 和 cookie（信号路径）", async () => {
  await h.A.page.goto(h.urls.app("/inline"));
  const first = await h.A.page.evaluate(() => window.__first);
  assert.equal(first.token, "A");
  assert.match(first.cookie, /who=A/);
  assert.equal(first.ls_len, 1);
  // 主会话里同一页面：没 token
  await h.main.goto(h.urls.app("/inline"));
  const mainFirst = await h.main.evaluate(() => window.__first);
  assert.equal(mainFirst.token, null);
});

test("前缀代理：IndexedDB / caches 名字对页面透明，主会话看不到", async () => {
  await h.A.page.goto(h.urls.app("/storage?fromA"));
  await h.A.page.waitForSelector("#done");
  assert.equal(
    await h.A.page.$eval("#ls_keys", (e) => e.textContent.split(",").sort().join(",")),
    "k,token",
  );
  // databases()/caches.keys() 在 open 刚成功时可能还列不出来，轮询
  const listing = () =>
    h.A.page.evaluate(async () => ({
      dbs: (await indexedDB.databases()).map((d) => d.name).sort(),
      caches: (await caches.keys()).sort(),
    }));
  const l = await waitFor(
    async () => {
      const v = await listing();
      return v.dbs.includes("db1") && v.caches.includes("c1") ? v : null;
    },
    { label: "idb/caches listing" },
  );
  assert.deepEqual(l, { dbs: ["db1"], caches: ["c1"] });

  await h.main.goto(h.urls.app("/storage?fromMain"));
  await h.main.waitForSelector("#done");
  const mainDbs = await h.main.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name),
  );
  assert.ok(
    mainDbs.some((n) => n.startsWith("mt:")),
    "主会话（未打补丁）能看到带前缀的真实库名",
  );
  // 主会话没打补丁，看得到所有会话的前缀 key（已知限制），但没有裸的 token
  const mainKeys = (await h.main.$eval("#ls_keys", (e) => e.textContent)).split(",");
  assert.ok(mainKeys.includes("k"));
  assert.ok(!mainKeys.includes("token"));
});

test("storage 事件跨 tab 转发：去前缀、storageArea 是本页的 localStorage、别人的 key 看不到", async () => {
  const listener = h.A.page;
  await listener.goto(h.urls.app("/"));
  await listener.evaluate(() => {
    window.__events = [];
    window.addEventListener("storage", (e) => {
      window.__events.push({
        key: e.key,
        newValue: e.newValue,
        areaIsLocal: e.storageArea === localStorage,
        areaIsStorage: e.storageArea instanceof Storage,
      });
    });
  });
  // 同一会话的另一个 tab 写 localStorage
  const { tabId: otherId } = await h.api.call("openInNewTab", {
    sessionId: h.A.session.id,
    url: h.urls.app("/"),
  });
  await h.evalTab(otherId, () => localStorage.setItem("shared", "from-other"));
  // 主会话 tab 写同名 key（真实 key 无前缀），会话 tab 不该收到
  await h.main.goto(h.urls.app("/"));
  await h.main.evaluate(() => localStorage.setItem("shared", "from-main"));
  const events = await waitFor(
    async () => {
      const ev = await listener.evaluate(() => window.__events);
      return ev.length >= 1 ? ev : null;
    },
    { label: "storage event" },
  );
  await new Promise((r) => setTimeout(r, 300));
  const all = await listener.evaluate(() => window.__events);
  assert.deepEqual(all, [
    { key: "shared", newValue: "from-other", areaIsLocal: true, areaIsStorage: true },
  ]);
  assert.equal(events.length, 1);
  assert.equal(await listener.evaluate(() => localStorage.getItem("shared")), "from-other");
  await h.api.closeTab(otherId);
});

test("Service Worker 在会话 tab 里被阻断", async () => {
  await h.A.page.goto(h.urls.app("/sw"));
  await h.A.page.waitForFunction(() => document.getElementById("sw")?.textContent);
  assert.match(await h.A.page.$eval("#sw", (e) => e.textContent), /^blocked:SecurityError/);
});

test("13. Clear-Site-Data：会话罐清空，主会话不受影响", async () => {
  // 主会话先登 A
  await h.main.goto(h.urls.app("/login?user=A"));
  await h.main.waitForSelector("#done");
  assert.equal((await h.me(h.main)).user, "A");

  await h.B.page.goto(h.urls.app("/logout"));
  await h.B.page.waitForSelector("#done");
  await waitFor(async () => (await h.me(h.B.page)).user === null, { label: "B logged out" });
  await waitFor(async () => (await h.me(h.main)).user === "A", {
    label: "主会话仍登录（CSD 后恢复）",
  });
  assert.equal((await h.me(h.A.page)).user, "A", "A 会话不受影响");
  const { sessions } = await h.api.call("listAllSessions");
  assert.equal(sessions.find((s) => s.id === h.B.session.id).cookieCount, 0);
  await login(h.B.page, "B");
});

test("14. 共享 HTTP 缓存不会把主会话的页面喂给会话 tab", async () => {
  h.site.reset();
  await h.main.goto(h.urls.app("/profile"));
  assert.equal(await h.main.$eval("#user", (e) => e.textContent), "A");
  await h.main.goto(h.urls.app("/"));
  await h.main.goto(h.urls.app("/profile"));
  assert.equal(h.site.hits.get("profile"), 1, "主会话第二次应命中缓存");
  await h.B.page.goto(h.urls.app("/profile"));
  assert.equal(await h.B.page.$eval("#user", (e) => e.textContent), "B");
  assert.equal(h.site.hits.get("profile"), 2, "会话 tab 应回源");
});

test("15. 会话 tab 里的第三方 iframe 拿不到会话 cookie", async () => {
  await h.A.page.goto(h.urls.app("/with-third-party"));
  // OOPIF 在 headless 下 attach 有时慢，轮询而不是 waitForFunction
  const text = await waitFor(
    async () => {
      const frame = h.A.page.frames().find((f) => f.url().startsWith(h.urls.third("/embed")));
      if (!frame) return null;
      const t = await frame
        .evaluate(() => document.getElementById("me")?.textContent)
        .catch(() => null);
      return t && t.startsWith("{") ? t : null;
    },
    { label: "third-party frame result", timeout: 15000, interval: 200 },
  );
  const r = JSON.parse(text);
  assert.equal(r.user, null);
  assert.equal(r.raw, "");
  assert.equal(await h.A.page.$eval("#user", (e) => e.textContent), "A", "顶层仍是 A");
});

test("3. host 作用域：api 子域走主会话", async () => {
  assert.equal((await h.me(h.main)).who, "A", "前置：主会话登着 A");
  const c = await h.openSession("仅主机", h.urls.app("/"), { scope: "host" });
  assert.equal(c.session.siteKey, "app.localtest.me");
  await login(c.page, "B");
  assert.equal((await h.me(c.page)).user, "B");
  assert.equal((await h.me(c.page)).who, "B");
  const r = await c.page.evaluate(
    (u) => fetch(u, { credentials: "include" }).then((r) => r.json()),
    h.urls.api("/me"),
  );
  assert.equal(r.who, "A", "api 子域应带主会话（A）的 Domain cookie");
  h.C = c;
});

test("10. 从会话 tab 打开的新 tab 继承会话：window.open / Cmd+click / target=_blank", async () => {
  const page = h.A.page;
  const cases = [
    { name: "window.open", act: () => page.click("#win") },
    { name: "target=_blank", act: () => page.click("#blank") },
    {
      name: "Cmd+click",
      act: async () => {
        await page.keyboard.down("Meta");
        await page.click("#plain");
        await page.keyboard.up("Meta");
      },
    },
  ];
  for (const c of cases) {
    await page.goto(h.urls.app("/open"));
    await page.bringToFront(); // 后台 tab 里 click 会悬住（IntersectionObserver 不回调）
    const before = new Set((await h.api.tabs()).map((t) => t.id));
    await c.act();
    // Cmd+click 开的 tab 在 puppeteer 里没有 opener()，统一从扩展侧找新 tab
    const created = await waitFor(
      async () =>
        (await h.api.tabs()).find((t) => !before.has(t.id) && t.openerTabId === h.A.tabId),
      { label: `${c.name} new tab` },
    );
    await waitFor(
      async () =>
        (await h.evalTab(created.id, () => document.getElementById("user")?.textContent)) === "A",
      { label: `${c.name} inherits`, timeout: 15000 },
    );
    assert.equal((await h.meTab(created.id)).user, "A", c.name);
    const store = await h.api.sessionStore();
    assert.ok(store[`tab:${created.id}`], "已转正");
    assert.equal(store[`pending:${created.id}`], undefined);
    await h.api.closeTab(created.id);
  }
});

test("jscookie：document.cookie 写入进会话罐，主罐没有", async () => {
  await h.A.page.goto(h.urls.app("/jscookie"));
  await waitFor(async () => (await h.me(h.A.page)).raw.includes("js=1"), {
    label: "js cookie injected",
  });
  assert.match(await h.A.page.evaluate(() => document.cookie), /js=1/);
  const mainCookies = await h.api.cookies({ name: "js" });
  assert.equal(mainCookies.length, 0);
});

test("7. Leave 后回到主会话身份", async () => {
  const tabId = h.B.tabId;
  assert.equal((await h.me(h.main)).user, "A", "前置：主会话登着 A");
  await h.api.call("leave", { tabId });
  await waitFor(async () => (await h.me(h.B.page)).user === "A", {
    label: "B tab back to main(A)",
  });
  assert.equal(await h.B.page.evaluate(() => !!window.__mt__), false, "重载后补丁不再安装");
  const rules = await h.api.rules();
  assert.equal(rules.filter((r) => r.condition.tabIds?.includes(tabId)).length, 0);
  const badge = await h.api.badge(tabId);
  assert.equal(badge.text, "");
});

test("8. 关闭 tab → 该 tab 的规则被清除", async () => {
  const tabId = h.C.tabId;
  assert.ok((await h.api.rules()).some((r) => r.condition.tabIds?.includes(tabId)));
  await h.C.page.close();
  await waitFor(
    async () => !(await h.api.rules()).some((r) => r.condition.tabIds?.includes(tabId)),
    { label: "rules removed" },
  );
  const store = await h.api.sessionStore();
  assert.equal(store[`tab:${tabId}`], undefined);
  assert.equal(store[`rules:${tabId}`], undefined);
});

test("9. 删除会话 → 罐子清空、挂载 tab 退回主会话", async () => {
  const { session, page, tabId } = h.A;
  await h.api.call("deleteSession", { sessionId: session.id });
  await waitFor(
    async () => (await h.me(page)).user === "A" && !(await h.api.sessionStore())[`tab:${tabId}`],
    {
      label: "A tab back to main",
    },
  );
  const local = await h.api.local();
  assert.equal(local[`jar:${session.id}`], undefined);
  assert.equal(local.sessions?.[session.id], undefined);
  const badge = await h.api.badge(tabId);
  assert.equal(badge.text, "");
});
