import { launch, waitFor, sleep } from "../test/e2e/harness.mjs";
const OUT = process.argv[2];
const h = await launch();
const a = await h.openSession("Admin", h.urls.app("/"));
await a.page.goto(h.urls.app("/login?user=A")); await a.page.waitForSelector("#done");
await waitFor(async () => (await h.me(a.page)).user === "A");
const b = await h.openSession("QA 候选人", h.urls.app("/"));
await b.page.goto(h.urls.app("/login?user=B")); await b.page.waitForSelector("#done");
await waitFor(async () => (await h.me(b.page)).user === "B");
await h.api.call("createSession", { tabId: a.tabId, name: "运营 B 店", scope: "site", action: "none" });

const compose = async (scheme, file, scale) => {
  const p = await h.browser.newPage();
  await p.setViewport({ width: 640, height: 400, deviceScaleFactor: scale });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await p.goto(`chrome-extension://${h.extId}/options.html`);
  await p.evaluate((popupUrl, dark) => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.innerHTML = `
      <div style="position:relative;width:640px;height:400px;overflow:hidden;background:${dark ? "#111113" : "#f4f4f5"};font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;color:${dark ? "#fafafa" : "#18181b"}">
        <div style="position:absolute;left:40px;top:96px;width:260px">
          <div style="font-size:26px;font-weight:600;line-height:1.3;letter-spacing:-0.01em">同一个网站<br>多个账号同时在线</div>
          <div style="margin-top:14px;font-size:14px;line-height:1.6;color:${dark ? "#a1a1aa" : "#52525b"}">每个标签页一套独立的登录态，<br>切换不用登出，互不干扰。</div>
          <div style="margin-top:22px;display:flex;gap:6px;align-items:center">
            <span style="width:10px;height:10px;border-radius:50%;background:#1d4ed8"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#047857"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#b45309"></span>
            <span style="font-size:12px;color:${dark ? "#71717a" : "#71717a"};margin-left:4px">Chrome · 开源</span>
          </div>
        </div>
        <div style="position:absolute;left:340px;top:28px;width:360px;height:520px;transform:scale(0.78);transform-origin:top left;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,${dark ? 0.6 : 0.16}),0 0 0 1px rgba(0,0,0,${dark ? 0.5 : 0.06});background:${dark ? "#111113" : "#f4f4f5"}">
          <iframe src="${popupUrl}" style="width:360px;height:520px;border:0;display:block"></iframe>
        </div>
      </div>`;
  }, `chrome-extension://${h.extId}/popup.html?tabId=${a.tabId}`, scheme === "dark");
  await sleep(1200);
  // 去掉输入框的焦点环，把 popup 滚到"已保存的会话"露出三条彩色会话
  await p.evaluate(() => {
    const f = document.querySelector("iframe");
    const d = f.contentDocument;
    if (d.activeElement) d.activeElement.blur();
    const shell = d.querySelector("#root > div");
    if (shell) shell.scrollTop = 235;
  });
  await sleep(300);
  await p.screenshot({ path: file, clip: { x: 0, y: 0, width: 640, height: 400 } });
  await p.close();
};
await compose("light", `${OUT}/screenshot-640x400.png`, 1);
await compose("light", `${OUT}/screenshot-1280x800.png`, 2);
await compose("dark", `${OUT}/screenshot-640x400-dark.png`, 1);
await h.close();
