# MultiTabs 隐私政策 / Privacy Policy

最后更新：2026-09-09

## 中文

MultiTabs 是一个 Chrome 扩展，用于让同一个网站的多个标签页各自保持独立的登录态。

**收集与传输**：MultiTabs 不收集、不上传、不分享任何数据。扩展不发起任何网络请求，没有服务器，没有统计或遥测。

**本地处理的数据**：为了实现登录态隔离，扩展会在你的浏览器本地处理以下数据，并且只在你主动为某个网站创建会话、并把标签页挂载到该会话之后才处理：

- 该网站在会话标签页里设置的 cookie（含 HttpOnly cookie），保存在 `chrome.storage.local`，用于在后续请求里代替浏览器默认 cookie。
- 该网站在会话标签页里写入的 localStorage / sessionStorage / IndexedDB / CacheStorage，以带会话前缀的键名保存在该网站自己的存储里。
- 标签页与会话的绑定关系，保存在 `chrome.storage.session`，浏览器关闭即清除。

这些数据只存在于你的设备上，可以随时在扩展的管理页面删除某个会话，或者卸载扩展一并清除。

**未挂载会话的标签页**：扩展的内容脚本会在所有页面加载，但只在检测到该标签页属于某个会话时才做任何处理；其它页面不会被读取或修改。

**第三方**：无。

**联系**：https://github.com/Octl1bra/MultiTabs/issues

## English

MultiTabs is a Chrome extension that keeps separate login sessions in different tabs of the same website.

**Collection and transmission**: MultiTabs does not collect, upload, or share any data. It makes no network requests of its own, has no server, and includes no analytics or telemetry.

**Data processed locally**: to isolate sessions, the extension handles the following data on your device, and only after you explicitly create a session for a site and attach a tab to it:

- Cookies (including HttpOnly cookies) set by that site inside session tabs, stored in `chrome.storage.local` and injected into later requests instead of the browser's default cookies.
- localStorage / sessionStorage / IndexedDB / CacheStorage written by that site inside session tabs, kept in the site's own storage under session-prefixed keys.
- The tab-to-session mapping, stored in `chrome.storage.session`, cleared when the browser closes.

All of this stays on your device. You can delete any session from the extension's options page, or uninstall the extension to remove everything.

**Tabs not attached to a session**: the content scripts load on every page but do nothing unless the tab belongs to a session; other pages are neither read nor modified.

**Third parties**: none.

**Contact**: https://github.com/Octl1bra/MultiTabs/issues
