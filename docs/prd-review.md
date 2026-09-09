# PRD 评审：multi-tabs-prd.md

评审基准：Firefox Multi-Account Containers 的行为语义（容器继承、第三方走默认容器）。凡是这份 PRD 承诺了 MAC 级别的隔离但机制上做不到的地方，都列在这里。

按严重程度排序。P0 = 不改设计就会出功能性 bug；P1 = 已知限制写得太轻或自相矛盾；P2 = 文档小问题。

---

## P0：设计层面站不住

### 1. Service Worker 方案不成立（3.3 / 6.3 / 7.5）

- `navigator.serviceWorker.register('blob:…')` 会直接抛 TypeError，规范要求 script URL 必须是 http(s) 同源。"同源脚本 + blob URL 加载"对 Worker/SharedWorker 可以，对 ServiceWorker 不可以。
- SW 是按 origin 共享的，不分 tab。会话 tab 注册的 SW 会接管主会话 tab 的导航，反之亦然。SW 内部 `fetch()` 发出的请求大概率 `tabId = -1`，DNR 的 `tabIds` 条件完全不命中，Cookie 走主会话。7.5 只承认了"后台同步"这一小块，实际上凡是把 API 请求路由过 SW 的站点（Workbox NetworkFirst 之类）隔离整体失效。
- 建议：会话 tab 内 `serviceWorker.register` 直接返回 reject（伪造 SecurityError），并对已注册的同 scope SW 调 `unregister`。写进 README 当作限制，比假装隔离了要诚实。Worker/SharedWorker 的 blob 方案保留，但要注意 blob URL 会改变 `self.location`，webpack 的 chunk 加载靠它算 publicPath，实测会挂一批站点。

### 2. 补丁注入时机不是"已知限制"，是隔离漏洞（6.3 / 7.3 / 13.3）

`webNavigation.onCommitted` 到 `executeScript` 之间要经过 service worker 唤醒和一次 IPC，页面 `<head>` 第一段内联脚本几乎必然先跑。"实测常见框架不受影响"没有依据：Next.js 的主题脚本、各家 auth SDK 的 `localStorage.getItem('token')` 都在首屏同步执行。

建议改成两层：
- manifest 静态注册一个 `world: "MAIN"`、`run_at: "document_start"` 的脚本，匹配 `<all_urls>`。它只做一件事：同步检查一个信号，有就装补丁，没有就退出，对普通 tab 开销是一次读取。
- 信号来源两个：补丁首次安装时往真实 `sessionStorage` 写一个标记，覆盖同 origin 的后续导航；首次导航靠 DNR 给该 tab 的 main_frame 响应加 `Server-Timing: mst;desc=<sessionId>` 头，`performance.getEntriesByType('navigation')[0].serverTiming` 在 document_start 就能同步读到。第二条需要实测，写进 13 节。
- `onCommitted + executeScript` 降级为补漏，不再是主路径。

### 3. hostsSeen 惰性策略会把用户踢到登录页（6.1）

"第一次访问某个新子域的第一个请求可能不带 cookie，可接受"这句不成立：main_frame 请求不带 cookie，服务端直接 302 到登录页，用户看到的是被登出，不是"页面重试"。

而且这个策略是多余的。会话罐里每条 cookie 要么 `hostOnly=true`，主机名是已知的；要么 `hostOnly=false`，用 `requestDomains: [cookie.domain]` 天然匹配所有子域。所以注入主机集合是可枚举的：

- 每个 domain-cookie 的 domain 一条规则，`requestDomains: [domain]`，value 是该 domain 及其所有父 domain 的 cookie，priority 按标签数递增。
- 每个 hostOnly 主机一条规则，value 是该主机 + 所有匹配的 domain-cookie，priority 最高。
- DNR 同一 header 的 `set` 只有最高优先级生效，所以每条 value 必须是完整串。

好处：删掉 `hostsSeen`、`onBeforeRequest` 监听和 LRU 三样东西；不再有首请求丢 cookie；`requestDomains` 不占正则额度。http/https 的 secure 拆分可以用 `urlFilter: "|http://"` 做，同样不占正则。

### 4. 6.6 的正则额度算错了

`MAX_NUMBER_OF_REGEX_RULES = 1000`。按原设计每 tab 最多 64 条正则注入规则，16 个挂载 tab 就超限，表里却写"20 个 tab 也在 1300 以内"，那是总规则数，不是正则数。采纳第 3 条后这个问题自然消失，否则必须改。

### 5. 从会话 tab Cmd+click 范围内链接有竞态（3.2 T5 / 6.4）

`tabs.onCreated` 触发时，新 tab 的第一个请求已经在路上。对弹窗式 OAuth 无所谓，第一跳去的是 IdP；但 Cmd+click 站内链接的第一跳就是范围内 URL，这个请求带的是主会话 cookie，响应的 Set-Cookie 也会进主罐。结果是一个"已挂载"的 tab 显示着主会话身份。

建议：`onCreated` 里读 `tab.pendingUrl`，在范围内则 `applyRules` 后 `tabs.update` 到同一 URL 重来一次；e2e 用例 10 要明确用 Cmd+click 和 `target=_blank` 链接测，不能只测 `window.open`。

### 6. 方案 B 会把主会话登出（6.2 步骤 6）

"cookie 短暂存在于主会话，可接受"漏了一种情况：主会话本来就登着 A，会话 tab 登录 B 时响应 `Set-Cookie: sid=B` 先覆盖掉主罐里的 `sid=A`，然后 `cookies.remove` 把它删掉。主会话 A 就没了。方案 B 要么先 `cookies.get` 存旧值再恢复，要么直接放弃。方案 A 的验证要提到 M0 做，这是整个捕获路径的前提。

顺带：验收标准 12.7 "扩展从不向主会话写入"和方案 B 矛盾，也和第 2 条的注入竞态矛盾。

---

## P1：写轻了或自相矛盾

### 7. Clear-Site-Data 没提

站点登出常带 `Clear-Site-Data: "cookies", "storage"`。会话 tab 里点登出，浏览器会清掉主罐里该站的 cookie，以及 localStorage 里所有前缀的 key，等于一次把主会话和所有会话都登出。需要 DNR 移除该 tab 范围内响应的这个头，并在 capture.ts 里把它翻译成清空会话罐。

### 8. 第三方 iframe 能拿到会话 cookie（6.1）

注入规则只看 `tabIds + 主机名`，不看发起方。会话 tab 里嵌的 Stripe/广告 iframe 向 `example.com` 发的跨站请求也会被塞上会话 cookie，SameSite 形同虚设。加 `domainType: "firstParty"` 或 `initiatorDomains: [siteKey]`，要验证一下语义。

### 9. 三处异步延迟没写进限制

- `document.cookie = …` 之后立刻 `fetch()`：DNR 规则更新要绕一圈 service worker，这个 fetch 大概率不带新 cookie。
- XHR 响应 Set-Cookie 之后页面同步读 `document.cookie`：原生立即可见，这里要等广播。
- O3 "原 tab 不刷新即可通过 fetch 拿到新身份"：靠的是 refreshSession 抢在 opener 收到 postMessage 之前落地，e2e 用例 6 会 flaky。

第三条至少要在文档里说"通常能赢"，前两条写进第 7 节。

### 10. pending 永不过期（T6）

从会话 tab Cmd+click 一个外站链接，那个 tab 会一直 pending。几天后用户在地址栏输入 `example.com`，它突然变成会话 tab。`onCommitted` 带 `transitionType`，用户主动输入的导航（typed / auto_bookmark）应该清掉 pending。

### 11. nonce 防不了页面（5.3 / §9）

MAIN world 和 ISOLATED world 共享同一个 `window`，`postMessage` 谁都能监听，页面看一眼第一条消息就拿到 nonce。何况 5.3 说"固定的 nonce"，§9 说"注入时生成"，两处不一致。真正的防线在 background：用 `sender.url` 校验写入的 cookie domain 是否 domain-match 当前 frame，和浏览器自己的规则一样。nonce 可以留着挡误伤，别当安全边界。

### 12. `allFrames: true` 和"范围外一律不处理"冲突（6.3 vs 3.3 / 6.4）

6.3 用 `allFrames: true` 注入，会把补丁打进会话 tab 里的范围外 iframe。6.4 的伪代码已经是按 frame 判断的，6.3 应改为 `frameIds: [frameId]`。

### 13. 会话 cookie 永久持久化（5.4）

`expires: null` 的 cookie 本扩展也持久化，意味着银行类站点依赖"关浏览器即登出"的假设被打破，`purgeExpired` 也不会清它们，罐子只增不减。至少按 `updatedAt` 给个上限，并在 README 里说明。

### 14. webRequest 全局监听的代价

`onHeadersReceived` 挂在 `<all_urls>` 全部类型上，带 `extraHeaders`。这意味着浏览器每一个请求都经过扩展，service worker 基本不会睡。MV3 下没有更好的办法，但要写进第 9 节并在验收里加一条性能观察。

---

## P2：文档小问题

- 名字乱：标题 MultiTabs，popup 写 MultiSession，目录叫 `mst/`，仓库叫 MultiTabs。统一成 MultiTabs，前缀改 `mt:`。
- "参考仓库 1" 出现两次，没说是哪个仓库。
- 5.5 "`storage.local` 单项上限 10 MB" 不对，10 MB 是总配额，没有单项限制。按会话分 key 的理由改成"减小写放大"。
- T4 快捷键新建的会话叫什么名字没写。
- `etld1` 的 `n = 3` 分支是死代码，后缀表里没有三段后缀，删掉或补 `com.tw` 之外的三段例子。
- `isIp` 要处理 `url.hostname` 返回的带方括号 IPv6。
- e2e 用例 2 用 `https://api.localtest.me`，需要自签证书和 `--ignore-certificate-errors`，Secure cookie 也依赖 https，10.2 应写明。puppeteer 加载 unpacked 扩展需要 headful 或新版 headless。
- `Assignment` 冗余存了 `name`/`color`，S6 重命名时要同步刷所有挂载，提一句。

---

## 建议的改动顺序

1. 第 3 条改 DNR 规则生成，第 4 条随之消失。
2. 第 2 条改注入策略，把 Server-Timing 信号加进 13 节待验证。
3. 第 1 条把 SW 从"隔离"改成"阻断"。
4. 第 6 条把方案 A 验证提前到 M0。
5. 其余按 P1 列表补进第 7 节和测试用例。
