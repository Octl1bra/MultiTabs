# MultiTabs

同一个 Chrome 窗口里，同一个网站的多个标签页各自保持独立的登录态，同时在线、互不干扰。行为基准是 Firefox 的 Multi-Account Containers。

- Chrome MV3，最低 Chrome 132
- WXT + TypeScript；popup / options 用 React 19 + HeroUI v3 + Tailwind v4；后台和内容脚本零依赖
- 设计文档：[docs/multi-tabs-prd.md](docs/multi-tabs-prd.md)；技术验证记录：[docs/decisions.md](docs/decisions.md)；评审：[docs/prd-review.md](docs/prd-review.md)

## 安装

没上商店。到 [Releases](https://github.com/Octl1bra/MultiTabs/releases) 下载最新的 `multitabs-<版本>-chrome.zip`，解压，然后：

1. 打开 `chrome://extensions/`，右上角开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择解压出来的目录。

最低 Chrome 132。更新时下载新版本解压覆盖，再在扩展卡片上点刷新。

## 怎么用

1. 打开站点，点工具栏图标，输入会话名，点"新 tab"。新 tab 以未登录状态打开，在里面正常登录，登录态就进了这个会话。
2. 再点图标，列表里的会话可以"打开"（新 tab）或"此处"（当前 tab 切过去）。
3. "退出"让当前 tab 回到主会话。会话本身和它的 cookie 保留，下次还能用。
4. 快捷键 `⌘⇧Y` / `Ctrl+Shift+Y`：为当前站点新建一个会话并在新 tab 打开。
5. 从会话 tab 里打开的新 tab（含 `window.open`、`target=_blank`、Cmd+click）自动继承会话。

## 工作原理（一句话版）

每个挂载的 tab 有一组按 `tabIds` 过滤的 DNR session rules：剥掉主会话的 `Cookie` 头、注入会话罐里的 cookie、删掉响应的 `Set-Cookie`；`webRequest` 观察 `Set-Cookie` 写进会话罐。页面侧一个 MAIN world 的 document_start 脚本给 `document.cookie`、`localStorage` / `sessionStorage`、IndexedDB、CacheStorage、BroadcastChannel、Worker 打补丁做命名空间隔离；补丁靠 DNR 注入的 `Server-Timing` 响应头在页面第一段脚本之前同步得知自己属于哪个会话。详见 PRD 第 6 节。

## 已知限制

写在 PRD 第 7 节。挑几条最常碰到的：

- 第三方登录（Google / GitHub 等）走主会话，区分账号靠 IdP 的账号选择器；IdP 直接 "Continue as A" 的话两个会话会登成同一个人。
- Service Worker 在会话 tab 里被阻断（`register` 被拒、已有的被注销），依赖 SW 的站点退化为无 SW 模式。
- cookie 的 `Path` 属性被忽略。
- `document.cookie = …` 之后立刻发出的请求可能还没带上新 cookie（规则更新要绕一圈 service worker）。
- 会话 cookie（无过期时间）也会跨浏览器重启保留，30 天不更新才清。
- 浏览器重启后会话和 cookie 都在，但 tab 的挂载丢失，需要重新"此处"。
- `Clear-Site-Data: "storage"` 会清掉该站所有会话的 localStorage / IndexedDB，拦不住。

## 权限

| 权限 | 用途 |
|---|---|
| `declarativeNetRequest` | 按 tab 改写 `Cookie` / `Set-Cookie` / `Cache-Control` / `Server-Timing` 头 |
| `webRequest` | 观察响应里的 `Set-Cookie` 和 `Clear-Site-Data`（MV3 下只观察不阻塞） |
| `cookies` | `getPartitionKey` 算站点 key；`Clear-Site-Data` 后把误删的主罐 cookie 写回 |
| `scripting` | 信号缺失时的兜底注入 |
| `storage` | 会话与会话罐（local）、tab 挂载（session） |
| `tabs` / `webNavigation` | 挂载生命周期、新 tab 继承、角标 |
| `host_permissions: <all_urls>` | 以上都需要 |

会话罐明文存在 `chrome.storage.local`，可读性与浏览器自身的 cookie 库相当。不发起任何网络请求，不收集遥测。

## 开发

```bash
pnpm install
pnpm dev          # WXT 开发模式，加载 .output/chrome-mv3-dev
pnpm build        # 产物在 .output/chrome-mv3
pnpm test         # vitest 单测
pnpm test:e2e     # puppeteer e2e，需要本机 Chrome 和 openssl；会自己起测试站点
pnpm typecheck && pnpm lint
```

e2e 的启动方式（品牌版 Chrome 不认 `--load-extension`，走 `installExtension()`）和踩过的坑都在 `docs/decisions.md`。
