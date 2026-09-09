# MultiTabs — Chrome 多会话标签页扩展

## 0. 说明

这份文档既是产品需求，也是技术设计。实现时按第 11 节的里程碑推进，每个里程碑完成后跑第 10 节对应的测试再进入下一个。

**修订记录**

- v2（2026-09-09）：按 `docs/prd-review.md` 修订。主要变化：注入规则改为可枚举生成，删掉 hostsSeen；补丁改为静态 MAIN world document_start 脚本 + 同步信号；ServiceWorker 从"隔离"改为"阻断"；补 Clear-Site-Data、HTTP 缓存、第三方 iframe 三处漏洞；方案 B 加保存恢复；Cmd+click 竞态处理；pending 过期；nonce 降级为非安全边界；统一命名为 MultiTabs。
- v1：初稿。

**硬性约束（不得违反）：**

1. Chrome Manifest V3，最低版本 Chrome 132。
2. `background`（service worker）和所有 content script **只用原生 TypeScript**，不引入 React、HeroUI、Tailwind 或任何 UI 库。
3. UI 只存在于扩展自己的页面（popup、options），统一使用 **HeroUI v3 + React 19 + Tailwind CSS v4**。
4. content script 永远不向宿主页面注入 Tailwind 或任何全局样式。
5. 扩展页面遵守 MV3 默认 CSP：无内联脚本、无 `eval`、无远程脚本。
6. 锁定依赖小版本（`~`），不自动升级 HeroUI。包管理器 pnpm。
7. 每个 P0 功能都要有对应测试（第 10 节）。

**HeroUI v3 的用法以官方文档为准**（https://heroui.com/docs/react ，`https://heroui.com/react/llms.txt`），v3 是重写，API 与 v2 不兼容，不要凭记忆写。

---

## 1. 背景与目标

### 1.1 问题

Chrome 的 cookie 罐按 profile 共享，同一个网站在同一个窗口里只能登录一个账号。要切换账号只能：登出重登、开无痕窗口、开另一个 profile（另一个窗口）。Firefox 有原生容器，Chrome 没有，只能靠扩展。商店里的同类扩展多为闭源，隔离质量参差不齐；开源实现要么是半成品，要么是"切换式"（同一时刻只有一套 cookie 生效），不能做到多个 tab 同时在线。

### 1.2 目标

在**同一个 Chrome 窗口**里，让**同一个网站的多个 tab 各自持有独立的登录态**，同时在线、互不干扰。行为基准是 Firefox Multi-Account Containers。

### 1.3 非目标

- 不做浏览器指纹 / IP / UA 隔离，不做反检测（anti-detect）。
- 不隔离第三方（Google、统计脚本等）——第三方走浏览器主会话，见 3.5。
- 不做云同步、多设备同步、账号密码管理。
- 不在宿主页面内渲染任何 UI（P2 再议）。
- 不支持 Firefox / Safari（MV3 + Chrome 专用 API）。
- 不隔离 Service Worker（阻断，见 6.3）。

### 1.4 目标用户与场景

- 开发 / 测试：同时用 Admin、普通用户、候选人三种角色登录同一个后台，对比行为。
- 运营：同一平台管理多个店铺 / 账号。
- 个人：工作账号和私人账号同站并存。

---

## 2. 核心概念与术语

| 术语 | 定义 |
|---|---|
| **主会话 (main session)** | 浏览器 profile 自带的那个共享 cookie 罐。没挂会话的 tab 和所有第三方请求都走这里。 |
| **会话 (Session)** | 一个命名的、持久化的独立 cookie 罐 + 存储命名空间。属于一个站点。 |
| **站点 key (siteKey)** | 会话所属的站点标识。`scope=site` 时是 eTLD+1（如 `example.com`），`scope=host` 时是完整主机名（如 `www.example.com`）。 |
| **作用域 (scope)** | `site`（默认，整个 eTLD+1）或 `host`（仅精确主机名）。创建时决定，之后不可改。 |
| **eTLD+1** | 可注册域。`www.example.com → example.com`；`www.bonjour.com.cn → bonjour.com.cn`；`libra.github.io → libra.github.io`。 |
| **挂载 (Assignment)** | tab 与会话的绑定关系。一个 tab 最多挂一个会话；一个会话可以挂多个 tab。 |
| **范围内 URL (in-scope)** | URL 的主机名落在会话 siteKey 之内。site 作用域：`host === siteKey \|\| host.endsWith('.' + siteKey)`；host 作用域：`host === siteKey`。 |
| **会话罐 (jar)** | 会话持有的 cookie 集合，带完整属性（domain / path / secure / httpOnly / expires / hostOnly）。 |
| **pending 挂载** | 从已挂载 tab 打开的新 tab / 弹窗，在它第一次落到范围内 URL 之前的"待挂载"状态。 |
| **同步信号 (signal)** | 页面脚本在 document_start 就能同步读到的、告诉补丁"这个文档属于哪个会话"的数据。由 DNR 注入的 `Server-Timing` 响应头承载。 |

---

## 3. 功能需求

优先级：P0 = 第一个可用版本必须有；P1 = 第二个版本；P2 = 以后。

### 3.1 会话管理

| ID | 需求 | 优先级 |
|---|---|---|
| S1 | 在当前站点下创建命名会话（名称 ≤ 40 字符，同站点内不重名），自动分配调色板颜色（同站点内按创建顺序循环） | P0 |
| S2 | 创建时选择作用域：默认 `site`，可勾选"仅隔离当前主机名"切到 `host` | P0 |
| S3 | 列出当前站点的所有会话：名称、颜色、cookie 数、最后使用时间 | P0 |
| S4 | 会话和会话罐持久化到 `chrome.storage.local`，浏览器重启后保留 | P0 |
| S5 | 删除会话（连同会话罐），已挂载的 tab 退回主会话并刷新 | P0 |
| S6 | 重命名会话、改颜色 | P1 |
| S7 | 清空会话罐（等于在该会话里"登出"，但保留会话名） | P1 |
| S8 | 导出 / 导入会话罐（JSON，含警告） | P2 |

### 3.2 tab 挂载与继承

| ID | 需求 | 优先级 |
|---|---|---|
| T1 | **New tab**：在新 tab 里以指定会话打开当前 URL | P0 |
| T2 | **Use here**：把当前 tab 挂到指定会话并刷新 | P0 |
| T3 | **Leave**：当前 tab 退回主会话并刷新 | P0 |
| T4 | 快捷键（默认 `Ctrl/Cmd+Shift+Y`）：为当前站点新建会话（自动命名"会话 N"）并在新 tab 打开 | P0 |
| T5 | 从已挂载 tab 打开的新 tab / 弹窗（`openerTabId` 指向已挂载 tab）**无条件进入 pending，并立即安装与父 tab 相同的 DNR 规则**。新 tab 的第一个请求几乎总是抢在规则之前发出，所以转正时若导航早于规则就绪就**重新导航一次**（6.4） | P0 |
| T6 | pending 不因中途导航到范围外 URL 而丢失；在 tab 关闭、或用户主动发起导航（`transitionType` 为 `typed / auto_bookmark / generated / keyword`）时清除。第一次落到范围内 URL 时正式挂载 | P0 |
| T7 | tab 关闭 → 清除挂载和该 tab 的 DNR 规则 | P0 |
| T8 | tab→会话映射存 `chrome.storage.session`（浏览器重启后 tab 需重新挂载） | P0 |
| T9 | 挂载的 tab 导航到范围外 URL 时，**规则保留、挂载保留**，只是角标变灰 | P0 |
| T10 | 挂载 tab 的工具栏角标显示会话颜色，title 显示 `会话名 · siteKey` | P0 |

### 3.3 隔离范围

对挂载 tab 内**范围内 URL** 的请求和页面，处理以下内容（全部 P0）：

| 层 | 内容 | 机制 |
|---|---|---|
| HTTP | 请求 `Cookie` 头（剥掉主会话的，注入会话罐的），含 HttpOnly cookie | DNR |
| HTTP | 响应 `Set-Cookie` 头（写入会话罐，不进主会话） | webRequest 观察 + DNR 删头 / cookies 保存恢复 |
| HTTP | 响应 `Clear-Site-Data` 头：翻译成清空会话罐；浏览器对主罐的清除拦不住（网络层先于 DNR 处理），靠 `cookies.onChanged` 把被删的主罐 cookie 写回 | webRequest 观察 + cookies.onChanged 恢复 |
| HTTP | 共享 HTTP 缓存（防止主会话的个性化页面被缓存后喂给会话 tab） | DNR 给 main_frame / sub_frame / xmlhttprequest 请求加 `Cache-Control: no-cache` 强制回源校验 |
| HTTP | 第三方 iframe 发起的跨站请求不注入会话 cookie（保住 SameSite 语义） | 注入规则对非 main_frame 类型加 `domainType: "firstParty"` |
| 页面 | `document.cookie` 读写 | main-world 补丁 |
| 页面 | `cookieStore` API | main-world 补丁 |
| 页面 | `localStorage`、`sessionStorage` | key 前缀代理 |
| 页面 | `IndexedDB`（数据库名前缀）、`CacheStorage`（cache 名前缀）、`BroadcastChannel`（频道名前缀） | main-world 补丁 |
| 页面 | `Worker`、`SharedWorker` 的同源脚本 | 前置 prelude 后以 blob URL 加载；跨源或失败回退原始脚本 |
| 页面 | `ServiceWorker` | **阻断**：`register` 返回 reject，已注册的同 scope SW 注销 |

范围外 URL（第三方 CDN、统计、iframe、OAuth 提供方）**一律不处理**，行为与未安装扩展相同。

### 3.4 作用域判定

| ID | 需求 | 优先级 |
|---|---|---|
| A1 | `site` 作用域的 siteKey 用 eTLD+1；优先调用 `chrome.cookies.getPartitionKey({tabId})` 取 `topLevelSite`（Chrome 132+），失败时回退到内置后缀表 | P0 |
| A2 | 内置后缀表覆盖：`com.cn net.cn org.cn gov.cn edu.cn ac.cn co.uk org.uk ac.uk gov.uk co.jp ne.jp or.jp com.hk com.tw com.au com.br com.sg com.my co.kr co.in github.io gitlab.io vercel.app netlify.app pages.dev herokuapp.com web.app firebaseapp.com`；其余取最后两段；IP 地址（含带方括号的 IPv6）和 `localhost` 原样返回 | P0 |
| A3 | siteKey 在 UI 中始终可见（会话列表、角标 title），让用户能发现算错的情况 | P0 |
| A4 | 后缀表做成独立模块 `lib/etld.ts`，纯函数，可单测 | P0 |

### 3.5 第三方 OAuth / SSO 行为

**决策：第三方 IdP（Google、GitHub、微信等）走主会话，站点自己的 cookie 进会话罐。**

| ID | 需求 | 优先级 |
|---|---|---|
| O1 | 跳转式 OAuth：tab 跳到 IdP 时挂载和规则都保留（T9），IdP 302 回跳到站点 callback 的第一个请求就已经被规则处理（不带主会话 cookie，带会话罐里的 `state` cookie），callback 响应的 Set-Cookie 进会话罐 | P0 |
| O2 | 弹窗式 OAuth：`window.open` 打开的弹窗按 T5/T6 进入 pending（规则已在位），在 IdP 页面停留期间不丢失，回跳到站点 callback 的请求不带主会话 cookie，响应的 Set-Cookie 进会话罐，同时正式挂载 | P0 |
| O3 | 弹窗 callback 写入会话罐后，同会话的所有 tab 的注入规则立刻刷新（原 tab 拿到新 cookie）。这条依赖规则刷新赶在原 tab 的下一次请求之前，通常能赢，不保证 | P0 |
| O4 | **不实现**"从主会话吸收 cookie"的补救逻辑；有了 O2 就不需要 | P0 |
| O5 | 已知限制写进 README：区分账号依赖 IdP 的账号选择器；如果 IdP 直接 "Continue as A"，两个会话会登成同一个人 | P0 |

### 3.6 站点绑定与标签页分组

| ID | 需求 | 优先级 |
|---|---|---|
| G1 | 挂载 tab 自动加入以会话颜色 + 名称命名的标签页分组（`chrome.tabGroups`），Leave 时移出 | P1 |
| G2 | "Always open this site in…"：把 siteKey 绑定到某个会话；在主会话 tab 打开该站点时自动挂载（等价于 Use here，需要一次重载） | P1 |
| G3 | 绑定可在 options 页查看、解除 | P1 |
| G4 | "Sort tabs by session"：按会话把窗口内 tab 重新排序 | P2 |

### 3.7 UI

| ID | 需求 | 优先级 |
|---|---|---|
| U1 | popup：固定宽 360px，高度自适应但 ≤ 520px；结构见第 8 节 | P0 |
| U2 | options 页（管理页）：全部会话按站点分组、绑定列表、删除/重命名/清空 | P0（删除）/ P1（其余） |
| U3 | 深色模式跟随系统 | P0 |
| U4 | popup 在非 http/https 页面（`chrome://`、新标签页）显示提示，不显示操作 | P0 |
| U5 | 所有操作有失败反馈（内联 alert） | P0 |
| U6 | 中英文文案（先中文，英文 P1） | P0 |

---

## 4. 关键用户流程

### 4.1 首次为一个站点建会话

1. 用户在 `https://www.example.com/dashboard` 点扩展图标。
2. popup 显示当前站点 `example.com`（site 作用域算出的 key），会话列表为空。
3. 输入名称 "QA"，作用域保持默认，点 **New tab**。
4. 扩展创建会话 → 新开 tab，先挂载再导航到当前 URL → 页面以未登录状态打开。
5. 用户在这个 tab 登录 QA 账号；登录响应的 Set-Cookie 全部进 "QA" 会话罐。
6. 原 tab 仍是主会话，登录态不受影响。

### 4.2 复用已有会话

1. 用户在 `example.com` 任意页面点图标，列表里看到 "QA · 7 cookies"。
2. 点 **Open** → 新 tab 以 QA 打开当前 URL，已登录。
3. 或点 **Here** → 当前 tab 刷新为 QA 身份。

### 4.3 弹窗式 Google 登录（在会话 tab 里）

1. 会话 tab 里点"使用 Google 登录"，站点 `window.open('https://accounts.google.com/...')`。
2. 弹窗 `openerTabId` 指向会话 tab → 进入 pending（不看 URL），规则装上。
3. 弹窗停在 Google（范围外，主会话的 Google 登录态），用户选账号。
4. Google 回跳 `https://www.example.com/auth/callback?code=…` → 范围内 → 弹窗正式挂载；这个 callback 请求已经不带主会话 cookie。
5. callback 的 Set-Cookie 写进会话罐 → 会话内所有 tab 的注入规则刷新。
6. 弹窗关闭，原 tab 刷新或 fetch `/me`，带的是新 cookie，登录成功。

### 4.4 退出会话

点 **Leave** → 移除该 tab 的规则和挂载，刷新 → 页面回到主会话身份。会话罐不受影响。

### 4.5 删除会话

options 页点删除 → 二次确认 → 删除会话对象和会话罐；该会话所有挂载 tab 执行 Leave 逻辑。

---

## 5. 技术架构

### 5.1 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 构建 | **WXT ~0.21** + Vite + TypeScript ~5.9 + pnpm | WXT 管 manifest 生成、入口、HMR、打包 |
| UI | **React 19 + HeroUI v3（`@heroui/react`、`@heroui/styles` ~3.2）+ Tailwind CSS v4** | 只用于 popup / options |
| 后台 | 原生 TS，无框架 | service worker 频繁唤醒，必须轻 |
| 内容脚本 | 原生 TS | MAIN world 补丁 + ISOLATED world 消息桥 |
| 测试 | Vitest（纯函数单测）+ puppeteer-core（e2e，本地 HTTPS 测试站） | 见第 10 节 |
| Lint | ESLint + Prettier + `tsc --noEmit` | CI 必过 |

### 5.2 目录结构

```
MultiTabs/
├── wxt.config.ts
├── package.json
├── docs/                        # PRD、评审、决策记录
├── entrypoints/
│   ├── background.ts            # service worker 入口（原生 TS）
│   ├── bridge.content.ts        # ISOLATED world，<all_urls>，document_start：消息桥
│   ├── patch.content.ts         # MAIN world，<all_urls>，document_start：补丁本体（自包含）
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── options/
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
├── src/
│   ├── background/
│   │   ├── sessions.ts          # 会话 CRUD、持久化
│   │   ├── jar.ts               # 会话罐：存取、匹配、过期清理
│   │   ├── assignments.ts       # tab 挂载 / pending / 生命周期
│   │   ├── rules.ts             # DNR 规则生成与刷新
│   │   ├── capture.ts           # webRequest Set-Cookie / Clear-Site-Data 捕获
│   │   ├── inject.ts            # 补丁的兜底注入（executeScript）
│   │   ├── badge.ts
│   │   ├── groups.ts            # P1 标签页分组
│   │   ├── bindings.ts          # P1 站点绑定
│   │   └── messages.ts          # 消息路由
│   ├── page/
│   │   ├── install.ts           # 补丁安装逻辑（被 patch.content.ts 调用，无外部依赖）
│   │   └── signal.ts            # 读取同步信号
│   ├── lib/
│   │   ├── etld.ts              # eTLD+1 计算 + 后缀表
│   │   ├── cookie.ts            # Set-Cookie 解析、匹配、序列化
│   │   ├── scope.ts             # isInScope、siteKeyFor
│   │   ├── rulegen.ts           # 纯函数：会话罐 → DNR 规则集合（可快照测试）
│   │   ├── signal.ts            # 同步信号的编解码（background 和 page 共用）
│   │   ├── ids.ts
│   │   └── types.ts
│   ├── ui/                      # popup/options 共用的 React 组件
│   │   ├── SessionList.tsx
│   │   ├── SessionRow.tsx
│   │   ├── NewSessionForm.tsx
│   │   ├── ScopeBadge.tsx
│   │   ├── i18n.ts
│   │   └── theme.ts             # 深色模式、调色板
│   └── messaging.ts             # popup/options/content ↔ background 的类型化消息
├── test/
│   ├── unit/                    # vitest
│   ├── e2e/                     # puppeteer
│   └── fixtures/site/           # 本地测试站（多子域、OAuth 模拟、自签证书）
└── README.md
```

### 5.3 模块职责

- **background.ts**：顶层同步注册所有 Chrome 事件监听（MV3 要求，否则唤不醒），把逻辑分发到 `src/background/*`。不在内存里保存任何不可重建的东西。
- **sessions.ts**：`createSession / listSessionsForSite / deleteSession / renameSession`。
- **jar.ts**：`getCookies(sessionId) / upsert / remove / clear / purgeExpired / cookiesForHost(sessionId, host, {includeHttpOnly})`。
- **assignments.ts**：`assign(tabId, sessionId) / leave(tabId) / getAssignment(tabId) / setPending(tabId, sessionId) / promotePending(tabId) / clearPending(tabId)`；监听 `tabs.onCreated / onUpdated / onRemoved`。per-tab 互斥队列。
- **rules.ts**：`applyRules(tabId)`（幂等：先删该 tab 旧规则再加，一次 `updateSessionRules`）、`refreshSession(sessionId)`（对会话内所有 tab 重跑）。规则内容由 `lib/rulegen.ts` 纯函数生成。
- **capture.ts**：`webRequest.onHeadersReceived` 监听器。
- **inject.ts**：兜底路径。`webNavigation.onCommitted` 时对挂载 tab 的范围内 frame 调 `executeScript`，先写 `window.__MT_CFG__` 再重跑补丁。主路径是静态脚本 + 信号，见 6.3。
- **bridge.content.ts**：ISOLATED world。把 main world 的 cookie 写操作转发给 background；把 background 推送的 cookie 更新转发给 main world。通过 `window.postMessage` 通信，消息带 `source: "mt"` 标记。**不是安全边界**，见第 9 节。
- **patch.content.ts**：MAIN world，document_start，`<all_urls>`，`all_frames`，`match_origin_as_fallback`。启动时读同步信号：有 → 安装补丁；无 → 什么都不做（不留全局变量）。必须自包含，不 import 任何带副作用的模块。

### 5.4 数据模型

```ts
// src/lib/types.ts
export type Scope = "site" | "host";

export interface Session {
  id: string;            // 随机 id，12 位
  name: string;          // ≤ 40 字符
  siteKey: string;       // "example.com" | "www.example.com"
  scope: Scope;
  color: string;         // 调色板之一，hex
  createdAt: number;
  lastUsedAt: number;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;        // 规范化：小写、无前导点
  hostOnly: boolean;     // Set-Cookie 未带 Domain 属性时为 true
  path: string;          // 默认按 RFC 6265 从请求路径推导
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none" | "unspecified";
  expires: number | null; // epoch ms；null = 会话 cookie，本扩展仍持久化，但 updatedAt 起 30 天后视为过期
  updatedAt: number;
}

export interface Assignment {
  sessionId: string;
  siteKey: string;
  scope: Scope;
}
// 名称、颜色从 sessions 表读，不冗余存，避免重命名后不同步。

export interface SiteBinding {      // P1
  siteKey: string;
  sessionId: string;
}

/** 同步信号 / 兜底注入共用的补丁配置 */
export interface PatchConfig {
  sid: string;                       // sessionId
  cookies: PageCookie[];             // 当前文档主机可见的非 HttpOnly cookie
}
export interface PageCookie {
  name: string; value: string; domain: string; hostOnly: boolean;
  path: string; secure: boolean; sameSite: StoredCookie["sameSite"]; expires: number | null;
}
```

cookie 的唯一 key：`${domain}|${path}|${name}`。

### 5.5 存储布局

| 区域 | key | 值 | 说明 |
|---|---|---|---|
| `storage.local` | `sessions` | `Record<sessionId, Session>` | |
| `storage.local` | `jar:<sessionId>` | `Record<cookieKey, StoredCookie>` | 每个会话一个 key，减小写放大 |
| `storage.local` | `bindings` | `Record<siteKey, sessionId>` | P1 |
| `storage.local` | `settings` | `{ language, … }` | |
| `storage.session` | `tab:<tabId>` | `Assignment` | 正式挂载 |
| `storage.session` | `pending:<tabId>` | `Assignment` | pending 挂载 |
| `storage.session` | `rules:<tabId>` | `number[]` | 该 tab 当前持有的 DNR 规则 id |
| `storage.session` | `ruleSeq` | `number` | 规则 id 自增计数器 |

`storage.local` 总配额 10 MB（无单项限制）；正常使用远达不到，不申请 `unlimitedStorage`。`storage.session` 配额 10 MB。

---

## 6. 隔离引擎设计

### 6.1 请求层：DNR 规则

全部用 **session rules**（`chrome.declarativeNetRequest.updateSessionRules`），浏览器重启自动清空，与 `storage.session` 的挂载生命周期一致。所有规则条件都带 `tabIds: [tabId]`。

`lib/rulegen.ts` 是纯函数：`(tabId, assignment, jar, idAllocator) → Rule[]`，可快照测试。

**(a) 基础规则，每 tab 一条，priority 1000**

```ts
{
  condition: { tabIds, resourceTypes: ALL_RESOURCE_TYPES, ...scopeMatcher },
  action: { type: "modifyHeaders",
    requestHeaders:  [{ header: "Cookie", operation: "remove" }],
    responseHeaders: [{ header: "Set-Cookie", operation: "remove" },
                      { header: "Clear-Site-Data", operation: "remove" }] }
}
```

`scopeMatcher`：site 作用域用 `requestDomains: [siteKey]`（天然匹配子域，不占正则额度）；host 作用域用 `regexFilter: ^https?://${escape(host)}(?::\d+)?(?:/|$)`。

删 `Clear-Site-Data` 这条实测无效（见 `docs/decisions.md` 第 5 节）：Chrome 在网络服务里处理该头，早于 DNR 的响应头修改。留着无害，但真正的补救在 6.2 步骤 4。

**(a2) 信号规则，每 tab 一条，priority 1000**

```ts
{
  condition: { tabIds, resourceTypes: ["main_frame", "sub_frame"], ...scopeMatcher },
  action: { type: "modifyHeaders",
    responseHeaders: [{ header: "Server-Timing", operation: "append", value: signalFor(sid, []) }] }
}
```

罐子为空时也要有信号，否则第一次加载（登录页）补丁装不上，localStorage 就写进主命名空间了。target 规则会再 append 一条带 cookie 的信号，页面取 cookie 最全的那条。

**(b) 缓存规则，每 tab 一条，priority 1000**

```ts
{
  condition: { tabIds, resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"], ...scopeMatcher },
  action: { type: "modifyHeaders",
    requestHeaders: [{ header: "Cache-Control", operation: "set", value: "no-cache" }] }
}
```

强制这些请求回源校验，避免主会话缓存的个性化页面直接喂给会话 tab。静态资源不加，代价太大。

**(c) 注入规则，可枚举**

会话罐里每条 cookie 要么 `hostOnly=true`（主机名已知），要么 `hostOnly=false`（`requestDomains: [domain]` 天然匹配所有子域）。因此需要注入的"目标"集合是可枚举的：

```
targets = { cookie.domain : cookie ∈ jar }        // 不分 hostOnly，domain 已规范化无前导点
```

对每个 target `T`：

- `value(T)` = 罐中满足 `domainMatches(T, c.domain, c.hostOnly)` 且未过期的 cookie，按 RFC 6265 排序（path 长的在前，其次创建早的在前）后 `name=value; ` 拼接。**忽略 path 属性**（已知限制）。
- `priority(T)` = `3000 + labels(T)`，其中 `labels` 是 `T` 的点分段数。请求同时命中多个 target 时 DNR 只应用最高优先级的 `set`，所以更具体的 target 的 value 必须包含所有父 domain 的 cookie（`domainMatches` 已保证）。
- hostOnly 主机也用 `requestDomains: [T]`，会连带匹配 `T` 的子域。这是同站同会话内的近似，接受。
- host 作用域下所有注入规则改用 `regexFilter` 精确匹配 siteKey，且只有 `T` 能 domain-match siteKey 的 target 才生成。

每个 target 生成两组规则：

```ts
// 导航请求：不加 domainType（重定向回跳的 initiator 是 IdP，加了会漏掉 OAuth callback）
{ priority, condition: { tabIds, requestDomains: [T], resourceTypes: ["main_frame", "sub_frame"], urlFilter: "|https:" },
  action: { type: "modifyHeaders",
    requestHeaders:  [{ header: "Cookie", operation: "set", value: valueHttps }],
    responseHeaders: [{ header: "Server-Timing", operation: "append", value: signalFor(T) }] } }

// 其它请求：只对第一方发起的注入，保住 SameSite 语义
{ priority, condition: { tabIds, requestDomains: [T], excludedResourceTypes: ["main_frame", "sub_frame"], domainType: "firstParty", urlFilter: "|https:" },
  action: { type: "modifyHeaders", requestHeaders: [{ header: "Cookie", operation: "set", value: valueHttps }] } }
```

若 `value(T)` 里存在非 secure cookie，再各生成一条 `urlFilter: "|http:"` 的变体，value 只含非 secure cookie。

`signalFor(T)` 见 6.3：`mt;desc="<base64url(JSON PatchConfig)>"`，cookies 只含 value(T) 里的非 HttpOnly 项。

**规则 id 分配**：`storage.session.ruleSeq` 自增；每个 tab 的规则 id 记在 `rules:<tabId>`。`applyRules(tabId)` 先 `removeRuleIds` 旧集合再 `addRules`，一次 `updateSessionRules` 调用完成。

**规则保留策略**：规则只与"tab 是否挂载（含 pending）"绑定，**不随当前 URL 变化而增删**（T9）。tab 在范围外页面时，这些规则因为条件不匹配而自然不生效。

### 6.2 响应层：Set-Cookie / Clear-Site-Data 捕获

```ts
chrome.webRequest.onHeadersReceived.addListener(
  handler,
  { urls: ["<all_urls>"], types: ALL_RESOURCE_TYPES },
  ["responseHeaders", "extraHeaders"]     // 没有 extraHeaders 看不到 Set-Cookie
);
```

`handler`：

1. `details.tabId < 0` → 忽略。
2. 取该 tab 的正式挂载；没有则看 pending：若 `details.url` 在 pending 会话范围内且 `details.type === "main_frame"`，先执行 `promotePending(tabId)`（规则已在位，这里只是转正），再继续；否则忽略。
3. `details.url` 不在范围内 → 忽略。
4. 若有 `Clear-Site-Data` 头且指令含 `"cookies"` 或 `"*"` → `jar.clear(sessionId)`（只清 domain-match 当前主机的 cookie）；含 `"storage"` → 向该 tab 广播 `clearStorage`，由补丁清掉带前缀的 localStorage / IDB / caches。**主罐保护**：浏览器会先于 DNR 处理这个头并清掉主罐里该站的 cookie，所以监听器在同步阶段一看到该头就为这个 eTLD+1 开一个 1.5 s 的窗口，把窗口内 `cookies.onChanged` 报上来的删除缓冲住；异步确认这确实是会话 tab 的响应后，用 `cookies.set` 把它们原样写回。`"storage"` 指令对主命名空间和所有会话前缀的清除拦不住，记入限制。
5. 解析所有 `Set-Cookie` 头（`lib/cookie.ts`：完整属性，处理 `Max-Age` 优先于 `Expires`、`Domain` 合法性校验——不得高于 eTLD+1、不得是不相干域）。
6. 删除类（`Max-Age<=0` 或过期）→ 从会话罐删；否则 upsert。
7. **阻止进入主会话**：
   - **A（首选，已写进 6.1(a)）**：DNR 删响应 `Set-Cookie` / `Clear-Site-Data` 头，webRequest 仍能观察到原始头。**M0 的第一件事就是验证这条**：写最小扩展确认 `onHeadersReceived` 在 DNR 删响应头后仍看得到 `Set-Cookie`。
   - **B（回退）**：不用 DNR 删。捕获前先 `chrome.cookies.get` 保存主罐里同名 cookie 的旧值，捕获后 `chrome.cookies.remove`，若有旧值则 `chrome.cookies.set` 恢复。直接 remove 会把主会话已登录的账号登出。存在几十毫秒的窗口期。
8. 触发 `refreshSession(sessionId)`：会话内所有 tab 重跑 `applyRules`，并向这些 tab 的 bridge 广播 `cookiesUpdated`（只含非 HttpOnly cookie），让页面里的 `document.cookie` 视图同步。

注意 **webRequest 在 MV3 只能观察不能阻塞**，所以捕获与 DNR 修改是两条独立的路径，不要指望在 webRequest 里改头。这个监听器挂在 `<all_urls>` 上，意味着 service worker 基本不会睡；这是设计的代价，第 12 节有性能观察项。

### 6.3 页面层：main-world 补丁

**主路径：静态脚本 + 同步信号。**

`entrypoints/patch.content.ts` 在 manifest 里静态注册：`world: "MAIN"`，`run_at: "document_start"`，`matches: ["<all_urls>"]`，`all_frames: true`，`match_origin_as_fallback: true`。这是唯一能保证跑在页面第一段内联脚本之前的方式。

启动时按顺序找信号：

1. `performance.getEntriesByType("navigation")[0]?.serverTiming` 里 `name === "mt"` 的项，`description` 解出 `PatchConfig`；可能有多条（6.1(a2) 和 6.1(c) 各 append 一条），取 cookies 最多的。这个头由 DNR 按 tab 注入，只有挂载 tab 的范围内文档才有。同源文档读自己的 Server-Timing 不需要 `Timing-Allow-Origin`。缓存命中的导航也带（已验证）。
2. 没有导航条目的文档（`about:blank` / `srcdoc` / `blob:` iframe）：`try { parent.__mt__?.cfg }`，同源才能读到，跨源抛错即放弃。
3. `window.__MT_CFG__`：兜底路径由 `inject.ts` 写入，读完即删。

三个都没有 → 直接 return，不留任何全局。有 → `install(cfg)`，并暴露 `window.__mt__ = { installed: true, cfg }`（只在会话 tab 的范围内文档存在）。

**兜底路径**：`webNavigation.onCommitted` 对挂载 tab 的范围内 frame（按 `frameId` 逐个，不用 `allFrames`）调 `executeScript`：先跑一个小函数，若 `window.__mt__.installed` 已为真就只调 `__mt__.update(cfg.cookies)` 同步 cookie 视图并返回；否则写 `window.__MT_CFG__ = cfg` 再注入 `files: ["content-scripts/patch.js"]`。补丁幂等。兜底路径晚于内联脚本，只为覆盖信号失效的情形（信号超长、站点响应头异常等）。

补丁内容：

| 目标 | 做法 |
|---|---|
| `document.cookie` | `Object.defineProperty(Document.prototype, "cookie", {get, set})`。get 返回会话视图（内存副本，初值来自 cfg.cookies，由 bridge 推送更新）；set 解析后写入内存副本并 `postMessage` 给 bridge → background 校验后写会话罐。 |
| `cookieStore` | 若存在，替换为同样后端的最小实现（`get/getAll/set/delete`、`change` 事件）。 |
| `localStorage` / `sessionStorage` | `Proxy` 包装原对象：所有 key 加前缀 `mt:<sid>:`；`length / key(i) / clear()` 只作用于带前缀的 key；捕获阶段拦截 `storage` 事件，过滤并重新派发去前缀的事件。 |
| `indexedDB` | 包装 `IDBFactory.prototype.open / deleteDatabase / databases`，数据库名加前缀；`databases()` 结果过滤去前缀。`IDBDatabase.name` 会暴露前缀，记入限制。 |
| `caches` | 包装 `open / has / delete / keys / match`，cache 名加前缀。 |
| `BroadcastChannel` | 子类化，构造时频道名加前缀。 |
| `Worker` / `SharedWorker` | 同源脚本 URL → 同步 XHR 拉取源码，前置一段安装 IndexedDB/caches/BroadcastChannel 前缀的 prelude，转成 blob URL 加载；跨源或拉取失败 → 用原 URL（不隔离，记日志）。blob URL 会改变 `self.location`，依赖它算 publicPath 的打包产物可能挂，记入限制。 |
| `navigator.serviceWorker` | `register` 返回 `Promise.reject(new DOMException("blocked by MultiTabs", "SecurityError"))`；安装时对 `getRegistrations()` 里的每个 registration 调 `unregister()`。SW 按 origin 共享不分 tab，且 SW 内部 fetch 的 tabId 为 -1，无法隔离，只能阻断。 |

**禁止**：补丁不得引用 `chrome.*`（main world 没有），不得依赖任何外部模块，不得改变 `window.name` 或页面可见行为。

### 6.4 tab 生命周期

```
tabs.onCreated(tab)
  ├─ tab.openerTabId 无挂载（含 pending）→ 忽略
  └─ opener 已挂载 → setPending(tab.id, assignment) → applyRules(tab.id) → 记 rulesReadyAt[tab]

webNavigation.onBeforeNavigate({tabId, frameId:0, timeStamp})
  → 记 navStartedAt[tab]（内存即可）

promotePending(tabId, url)   // onCommitted 和 onHeadersReceived 都可能触发，per-tab 互斥
  → pending 转正
  → 若 navStartedAt[tab] 不晚于 rulesReadyAt[tab]（或缺失）→ tabs.update(tabId, { url })
     // 这次导航的请求发出时规则还没装好，带的是主罐 cookie，重来一次。
     // window.open / target=_blank / Cmd+click 三种情况都会命中；弹窗式 OAuth 第一跳去 IdP 不在范围内，回跳时导航晚于规则，不会重来

webNavigation.onCommitted({tabId, frameId, url, transitionType})
  ├─ 有正式挂载
  │    ├─ url 在范围内 → inject(tabId, frameId)（兜底）; frameId===0 时 badge 亮
  │    └─ 范围外 → frameId===0 时 badge 灰（规则不动）
  ├─ 有 pending
  │    ├─ frameId===0 且 transitionType ∈ {typed, auto_bookmark, generated, keyword} → clearPending（用户主动导航，不再继承）
  │    ├─ frameId===0 且 url 在范围内 → promotePending → inject → badge 亮
  │    └─ 其他 → 忽略（pending 保留）
  └─ 其他 → 忽略

tabs.onRemoved(tabId)
  → 删 tab:/pending:/rules: 三个 key，removeRuleIds

tabs.onActivated
  → 刷新角标

runtime.onStartup / onInstalled
  → storage.session 已由浏览器清空，无需处理；清理过期 cookie（jar.purgeExpired）
```

`promotePending` 的竞态：6.2 步骤 2 里也会触发 promote（`onHeadersReceived` 可能比 `onCommitted` 先到）。两处都要幂等，用 `assignments.ts` 内的 per-tab 互斥队列保证只执行一次。

**Use here** 与 **New tab** 的实现：

- New tab：`tabs.create({ url: "about:blank", active: true })` → `assign(tabId)` → `applyRules` → `tabs.update(tabId, { url })`。先挂再导航，保证首个请求就受管。
- Use here：`assign(tabId)` → `applyRules` → `tabs.reload(tabId)`。
- Leave：`removeRules` → 删挂载 → `tabs.reload`。规则没了，下一次加载没有信号，补丁自然不装。

### 6.5 作用域判定与 eTLD+1

```ts
// src/lib/scope.ts
export function siteKeyFor(url: URL, scope: Scope, partitionTopLevelSite?: string): string {
  const host = url.hostname.toLowerCase();
  if (scope === "host") return host;
  if (partitionTopLevelSite) return new URL(partitionTopLevelSite).hostname; // Chrome 算好的
  return etld1(host);                                                        // 回退
}

export function isInScope(a: { siteKey: string; scope: Scope }, url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase();
  return a.scope === "host" ? h === a.siteKey : h === a.siteKey || h.endsWith("." + a.siteKey);
}
```

```ts
// src/lib/etld.ts
const MULTI_PART_SUFFIXES = new Set([ /* 见 3.4 A2，全部两段 */ ]);
export function etld1(host: string): string {
  if (isIp(host) || host === "localhost" || !host.includes(".")) return host;   // isIp 要认带方括号的 IPv6
  const parts = host.split(".");
  if (parts.length > 2 && MULTI_PART_SUFFIXES.has(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
```

`getPartitionKey` 的调用放在 `createSession` 时，结果写进 `session.siteKey`，之后所有判定只用 `siteKey`，不再重复计算。

### 6.6 数量与限制

| 项 | 限制 | 应对 |
|---|---|---|
| session + dynamic 规则总数 | 5000（`MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES`） | 每 tab 2 + 2×targets（http 变体再 ×2）。典型站点 targets ≤ 3，每 tab ≤ 14 条，50 个挂载 tab 也在 700 以内 |
| 正则规则总数 | 1000（`MAX_NUMBER_OF_REGEX_RULES`） | 只有 host 作用域用正则，site 作用域一条都不占 |
| `Cookie` 头长度 | 浏览器 / 服务端限制，通常 8–16 KB | 不处理，与原生一致 |
| `Server-Timing` 头长度 | 与 Cookie 同量级，base64 膨胀 33% | 不处理；超过 16 KB 时不生成信号，只靠兜底路径 |
| `storage.local` | 10 MB | 单会话罐正常 < 50 KB |

---

## 7. 边界情况与已知限制

写进 README 的"已知限制"，实现时不需要解决，但不能因此崩溃：

1. **IdP 身份共享**：第三方登录走主会话，区分账号靠 IdP 的账号选择器（3.5 O5）。
2. **cookie Path 属性被忽略**：注入按主机名整体注入，`Path=/admin` 的 cookie 也会发给 `/`。对绝大多数站点无影响。
3. **Service Worker 被阻断**：会话 tab 内站点的 SW 不会注册，已注册的会被注销（会影响主会话 tab 的离线能力，直到它们重新注册）。依赖 SW 才能工作的站点在会话 tab 里退化为无 SW 模式。
4. **跨源 Worker 不隔离**；同源 Worker 以 blob URL 加载，`self.location` 变化可能让某些打包产物找不到 chunk。
5. **三处异步延迟**：`document.cookie = …` 后立刻发出的请求可能不带新 cookie；XHR 响应 Set-Cookie 后页面同步读 `document.cookie` 可能读不到；弹窗 OAuth 回跳后原 tab 的下一次请求依赖规则刷新先落地。原因都是 DNR 规则更新要绕一圈 service worker。
6. **首屏 `document.cookie` 视图**：来自信号里的 cookie 快照；信号缺失时（兜底路径）首屏读到空串，直到 bridge 推送。
7. **HTTP 缓存**：静态资源不做回源校验，若站点把个性化内容放在可缓存的静态 URL 上，会话 tab 可能看到主会话的缓存。
8. **浏览器重启后**：会话和罐子保留，但 tab 挂载丢失（`storage.session` 清空）；恢复的 tab 需重新 Use here。P2 可考虑在 `storage.local` 存 tab URL → 会话的"上次挂载"提示。
9. **host 作用域 + Domain cookie**：`Domain=.example.com` 的 cookie 会进会话罐，但只对 `siteKey` 那一个主机注入，其他子域不管。这是 host 作用域的定义，不是 bug；UI 里显示 siteKey 让用户理解。
10. **同一站点混用主会话与会话 tab**：允许。主会话 tab 完全不受影响（规则按 tabId）。
11. **无痕窗口**：不支持（扩展默认不在无痕启用，且 `storage.session` 在无痕中隔离）。
12. **多窗口**：支持，挂载按 tabId，与窗口无关。
13. **iframe 内的范围内页面**（例如主会话 tab 里嵌了 `example.com` 的 iframe）：不受管（tab 未挂载）。反过来，会话 tab 里嵌的范围外 iframe 走主会话。
14. **会话 cookie 持久化**：`expires` 为空的 cookie 也会跨浏览器重启保留，30 天不更新才清。依赖"关浏览器即登出"的站点在会话里不会自动登出。
15. **`IDBDatabase.name` 暴露前缀**、**hostOnly cookie 会连带发给其子域**：同站同会话内的近似。
16. **从会话 tab 打开的新 tab，第一个请求**：规则装上前已经带主罐 cookie 出去了，扩展会在转正时重新导航一次，但那一个响应的 Set-Cookie 已进主罐。
18. **Clear-Site-Data**：`"cookies"` 指令对主罐的清除靠事后写回补救，中间有几十毫秒窗口；`"storage"` 指令会清掉该 origin 下所有会话的前缀数据和主命名空间，拦不住。
19. **主会话 tab 看得见前缀 key**：主会话没打补丁，`Object.keys(localStorage)` 和 `indexedDB.databases()` 会列出 `mt:<sid>:…`。反过来会话 tab 看不到主会话的。
17. **扩展可被检测**：会话 tab 的范围内文档有 `window.__mt__`。不做反检测（1.3）。

---

## 8. UI 规范

### 8.1 通用

- **技术**：React 19 + HeroUI v3 + Tailwind v4。`tailwind.css` 里 `@import "tailwindcss"; @import "@heroui/styles";`，按 HeroUI v3 文档配置 `@source`。
- **主题**：跟随系统。`main.tsx` 里 `matchMedia("(prefers-color-scheme: dark)")` 给 `<html>` 加/去 `dark` 类，监听变化。
- **调色板**（会话颜色，6 色循环）：`#1d4ed8 #047857 #b45309 #be123c #6d28d9 #0f766e`，与角标一致。
- **字体**：系统 UI 字体，不打包 web font。
- **文案**：中文优先，`src/ui/i18n.ts` 简单 key-value，P1 加英文。
- **popup 内禁用的 HeroUI 组件**：`Modal`、`Drawer`、`Popover`、`Tooltip`、`Dropdown`、`Select`（浮层版）、`DatePicker`、`Autocomplete`——popup 视口太小，浮层会被裁切或撑变形。这些只在 options 页使用。

### 8.2 popup（360 × ≤520）

```
┌──────────────────────────────────────┐
│ MultiTabs               ● (会话色点)  │  ← 标题 + 当前 tab 状态点，hover 显示会话名
│ example.com  [site]                  │  ← 当前 siteKey + 作用域 Chip
├──────────────────────────────────────┤
│ 当前 tab：QA                [Leave]   │  ← 仅挂载时显示；Leave 是 danger 变体
├──────────────────────────────────────┤
│ 新建会话                              │
│ [ 名称输入框                 ] [新 tab]│
│ ☐ 仅隔离当前主机名 (www.example.com)  │  ← Checkbox；勾选后上方 Chip 变为 host 并显示完整主机名
│ [ 在当前 tab 使用 ]                   │  ← secondary，full width
├──────────────────────────────────────┤
│ 已保存的会话                          │
│ ● Admin        7 cookies  [Open][Here]│
│ ● QA           5 cookies  [Open][Here]│  ← 当前挂载的那行高亮
│ ● Candidate    3 cookies  [Open][Here]│
├──────────────────────────────────────┤
│ [ 管理会话… ]                         │  ← 打开 options 页
└──────────────────────────────────────┘
```

HeroUI 组件映射：

| 区域 | 组件 |
|---|---|
| 标题状态点 | `Chip`（dot 变体）或自绘 12px 圆 |
| 作用域标签 | `Chip`（size sm，flat） |
| 名称输入 | `Input`（size sm，`maxLength=40`） |
| 作用域勾选 | `Checkbox` |
| 按钮 | `Button`（primary / secondary(flat) / danger） |
| 会话列表 | 自绘列表（`Listbox` 密度待 13.4 确认），每行右侧两个 `Button size=xs` |
| 空状态 | 一段文字 + 说明 |
| 错误提示 | 内联 `Alert`（不用 toast，popup 里 toast 位置不稳） |

非 http/https 页面：整个 popup 只显示一句提示。

### 8.3 options 页（管理页）

整页 React 应用，允许浮层。

- 顶部 `Tabs`：**会话** / **站点绑定 (P1)** / **设置**。
- 会话 tab：按 siteKey 分组的 `Accordion` 或分组表格；每个会话一行：颜色、名称、作用域、cookie 数、最后使用、操作（重命名 P1、清空 P1、删除 P0）。
- 删除走 `Modal` 二次确认，文案说明会话罐会被清除、相关 tab 会退回主会话。
- 设置 tab：语言、快捷键说明（链接到 `chrome://extensions/shortcuts`）、"清理所有过期 cookie" 按钮、版本号。

### 8.4 角标

- 挂载 + 范围内：背景为会话色，文字为空（纯色块）；title `QA · example.com`。
- 挂载 + 范围外：背景灰 `#9ca3af`；title `QA · example.com（当前页面不在范围内）`。
- 未挂载：无角标。

---

## 9. 安全与隐私

- 会话罐明文存在 `chrome.storage.local`，与浏览器自身 cookie 库的可读性相当（任何有 `cookies` 权限的扩展都能读后者）。README 明确说明，不承诺加密。P2 可评估用 `crypto.subtle` + 用户口令加密。
- 不发起任何网络请求，不引入远程代码，不收集遥测。
- **bridge ↔ main world 的 `postMessage` 不是安全边界**：两个 world 共享同一个 `window`，页面能监听到所有消息。真正的校验在 background：收到 cookie 写请求时用 `sender.tab.id` 确认挂载、用 `sender.url` 的主机按 RFC 6265 domain-match 校验 cookie 的 `domain`，不匹配的丢弃。页面伪造消息最多污染自己会话的 `document.cookie` 视图，与它本来就能写 `document.cookie` 等价。
- 注入规则对非导航请求限定 `domainType: "firstParty"`，会话 tab 里的第三方 iframe 拿不到会话 cookie。
- 权限最小集：`declarativeNetRequest`, `webRequest`, `cookies`, `scripting`, `storage`, `tabs`, `webNavigation`, `tabGroups`(P1), `host_permissions: <all_urls>`。每个权限在 README 里解释用途。
- 不申请 `declarativeNetRequestFeedback`（调试用，会暴露请求）。
- `webRequest.onHeadersReceived` 挂在 `<all_urls>` 上带 `extraHeaders`，浏览器每个请求都经过扩展。handler 对未挂载 tab 立即返回，但 service worker 基本不会休眠。

---

## 10. 测试计划

### 10.1 单元测试（Vitest）

- `lib/cookie.ts`：Set-Cookie 解析（Expires / Max-Age 优先级、Domain 前导点、非法 Domain 拒绝、Secure/HttpOnly/SameSite、缺省 path 推导）、`domainMatches`、header 序列化顺序。
- `lib/etld.ts`：表中每个后缀各一例、普通 `.com`、IPv4、带方括号 IPv6、`localhost`、单段主机名、大小写。
- `lib/scope.ts`：site / host 两种作用域的 in-scope 判定，含端口、大小写、非 http 协议。
- `lib/rulegen.ts`：给定会话罐生成的规则集合快照测试：单 domain cookie、domain + hostOnly 混合、含非 secure cookie、host 作用域、空罐。
- `lib/signal.ts`：编解码往返、超长时返回 null。

### 10.2 e2e（puppeteer-core，加载 unpacked 扩展）

本地测试站 `test/fixtures/site/`：Node https server，自签证书（启动时生成），主机名走 `*.localtest.me`（`--host-resolver-rules` 映射到 127.0.0.1，不依赖系统 DNS）。启动方式见 `docs/decisions.md` 第 0 节：品牌版 Chrome 137+ 不认 `--load-extension`，用 `browser.installExtension()`；`--ignore-certificate-errors` 单独用时 Chrome 不缓存证书有错的响应，缓存用例必须再加 `--ignore-certificate-errors-spki-list=<SPKI>`。puppeteer 的 `page.click` 在后台 tab 里会悬住，点击前 `bringToFront()`。

- `app.localtest.me`：登录页（设 HttpOnly session cookie + `Domain=.localtest.me` 的 cookie + JS 写 localStorage token）、`/me` 返回当前身份、`/logout` 带 `Clear-Site-Data: "cookies"`、`/inline` 页面首段内联脚本把 `localStorage.getItem("token")` 和 `document.cookie` 写进 DOM。
- `api.localtest.me`：读 cookie 返回身份。
- `idp.localtest.me`：模拟 OAuth，`/authorize` 设自己的 cookie 后 302 回 `app` 的 `/callback`；`/callback` 设 session cookie。支持跳转式和弹窗式（`window.open` + `postMessage`）。
- `localhost`（与 app 不同 eTLD+1，充当第三方）：`/embed` 页面向 `app` 发带 credentials 的 fetch；app 的 `/with-third-party` 把它嵌成 iframe，用于验证 firstParty 限制。

用例（P0 全覆盖）：

1. 两个会话 tab 各登录 A / B，`/me` 分别返回 A / B；主会话 tab 未登录。
2. 会话 tab 内 `fetch('https://api.localtest.me/me')` 带本会话的 `Domain=.localtest.me` cookie，不带 app 的 hostOnly cookie（site 作用域）。
3. host 作用域会话：`api` 子域返回主会话身份（未登录）。
4. 页面 `document.cookie` 只看到本会话的非 HttpOnly cookie；`localStorage` 互不可见。
5. 跳转式 OAuth：会话 tab 完成登录后 `/me` 正确；主会话不受影响；`idp` 的 cookie 在主会话里。
6. 弹窗式 OAuth：同上，且弹窗关闭后原 tab 不刷新即可通过 `fetch` 拿到新身份。
7. Leave 后 `/me` 回到主会话身份。
8. 关闭 tab → `getSessionRules()` 中该 tab 的规则被清除。
9. 删除会话 → 罐子清空、挂载 tab 退回主会话。
10. 从会话 tab 打开的新 tab 继承会话：`window.open` 站内、Cmd+click 站内、`target=_blank` 站内三种各一次。
11. 浏览器重启（关闭并重开 puppeteer 实例，同 userDataDir）→ 会话列表和罐子仍在。
12. `/inline` 页面首段内联脚本读到的是会话的 localStorage 和 cookie，不是主会话的（验证信号路径）。
13. 会话 tab 访问 `/logout`（Clear-Site-Data）→ 会话罐清空，主会话仍登录（靠写回）。
14. 主会话登录 A 并访问一个可缓存页面 `/profile`，会话 tab 访问同一 URL 看到的不是 A。
15. 第三方页面里向 `app` 发的 fetch 不带会话 cookie。
16. `/storage`：会话 tab 里 IndexedDB / CacheStorage 名字对页面透明，主会话看到的是带前缀的真实名字。
17. `/sw`：会话 tab 里 `serviceWorker.register` 被拒绝。
18. `/jscookie`：`document.cookie` 写入进会话罐、随后的请求带上、主罐没有。

### 10.3 手工验收清单

在真实站点上：一个用邮箱密码登录的站点、一个 Google 登录的站点、一个 SPA 把 token 放 localStorage 的站点、一个带 Service Worker 的站点。

---

## 11. 里程碑

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架 + 三个验证** | WXT 项目、TS、ESLint、Vitest、HeroUI 空 popup/options、manifest 权限、CI；三个 spike：(1) DNR 删响应 `Set-Cookie` 后 webRequest 是否仍可见 (2) DNR 注入的 `Server-Timing` 在 document_start 的 MAIN world 脚本里能否同步读到 (3) DNR 设置的请求 `Cache-Control: no-cache` 是否被缓存层尊重 | `pnpm build` 出可加载的扩展；popup 能打开；三个 spike 结论写进 `docs/decisions.md` |
| **M1 引擎** | `lib/*` 全部 + 单测；`sessions / jar / assignments / rules / capture / inject / patch / bridge`；临时用最简 HTML 按钮触发 | e2e 用例 1–4、7–10、12–15 通过 |
| **M2 OAuth 与 pending** | T5/T6、O1–O4、refreshSession、6.4 竞态处理 | e2e 5、6、11 通过 |
| **M3 UI** | popup 与 options 按第 8 节实现，深色模式，i18n 骨架，角标 | 手工验收清单通过；无 HeroUI 浮层组件出现在 popup |
| **M4 P1** | 标签页分组、站点绑定、重命名、清空、英文文案 | 对应 e2e 补充 |

每个里程碑单独 PR，PR 描述里附测试输出。

---

## 12. 验收标准（P0）

1. 同一窗口内，同一站点两个 tab 分别登录两个账号，各自刷新 10 次身份不串。
2. 站点在 `api` 子域的接口调用（site 作用域）带的是本会话 cookie。
3. Google 弹窗登录在会话 tab 内可完成，且主会话 tab 的登录态不变。
4. 关闭浏览器重开，会话列表和 cookie 数保留。
5. popup 在深色 / 浅色模式下正常，360px 宽不出横向滚动条。
6. `chrome://extensions` 无报错；service worker 空闲被杀后再次操作正常（不依赖内存状态）。
7. 卸载扩展后，主会话 cookie 与安装前一致。允许的例外：方案 B 回退时的毫秒级窗口、第 7 节第 16 条。
8. 装了扩展但没有任何挂载 tab 时，打开 20 个普通页面，与未装扩展相比没有可感知的加载变慢。

---

## 13. 开放问题（结论在 `docs/decisions.md`）

1. ~~6.2 方案 A 是否成立~~ → 成立，捕获走 DNR 删头 + webRequest 观察。
2. ~~`getPartitionKey` 返回格式~~ → `{ partitionKey: { topLevelSite: "https://example.com", hasCrossSiteAncestor } }`，取 hostname；在扩展页面上调用会 reject。
3. ~~Server-Timing 信号能否同步读到~~ → 能，含 iframe 和缓存命中；主路径成立。
4. ~~`Cache-Control: no-cache` 是否被尊重~~ → 是，6.1(b) 保留。
5. ~~DNR 删 `Clear-Site-Data` 能否保住主罐~~ → 不能，改为 `cookies.onChanged` 写回（decisions 第 5 节）。
6. `domainType: "firstParty"` 对 OAuth 回跳的语义：目前导航规则不加该条件，e2e 5/6 通过；是否能加到导航规则上未验证。
7. ~~HeroUI `Listbox` 密度~~ → 自绘列表。
8. 快捷键默认值 `Ctrl+Shift+Y` 与用户其他扩展的冲突情况。
