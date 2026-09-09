# e2e 本地测试站

给 `docs/multi-tabs-prd.md` 第 10.2 节的 puppeteer 用例用的假站点。零依赖，Node 24，ESM。

```js
import { startSite } from './test/fixtures/site/server.mjs';

const site = await startSite({ port: 0, httpPort: 0 }); // 0 = 随机端口；默认 8443 / 8080
site.port;      // https 实际端口
site.httpPort;  // http 实际端口
site.hits;      // Map：'profile' / 'counter' 的命中次数
site.reset();   // 清空 hits
await site.close();
```

直接起：`node test/fixtures/site/server.mjs`（`PORT` / `HTTP_PORT` 环境变量改端口）。

- 证书：首次启动用 openssl 生成到 `.certs/`（已 gitignore），CN=localtest.me，SAN 覆盖 `*.localtest.me` / `localtest.me` / `localhost`。puppeteer 带 `--ignore-certificate-errors` 即可。
- `*.localtest.me` 公网解析到 127.0.0.1。本机有 Surge fake-ip，curl 一律 `--noproxy '*' --resolve app.localtest.me:8443:127.0.0.1`。
- 两个监听（https 8443 / http 8080）共用同一套路由，按 `Host` 头的主机名分发，端口忽略。`127.0.0.1` / `::1` 当作 `localhost`。
- 所有响应带 `X-Site-Host: <路由到的主机名>`。除 `/profile` `/counter` 外一律 `Cache-Control: no-store`。
- 页面没有样式，状态都放在带 id 的元素里。
- 未知路由 404，未知主机 421，方法不对 405。

## 用户模型

两个用户 `A` / `B`。登录态是 `sid=<user>` cookie（HttpOnly）。

`whoami(req)`（也从 `server.mjs` 导出）解析 Cookie 头，返回 `{ user: sid|null, who: who|null, raw: 原始 Cookie 头（没有则 ''） }`。

## 路由表

`<port>` 一律是 **https 的实际端口**——即使请求从 http 监听进来，页面里的跨主机绝对 URL 也指向 https。

### `app.localtest.me`

| 路由 | 行为 | 服务的用例（PRD 10.2） |
|---|---|---|
| `GET /` | `#user`＝A/B/anonymous；`#cookie`＝`document.cookie`；`#ls`＝`localStorage.getItem('token')`（没有则空）；导航链接 | 1、4、7、9、10 |
| `GET /login?user=A` | 三条 Set-Cookie：`sid=A; Path=/; Secure; HttpOnly; SameSite=Lax`、`who=A; Domain=.localtest.me; Path=/; Secure`、`theme=dark; Path=/`（非 secure 非 HttpOnly）。HTML，内联脚本 `localStorage.setItem('token','A')` 后把 `#done` 写成 `ok`。**不 302**，便于直接读响应 | 1、4、5、13、14 的登录前置 |
| `GET /me` | JSON `{ user, who, raw }`，`no-store`。带 CORS（白名单同 api） | 1、2、3、6、7、9、13、15 |
| `GET /logout` | `Clear-Site-Data: "cookies"`，`#done`＝`logged out`。不发删除类 Set-Cookie，只靠 Clear-Site-Data（Chrome 只在 https 下执行） | 13 |
| `GET /inline` | `<head>` 第一个子元素是内联脚本，同步记 `window.__first = { token, cookie, ls_len }`；body 的 `#first` 由后续脚本填 JSON。验证补丁是否先于首段内联脚本生效 | 12 |
| `GET /profile` | `Cache-Control: private, max-age=600`，`X-Served-At: <Date.now()>`，`#user`、`#served-at`、`#hit`；每次命中 `hits.profile++` | 14（共享 HTTP 缓存） |
| `GET /counter` | 同 `/profile` 但纯文本 `hit=N`，`hits.counter++` | 14 |
| `GET /open` | `a#plain[href=/]`、`a#blank[target=_blank]`、`button#win`（`window.open('/')`） | 10（新 tab 继承） |
| `GET /with-third-party` | `#user` + `iframe#tp[src=https://localhost:<port>/embed]` | 15 |
| `GET /storage[?value]` | `localStorage.setItem('k', search 或 'v')`、`indexedDB.open('db1')`、`caches.open('c1')`，再写 `#ls_keys`＝`Object.keys(localStorage)`、`#idb`＝`indexedDB.databases()` 名单、`#caches`＝`caches.keys()`；全部完成后 `#done`＝`ok`。失败写 `err:<name>` | 4；6.3 前缀代理 |
| `GET /sw` | `navigator.serviceWorker.register('/sw.js')` → `#sw`＝`registered` 或 `blocked:<name>`（不安全上下文下 `unavailable`） | 6.3 SW 阻断 |
| `GET /sw.js` | 最小 SW，`Content-Type: application/javascript` | 同上 |
| `GET /jscookie` | `document.cookie='js=1; path=/'` 后 `fetch('/me',{credentials:'include'})`，`#cookie`＝写后的 `document.cookie`，`#me`＝响应 JSON | 6.3 `document.cookie` setter → bridge → 罐子（已知延迟） |
| `GET /oauth/start?mode=redirect[&user=A]` | `Set-Cookie: oauth_state=<随机>; Path=/; Secure; HttpOnly`，302 到 `https://localhost（IdP）:<port>/authorize?state=…&redirect_uri=https://app.localtest.me:<port>/callback&user=<透传，可空>` | 5 |
| `GET /oauth/start?mode=popup[&user=A]` | 同样设 `oauth_state`；HTML：`#state`、`button#go`（`window.open` 到 idp，redirect_uri 带 `?popup=1`）、`#me`；收到 `message` 且 `data==='oauth-done'` 后 `fetch('/me')` 写进 `#me` | 6 |
| `GET /callback?code=<user>&state=<s>[&popup=1]` | 校验 `oauth_state` cookie === state；不匹配 **400** `#err`＝`state mismatch`（`#detail` 显示两边的值——故意的，验证 state cookie 是否被正确注入）。匹配则 `Set-Cookie: sid=<code>; …HttpOnly…`；`popup=1` 时返回 HTML（`#done`＝`ok`，脚本 `opener.postMessage('oauth-done','*'); window.close()`），否则 302 `/` | 5、6 |

### `api.localtest.me`

| 路由 | 行为 | 用例 |
|---|---|---|
| `GET/OPTIONS /me` | 同 app `/me`。CORS：`Access-Control-Allow-Origin` 回显请求 Origin，白名单 `https://app.localtest.me:<port>`、`https://localhost:<port>`（从 http 监听进来的请求额外放行 `http://app.localtest.me:<httpPort>`、`http://localhost:<httpPort>`）；`Access-Control-Allow-Credentials: true`；`Vary: Origin`；OPTIONS 回 204 | 2（site 作用域）、3（host 作用域） |

### `localhost（IdP）`

| 路由 | 行为 | 用例 |
|---|---|---|
| `GET /authorize?state&redirect_uri[&user]` | `Set-Cookie: idp_session=1; Path=/; Secure`。有 `user` → 302 到 `redirect_uri` 追加 `code=<user>&state=<state>`（用 `URL.searchParams` 追加，redirect_uri 自带 query 也能正确拼）。没有 → 选账号页 `a#pick-A` / `a#pick-B`（href 保留原 query 加 `user=`） | 5、6 |
| `GET /whoami` | JSON `{ idp: <有无 idp_session cookie> }` | 5（“idp 的 cookie 在主会话里”） |

### `localhost`（第三方，eTLD+1 与 app 不同）

| 路由 | 行为 | 用例 |
|---|---|---|
| `GET /embed` | 内联脚本 `fetch('https://app.localtest.me:<port>/me',{credentials:'include'})`，响应 JSON 写进 `#me`（失败 `err:<message>`）。嵌在 app `/with-third-party` 里 | 15（firstParty 限制） |

### http 监听（默认 8080）

路由同上，只用于 `chrome.cookies.getPartitionKey`（PRD 13.2）和非 secure cookie 测试。注意 Chrome 在 `http://app.localtest.me` 下会拒绝带 `Secure` 的 cookie（`sid` / `who` / `oauth_state` / `idp_session` 都设不上，只有 `theme=dark` 能落），也不执行 `Clear-Site-Data`，`caches` / `serviceWorker` 不可用。

## curl 速查

```sh
R="--noproxy * --resolve app.localtest.me:8443:127.0.0.1 --resolve api.localtest.me:8443:127.0.0.1 --resolve localhost（IdP）:8443:127.0.0.1"
curl -sk $R -i 'https://app.localtest.me:8443/login?user=A'
curl -sk $R -H 'Cookie: sid=A; who=A' https://app.localtest.me:8443/me
curl -sk $R -i -H 'Cookie: oauth_state=x' 'https://app.localtest.me:8443/callback?code=A&state=y'   # 400
curl -sk $R -i -H 'Origin: https://app.localtest.me:8443' https://api.localtest.me:8443/me          # CORS 头
```

（zsh 下 `$R` 不会分词，用 bash 或写成数组。）
