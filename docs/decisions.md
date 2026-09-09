# decisions.md — M0 技术假设验证

回填 `docs/multi-tabs-prd.md` 第 13 节开放问题 1–4。全部结论来自实测，不是文档推断。

- 日期：2026-09-09
- Chrome：`Google Chrome 152.0.7977.77`（品牌版，`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`），macOS
- puppeteer-core：`25.10.0`，Node `24.19.0`，pnpm `11.20.0`
- 扩展：`test/spikes/m0/ext/`（MV3，`minimum_chrome_version: "132"`，纯 JS）
- 跑测脚本：`test/spikes/m0/run.mjs`，原始输出 `test/spikes/m0/results.json`
- 复现：`cd test/spikes/m0 && pnpm install && ./gen-cert.sh && node run.mjs`（需要 8443 / 8080 空闲）

## 0. 浏览器启动方式（e2e 框架直接复用）

品牌版 Chrome 137+ 不认 `--load-extension`，不用去装 Chrome for Testing。走 CDP `Extensions.loadUnpacked`，在 puppeteer-core 25 里就是 `browser.installExtension()`。新版 headless 下扩展、service worker、MAIN world content script、DNR、webRequest 全部正常。

```js
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,            // --headless=new。不要用 'shell'（旧 headless 没有扩展）
  pipe: true,                // 必须。Extensions.loadUnpacked 只允许在 pipe 传输上调用
  enableExtensions: true,    // 只是不再追加 --disable-extensions；扩展在下面显式装
  userDataDir,               // 每次 mkdtemp 一个，测完 rm
  args: [
    '--ignore-certificate-errors',
    `--ignore-certificate-errors-spki-list=${spki}`,   // 见下，缓存相关用例必需
    '--host-resolver-rules=MAP *.localtest.me 127.0.0.1', // 本机 Surge fake-ip，别依赖系统 DNS
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const extId = await browser.installExtension(EXT_DIR);   // 返回扩展 id，同步可用
const sw = await browser.waitForTarget(
  t => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`),
  { timeout: 15000 },
);
```

要点：

1. **不要用 `enableExtensions: [path]` 数组形式。** puppeteer-core 25.10.0 的 `BrowserLauncher.launch` 里写的是 `Promise.all([enableExtensions.map(...)])`（多包了一层数组），安装不会被 await，而且拿不到扩展 id。`enableExtensions: true` + `browser.installExtension(path)` 两步走，id 直接返回。
2. **`--ignore-certificate-errors` 单独用时，Chrome 不会把证书有错的响应写进 HTTP 缓存。** 实测同一 `max-age=600` 页面 goto 两次服务端收到 2 次请求（`test/spikes/m0/cache-cert-check.mjs`）。加上 `--ignore-certificate-errors-spki-list=<base64(sha256(SPKI))>` 后证书视为干净，缓存正常（第二次 `deliveryType: "cache"`、服务端 1 次）。SPKI 取法：`openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`。这个 flag 只在非默认 `--user-data-dir` 下生效，我们本来就是临时目录。**PRD 10.2 用例 14（缓存）和 `test/fixtures/site/README.md` 里"带 `--ignore-certificate-errors` 即可"的说法都要按这个改。**
3. 测试脚本读扩展内部状态的最省事办法：扩展里放一个 `probe.html` + `probe.js`（MV3 CSP 禁内联脚本），`page.goto('chrome-extension://<id>/probe.html')` 后 `page.evaluate` 里直接调 `chrome.cookies / chrome.declarativeNetRequest / chrome.storage / chrome.tabs / chrome.scripting`，不用经过 `runtime.sendMessage`。
4. `page.goto` 同一 URL 两次（中间不经过 about:blank）不是 reload，第二次是正常缓存命中（Q2 thirdLoadSameUrlDirect）。
5. 跨站 OOPIF iframe（`http://localhost` 顶层嵌 `https://app.localtest.me`）有一次在 headless 下 10s 内没 attach 上，重跑正常。用到跨站 iframe 的用例要 `page.waitForFrame(...)` 并给重试，别 sleep 固定时长。

服务器端注意：`--host-resolver-rules` 只管浏览器，Node 侧的 `fetch` 不受影响；spike 里是把 server 进程内跑、直接读内存计数，不走 HTTP 查 `/hits`。

## 1. DNR 删响应 Set-Cookie 后，webRequest.onHeadersReceived 仍能看到原始 Set-Cookie 吗？

**结论：成立。** webRequest 看到的是 DNR 修改前的响应头，两条 `Set-Cookie`（含 HttpOnly 那条）都在；同时 DNR 的 remove 确实阻止了写入主罐，`cookies.getAll` 为空、`document.cookie` 为空。

### 证据

规则（session rule）：

```json
{ "id": 1, "priority": 1,
  "condition": { "requestDomains": ["app.localtest.me"],
                 "resourceTypes": ["main_frame","sub_frame","stylesheet","script","image","font","object","xmlhttprequest","ping","csp_report","media","websocket","webtransport","webbundle","other"] },
  "action": { "type": "modifyHeaders", "responseHeaders": [{ "header": "Set-Cookie", "operation": "remove" }] } }
```

监听器：`chrome.webRequest.onHeadersReceived.addListener(fn, { urls: ['<all_urls>'] }, ['responseHeaders', 'extraHeaders'])`，service worker 顶层同步注册。

`https://app.localtest.me:8443/setcookie`（服务端发 `Set-Cookie: spike=1; Path=/; Secure` 和 `Set-Cookie: spike2=2; Path=/; Secure; HttpOnly`）：

```json
{
  "documentCookie": "",
  "cookiesGetAll_app": [],
  "webRequest": [{
    "event": "headersReceived", "url": "https://app.localtest.me:8443/setcookie",
    "type": "main_frame", "tabId": 373972996, "frameId": 0, "statusCode": 200,
    "fromCache": false, "ip": "127.0.0.1", "headerCount": 7,
    "headers": [
      { "name": "Set-Cookie", "value": "spike=1; Path=/; Secure" },
      { "name": "Set-Cookie", "value": "spike2=2; Path=/; Secure; HttpOnly" }
    ]
  }]
}
```

对照 `https://plain.localtest.me:8443/setcookie`（无规则）：`documentCookie: "spike=1"`，`cookies.getAll({domain:'plain.localtest.me'})` 返回 `spike`、`spike2(httpOnly:true)` 两条，webRequest 记录相同。说明 cookie 管道本身是通的，app 那边为空只能是 DNR 删头的效果。

**踩坑（第一次跑）**：规则 1 最初没写 `resourceTypes`，结果 `app` 的两条 cookie照样写进了主罐（`test/spikes/m0/attempt1-rule1-without-resourceTypes.log.txt`）。原因是 DNR 的默认语义：**condition 不写 `resourceTypes` / `excludedResourceTypes` 时匹配所有类型但不含 `main_frame`**。显式列全后才生效。

### 对设计的影响

- 6.2 方案 A 成立，方案 B（`cookies.get` 保存/恢复）不需要了，捕获路径就是 "webRequest 观察 + DNR 删头"。
- 6.1(a) 的 `resourceTypes: ALL_RESOURCE_TYPES` 不是可选项，是必需的；`rulegen.ts` 的快照测试要断言这个字段存在且含 `main_frame`。
- `extraHeaders` 必带，否则看不到 `Set-Cookie`（PRD 已写，这里再确认一次）。
- `onHeadersReceived` 的 `details` 没有 `fromCache`；要区分缓存命中得另挂 `onResponseStarted`/`onCompleted` 按 `requestId` 合并（spike 就是这么做的）。capture.ts 如果需要"只处理真正回源的响应"，要多一个监听器。

## 2. DNR append 的 Server-Timing 能在 document_start 的 MAIN world 脚本里同步读到吗？

**结论：成立，五个子问题全部成立。** content script 跑的时候 navigation entry 已存在、`serverTiming` 里有 `mt`；它确实先于页面 `<head>` 第一段内联脚本执行；sub_frame 同样可读；缓存命中的导航也带；`append` 生效，站点自己的 `Server-Timing` 和注入的并存。

### 证据

规则：

```json
{ "id": 2, "priority": 1,
  "condition": { "requestDomains": ["app.localtest.me"], "resourceTypes": ["main_frame", "sub_frame"] },
  "action": { "type": "modifyHeaders", "responseHeaders": [{ "header": "Server-Timing", "operation": "append", "value": "mt;desc=\"c3Bpa2U\"" }] } }
```

服务端 `/st` 与 `/st-frame` 自己带 `Server-Timing: site;dur=1` 和 `Cache-Control: max-age=600`；`<head>` 第一个元素是内联脚本，把当时的 `serverTiming`、`documentElement.dataset.mtSignal`、`readyState` 存到 `window.__firstScript`。content script `patch.js`（MAIN world，document_start，all_frames）启动时读同样的东西存 `window.__mtProbe`，并把 serverTiming JSON 写到 `dataset.mtSignal`。

**(a)(b)(e) 首次加载**，主文档：

```json
"mtProbe": {
  "navEntryCount": 1, "hasNavEntry": true,
  "serverTiming": [ { "name": "site", "duration": 1, "description": "" },
                    { "name": "mt", "duration": 0, "description": "c3Bpa2U" } ],
  "hasMt": true, "hasSite": true,
  "documentElementExists": true, "wroteDataset": true,
  "readyState": "loading", "currentScript": null,
  "headChildCount": null, "bodyExists": false,
  "href": "https://app.localtest.me:8443/st", "isTop": true, "t": 14.2
},
"firstScript": {
  "st": "[{\"name\":\"site\",\"duration\":1,\"description\":\"\"},{\"name\":\"mt\",\"duration\":0,\"description\":\"c3Bpa2U\"}]",
  "marker": "[{\"name\":\"site\",\"duration\":1,\"description\":\"\"},{\"name\":\"mt\",\"duration\":0,\"description\":\"c3Bpa2U\"}]",
  "readyState": "loading"
},
"transferSize": 668, "deliveryType": ""
```

`headChildCount: null` 说明 content script 跑的时候 `<head>` 都还没创建，只有 `documentElement`；`firstScript.marker` 非空且等于 content script 写的值，证明顺序是 content script → 页面第一段内联脚本。`site` 在前、`mt` 在后，两条都在，`append` 生效（没触发 `set` 兜底）。

**(c) iframe** `https://app.localtest.me:8443/st-frame`（sub_frame）：`mtProbe` 与主文档完全一致（`hasMt: true`，`isTop: false`，`headChildCount: null`），`firstScript.marker` 同样非空。

**(d) 缓存命中**：`about:blank` 之后再 goto 同一 URL，以及不经 about:blank 直接再 goto，两种都是缓存命中，信号都在：

```json
"secondLoadViaBlank": {
  "main":   { "mtProbe.hasMt": true, "firstScript.marker": "[...site...,...mt...]", "transferSize": 0, "deliveryType": "cache" },
  "iframe": { "mtProbe.hasMt": true, "firstScript.marker": "[...site...,...mt...]", "transferSize": 0, "deliveryType": "cache" },
  "webRequest": [
    { "url": ".../st",       "type": "main_frame", "fromCache": true, "headerCount": 4, "headers": [ {"name":"Cache-Control","value":"max-age=600"}, {"name":"Server-Timing","value":"site;dur=1"} ] },
    { "url": ".../st-frame", "type": "sub_frame",  "fromCache": true, "headerCount": 4, "headers": [ {"name":"Cache-Control","value":"max-age=600"}, {"name":"Server-Timing","value":"site;dur=1"} ] }
  ],
  "newServerRequests": []
}
```

`thirdLoadSameUrlDirect` 结果相同（`fromCache: true`，服务端 0 请求，`hasMt: true`）。

对照 `plain.localtest.me`（无规则）：`serverTiming` 只有 `site`，`hasMt: false`，`marker` 仍非空（content script 顺序与规则无关）。

顺带：**webRequest 在所有情况下看到的都是 DNR 修改前的头**——网络回源时 `Server-Timing: site;dur=1`，缓存命中时也一样，`mt` 从未出现在 webRequest 记录里。DNR 的响应头修改发生在缓存之上、渲染进程之下，所以缓存里存的是原始响应，命中时规则再次应用。

### 对设计的影响

- 6.3 主路径（静态 MAIN world 脚本 + Server-Timing 同步信号）成立，可以作为唯一信号载体。
- "缓存命中导致信号失效"这条担忧不成立，6.3 兜底路径的理由只剩 `about:blank` / `srcdoc` / `blob:` 这类没有 navigation entry 的文档（走 `parent.__mt__`）和信号被站点 SW 干扰的情形。兜底可以降级为 P1，或者只保留 `webNavigation.onCommitted` 对无信号 frame 的补注。
- `append` 可用，不需要 `set`；站点自己的 `Server-Timing` 不会被吃掉，补丁按 `name === "mt"` 找即可，不依赖顺序。
- 信号里 `desc` 的 base64url 载荷大小上限没测，DNR 单条 header value 的长度限制要在 rulegen 里另行确认。

## 3. DNR 设置的请求头 `Cache-Control: no-cache` 被 HTTP 缓存层尊重吗？

**结论：成立。** 规则装上后，`main_frame` 导航和页面内 `fetch()`（xmlhttprequest）每次都回源，服务端收到的请求头就是 `cache-control: no-cache`；对照域名和规则装上前都是正常缓存命中。

### 证据

规则：

```json
{ "id": 3, "priority": 1,
  "condition": { "requestDomains": ["app.localtest.me"], "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest"] },
  "action": { "type": "modifyHeaders", "requestHeaders": [{ "header": "Cache-Control", "operation": "set", "value": "no-cache" }] } }
```

`/cached` 响应 `Cache-Control: max-age=600`，body `hit=N`（服务端内存计数）。每组：goto → about:blank → goto，再在页面里 `fetch('/cached?via=fetch')` 两次。`serverHits` 是服务端实际收到的请求数。

**Phase A，规则 3 未装（只有 1、2）：**

| 目标 | nav body1 / body2 | nav serverHits | fetch f1 / f2 | fetch serverHits | webRequest fromCache |
|---|---|---|---|---|---|
| plain https（对照） | hit=1 / hit=1 | 1 | hit=1 / hit=1 | 1 | nav [false, true]，xhr [false, true] |
| app https | hit=1 / hit=1 | 1 | hit=1 / hit=1 | 1 | nav [false, true]，xhr [false, true] |
| plain http | hit=1 / hit=1 | 1 | hit=1 / hit=1 | 1 | 同上 |
| app http | hit=1 / hit=1 | 1 | hit=1 / hit=1 | 1 | 同上 |

`/nocache-check` 服务端收到的 `cache-control`：app `null`，plain `null`。

**Phase B，装上规则 3（`updateSessionRules` 返回 `{ ok: [3], failed: [] }`，`getSessionRules` 为 `[1,2,3]`）：**

| 目标 | nav body1 / body2 | nav serverHits | fetch f1 / f2 | fetch serverHits | webRequest fromCache |
|---|---|---|---|---|---|
| app https | hit=1 / **hit=2** | **2** | hit=1 / **hit=2** | **2** | nav [false, false]，xhr [false, false] |
| plain https（对照） | hit=1 / hit=1 | 0（Phase A 的缓存仍有效） | hit=1 / hit=1 | 0 | nav [true, true]，xhr [true, true] |
| app http | hit=1 / **hit=2** | **2** | hit=1 / **hit=2** | **2** | nav [false, false]，xhr [false, false] |

`/nocache-check` 服务端收到的 `cache-control`：app https `"no-cache"`，app http `"no-cache"`，plain `null`；`pragma` 均无。

另外，规则 3 在位时再访问 Q2 的 `/st`（max-age=600，Phase A 已缓存）两次：服务端收到 4 个请求（`/st` ×2、`/st-frame` ×2），webRequest 全部 `fromCache: false`，`mt` 信号照常存在。

说明：spike 的 `/cached` 没有 ETag / Last-Modified，所以分不清 Chrome 是完全绕过缓存还是发条件请求后 200；Chromium 里请求头 `cache-control: no-cache` 映射为 `LOAD_BYPASS_CACHE`，倾向前者。对设计而言两者等价，都是回源。

### 对设计的影响

- 6.1(b) 保留，写法不变（`operation: "set"`，value `no-cache`），DNR 改的请求头在进入 HTTP cache 之前就生效。
- 代价如 PRD 所述：会话 tab 内所有 main_frame / sub_frame / xhr 都不吃缓存。静态资源不加规则的决定维持。
- 用例 14 的测试站要按第 0 节改启动参数（SPKI），否则对照组本身就不缓存，测不出差别。

## 4. `chrome.cookies.getPartitionKey({tabId})` 的实际返回格式

**结论：返回 `{ partitionKey: { topLevelSite: "<scheme>://<eTLD+1>", hasCrossSiteAncestor: boolean } }`。** `topLevelSite` 是带 scheme、不带端口的 site（Chrome 自己算的 eTLD+1），不是 origin。

### 证据

```json
"httpsTop": {
  "tabId": 373972996, "url": "https://app.localtest.me:8443/",
  "result":       { "partitionKey": { "hasCrossSiteAncestor": false, "topLevelSite": "https://localtest.me" } },
  "withFrameId0": { "partitionKey": { "hasCrossSiteAncestor": false, "topLevelSite": "https://localtest.me" } }
},
"httpTop": {
  "tabId": 373972996, "url": "http://app.localtest.me:8080/",
  "result":       { "partitionKey": { "hasCrossSiteAncestor": false, "topLevelSite": "http://localtest.me" } }
},
"crossSiteEmbed": {
  "frames": [
    { "frameId": 0, "documentId": "F91DA3655122FD70CF97B0B0C19A98DF", "result": "http://localhost:8080/embed" },
    { "frameId": 8, "documentId": "6AE1D8B1F6F95798BA1BB70371293578", "result": "https://app.localtest.me:8443/" }
  ],
  "topResult":          { "partitionKey": { "hasCrossSiteAncestor": false, "topLevelSite": "http://localhost" } },
  "iframeResult":       { "partitionKey": { "hasCrossSiteAncestor": true,  "topLevelSite": "http://localhost" } },
  "iframeByDocumentId": { "partitionKey": { "hasCrossSiteAncestor": true,  "topLevelSite": "http://localhost" } }
},
"extensionPageTab": {
  "tabId": 373972996,
  "result": { "error": "No host permissions for cookies at url: \"chrome-extension://akfcmkfmjcpjfkllceeiffhifcecafce/\"." }
}
```

- 端口被抹掉（8443 / 8080 都不在结果里），scheme 保留（http 和 https 得到不同的 `topLevelSite`）。
- `localtest.me` 不在 PSL 上，Chrome 算出的 site 是 `localtest.me`，与内置 `etld1()` 的两段回退一致。
- `{tabId}` 与 `{tabId, frameId: 0}` 等价；对跨站 iframe 传 `frameId` 或 `documentId`，`topLevelSite` 仍是顶层站点，只有 `hasCrossSiteAncestor` 翻成 true。
- 在扩展自己的页面（`chrome-extension://`）上调用会抛 `No host permissions for cookies at url`，不是返回空对象。

### 对设计的影响

- 6.5 `siteKeyFor` 的写法成立：`new URL(result.partitionKey.topLevelSite).hostname` 得到 `localtest.me`。注意要取 `.partitionKey.topLevelSite` 这一层，不是顶层字段。
- 调用只在 `createSession` 时对 http/https tab 做，其它 URL（`chrome://`、`chrome-extension://`、`about:blank`）会 reject，要 `try/catch` 后走 `etld1()` 回退，PRD A1 的"失败时回退"要覆盖 reject 而不只是空返回。
- `hasCrossSiteAncestor` 对我们没用（挂载按 tab 顶层算），忽略。

## 5. 顺带发现（不属于四个问题，但影响实现）

1. DNR condition 省略 `resourceTypes` 默认不含 `main_frame`。所有要作用于导航的规则必须显式列出。
2. `webRequest.onHeadersReceived` 看到的永远是 DNR 修改前的头，缓存命中也是。webRequest 里不能用"有没有 `mt`"来判断规则是否生效。
3. `onHeadersReceived` 的 `details` 没有 `fromCache`，要从 `onResponseStarted` / `onCompleted` 拿。
4. `--ignore-certificate-errors` 会让证书有错的响应不可缓存；e2e 里凡是与缓存有关的断言都要加 `--ignore-certificate-errors-spki-list`。
5. puppeteer-core 25.10.0 的 `enableExtensions: [path]` 数组形式不等待安装完成，用 `browser.installExtension()`。

## 5. DNR 删响应头 `Clear-Site-Data` 能否阻止浏览器清主罐？

**结论：不能。** e2e 用例 13 首次跑时，会话 tab 访问带 `Clear-Site-Data: "cookies"` 的 `/logout`，基础规则里明明有 `responseHeaders: remove Clear-Site-Data`，主会话（另一个 tab，登着 A）的 `sid` 照样被清掉。Chrome 在网络服务的 `URLLoader` 里一收到响应头就调 `NetworkContextClient::OnClearSiteData`，早于扩展的响应头修改（那是在 header client 里做的）。`Set-Cookie` 不同：cookie 写入走 header client 之后的路径，所以 DNR 删得掉（第 1 节）。

**补救（已实现，`src/background/capture.ts`）**：`onHeadersReceived` 同步阶段一看到 `Clear-Site-Data` 就为该 eTLD+1 开 1.5 s 窗口；`cookies.onChanged` 里 `removed: true` 且落在窗口内的 cookie 先缓冲；异步确认这个响应属于会话 tab 后，把缓冲的 cookie 用 `cookies.set` 原样写回。不是会话 tab 的话窗口到期作废。用例 13 现在通过，主会话的 `sid` 在清除后几十毫秒内恢复。

**对设计的影响**：`"storage"` 指令拦不住，会清掉该 origin 的 localStorage / IDB / caches，包括所有会话的前缀数据；写进第 7 节限制 18。

## 6. 新 tab 的第一个请求和规则安装的先后

**结论：几乎总是请求先发出。** `window.open` / `target=_blank` / Cmd+click 三种情况，`tabs.onCreated` 触发时 `tab.url` 和 `tab.pendingUrl` 都是空的（`status: "loading"`），等 `applyRules` 做完，第一个 main_frame 响应已经回来了，页面渲染的是主会话身份。原先"`onCreated` 里看 `pendingUrl` 在范围内就重导航"这条路走不通，因为 `pendingUrl` 根本拿不到。

**做法**：`webNavigation.onBeforeNavigate` 记每个 tab 顶层导航的开始时间，`onCreated` 里记规则就绪时间；`promotePending` 时若导航不晚于规则就绪就 `tabs.update` 重导航一次。弹窗式 OAuth 的第一跳去 IdP（范围外）不触发转正，回跳时导航晚于规则，不会多余重载。用例 10 三种情况都通过。

## 7. e2e 框架踩的坑（补充第 0 节）

- 两个 tab URL 相同时 puppeteer 侧分不清哪个 target 对应哪个 chrome tabId。用 `chrome.scripting.executeScript` 往目标 tab 的 MAIN world 写一个随机标记，再逐个 target `evaluate` 读回来匹配（`test/e2e/harness.mjs` 的 `pageForTab`）。
- `page.click` 在后台 tab 里会悬住 20 s 后抛 `ProtocolError`：可见性检查靠 `IntersectionObserver`，后台 tab 不回调。点击前 `bringToFront()`。`evaluate` 不受影响。
- 刚被扩展 `tabs.update` 重导航的 tab，紧接着的 `evaluate` 偶尔悬住。`evalTab` 给 evaluate 套 3 s 超时并重取页面重试；输掉 race 的那个 promise 之后会 reject，必须 `.catch`，不然 `node --test` 当 unhandled rejection 把整个用例判死。
- `webRequest.onHeadersReceived` 的 `types` 过滤器用的是 webRequest 自己的枚举，没有 `webtransport`；照抄 DNR 的列表会让 `addListener` 抛异常，service worker 启动即崩，症状是所有 `sendMessage` 超时。不传 `types` 最省事。
- `indexedDB.databases()` 在 `open()` 刚成功那一刻可能还列不出新库，测试要轮询。
