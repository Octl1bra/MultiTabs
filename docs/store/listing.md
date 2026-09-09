# Chrome 网上应用店 商品信息（逐条粘贴）

对应开发者后台报的每一条缺失项。

## 商品详情

**语言**：中文（简体）

**类别**：效率 → 工作流程和规划。（如果审核建议换，备选"开发者工具"。）

**简短说明（132 字以内）**

同一个网站，多个账号同时在线。每个标签页一套独立的登录态，切换不用登出。

**详细说明**

MultiTabs 让同一个网站的多个标签页各自保持独立的登录态，同时在线、互不干扰。相当于给 Chrome 加上 Firefox 的"多账户容器"。

怎么用：
1. 打开网站，点工具栏图标，输入会话名，点"新 tab"。新标签页以未登录状态打开，在里面登录，登录态就属于这个会话。
2. 再点图标，已保存的会话可以"打开"（新标签页）或"此处"（当前标签页切换过去）。
3. "退出"让当前标签页回到浏览器默认的登录态。会话和它的 cookie 保留，下次继续用。
4. 从会话标签页里打开的链接、弹窗、新标签页自动继承会话。
5. 快捷键 ⌘⇧Y / Ctrl+Shift+Y：为当前网站新建会话并在新标签页打开。

适合谁：
- 开发和测试：同时用管理员、普通用户、候选人三种角色登录同一个后台。
- 运营：同一平台管理多个店铺或账号。
- 个人：工作账号和私人账号同站并存。

隔离范围：cookie（含 HttpOnly）、document.cookie、localStorage、sessionStorage、IndexedDB、CacheStorage、BroadcastChannel、同源 Web Worker。第三方登录（Google、GitHub 等）走浏览器默认会话，区分账号靠登录提供方的账号选择器。

隐私：不收集、不上传任何数据；没有服务器，不发网络请求，没有统计。所有会话数据只存在本地。开源：https://github.com/Octl1bra/MultiTabs

已知限制：会话标签页内不注册 Service Worker；cookie 的 Path 属性被忽略；浏览器重启后会话和 cookie 保留，但标签页需要重新挂载。

**图标**：上传 `docs/store/icon-128.png`（128×128，图形 96px 居中，四周 16px 透明留白，按商店规范）。

**屏幕截图**：`docs/store/screenshot-1280x800.png`（首选）或 `docs/store/screenshot-640x400.png`。

## 隐私权规范

**单一用途说明**

让同一个网站的多个标签页各自保持独立的登录态（多账号同时在线）。扩展的全部功能都服务于这一个目的：为用户主动创建的"会话"隔离 cookie 和页面存储。

**权限理由**

cookies：
两处用途。(1) 调用 chrome.cookies.getPartitionKey 取得 Chrome 计算好的站点范围（eTLD+1），决定一个会话覆盖哪些子域。(2) 网站返回 Clear-Site-Data 响应头时浏览器会清掉默认会话的 cookie，扩展用 cookies.onChanged 和 cookies.set 把被误删的 cookie 原样写回，避免会话标签页里的"登出"影响其它标签页。扩展不读取用户 cookie 作其它用途，不传输任何 cookie。

declarativeNetRequest：
这是隔离登录态的核心机制。对用户主动挂载到会话的标签页（按 tabId 过滤的 session rules），改写请求的 Cookie 头为该会话自己的 cookie，删除响应的 Set-Cookie 头以免写入浏览器默认会话，并在导航请求上加 Cache-Control: no-cache 避免共享 HTTP 缓存串号。规则只作用于用户挂载的标签页和该会话所属的网站，不影响其它标签页。不使用 declarativeNetRequestFeedback。

scripting：
在会话标签页的范围内页面注入页面补丁（隔离 document.cookie、localStorage、IndexedDB 等），作为静态内容脚本的兜底路径。只对用户挂载到会话的标签页执行，注入的代码全部打包在扩展内。

storage：
storage.local 保存用户创建的会话及其 cookie；storage.session 保存标签页与会话的绑定关系（浏览器关闭即清除）。全部数据只在本地。

tabs：
读取当前标签页的 URL 以判断所属网站并显示会话列表；创建新标签页、刷新标签页以应用或退出会话；用 openerTabId 让从会话标签页打开的新标签页继承会话；在工具栏角标显示当前标签页的会话颜色和名称。

webNavigation：
监听导航提交事件，判断会话标签页当前页面是否在会话范围内（更新角标灰/彩），并在范围内页面触发页面补丁的兜底注入；记录每次顶层导航的开始时间，用于处理新标签页第一个请求与规则安装之间的竞态。

webRequest：
只观察、不阻塞（Manifest V3 下 webRequest 本来也无法阻塞）。读取会话标签页响应头里的 Set-Cookie，把网站设置的 cookie 写进该会话的本地 cookie 罐；读取 Clear-Site-Data 头以清空对应会话的 cookie。不修改任何请求或响应，修改由 declarativeNetRequest 完成。

主机权限（<all_urls>）：
用户可以为任意网站创建会话，扩展无法预知是哪些网站；而隔离必须覆盖该网站的所有子域和该网站在会话标签页里发出的全部请求。因此需要对所有网址的主机权限来安装 declarativeNetRequest 的 modifyHeaders 规则和观察 webRequest 响应头。所有处理只发生在用户主动挂载到会话的标签页上，其它标签页和网站不会被读取或修改。

远程代码：
选择"否，我不使用远程代码"。所有脚本打包在扩展内，不加载外部脚本，不使用 eval 或 new Function，扩展页面遵守 MV3 默认 CSP。

**数据使用**

勾选：
- 身份验证信息（网站在会话标签页里设置的 cookie，仅本地保存，用于实现隔离）
- 网站内容（网站在会话标签页里写入的 localStorage / IndexedDB 等，仅本地、以会话前缀保存）

三项认证全部勾选：
- 不向第三方出售或转移用户数据（除经批准的用例外）
- 不将用户数据用于与商品单一用途无关的目的
- 不将用户数据用于确定信用度或用于放贷目的

**隐私权政策网址**

https://github.com/Octl1bra/MultiTabs/blob/main/PRIVACY.md

## 审核提示

这套权限（<all_urls> + webRequest + cookies + declarativeNetRequest）会触发人工审核，通常几天到两周。如果审核来信要求补充，把 README 的"工作原理"和上面的权限理由贴过去即可；代码开源，可以直接给仓库链接。
