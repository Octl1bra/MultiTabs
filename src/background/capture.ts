import { parseClearSiteData, parseSetCookie, type ParsedSetCookie } from "@/src/lib/cookie";
import { etld1 } from "@/src/lib/etld";
import { isInScope, parseUrl } from "@/src/lib/scope";
import { getAssignment, getPending } from "./assignments";
import { applyParsed, clearJar } from "./jar";
import {
  afterJarChange,
  broadcastToTab,
  promotePending,
  renavigateAfterRedirect,
} from "./lifecycle";
import { log } from "./store";

/**
 * "dnr"：方案 A，靠 6.1(a) 的规则删响应头，这里只观察（spike 已验证成立）。
 * "cookies"：方案 B 回退，捕获后从主罐 remove。注意 Set-Cookie 在 webRequest 之前就已写入主罐，
 * 所以这里拿不到旧值，只能删不能恢复。
 */
export const CAPTURE_MODE: "dnr" | "cookies" = "dnr";

/**
 * Clear-Site-Data 在网络层就被处理了，DNR 删头拦不住，主罐照样被清。
 * 补救：同步记下"某站刚收到 CSD"，把随之而来的 cookies.onChanged 删除事件缓冲住；
 * 异步确认这是会话 tab 的响应后，把删掉的 cookie 原样写回主罐。
 */
interface CsdWindow {
  until: number;
  confirmed: boolean;
  removed: chrome.cookies.Cookie[];
}
const CSD_WINDOW_MS = 1500;
const csdWindows = new Map<string, CsdWindow>();

function csdKey(host: string): string {
  return etld1(host);
}

function restoreCookie(c: chrome.cookies.Cookie): void {
  const domain = c.domain.replace(/^\./, "");
  const details: chrome.cookies.SetDetails = {
    url: `${c.secure ? "https" : "http"}://${domain}${c.path}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    storeId: c.storeId,
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (c.expirationDate) details.expirationDate = c.expirationDate;
  if (c.partitionKey) details.partitionKey = c.partitionKey;
  void chrome.cookies.set(details).catch((e) => log("restore cookie", c.name, e));
}

export function onCookieChanged(info: chrome.cookies.CookieChangeInfo): void {
  if (!info.removed) return;
  const w = csdWindows.get(csdKey(info.cookie.domain.replace(/^\./, "")));
  if (!w || Date.now() > w.until) return;
  if (w.confirmed) restoreCookie(info.cookie);
  else w.removed.push(info.cookie);
}

function confirmCsd(host: string): void {
  const w = csdWindows.get(csdKey(host));
  if (!w) return;
  w.confirmed = true;
  for (const c of w.removed) restoreCookie(c);
  w.removed = [];
}

export function onHeadersReceived(d: chrome.webRequest.OnHeadersReceivedDetails): void {
  if (d.tabId < 0) return;
  if (d.responseHeaders?.some((h) => h.name.toLowerCase() === "clear-site-data")) {
    const url = parseUrl(d.url);
    if (url) {
      const key = csdKey(url.hostname);
      const prev = csdWindows.get(key);
      if (!prev || Date.now() > prev.until)
        csdWindows.set(key, { until: Date.now() + CSD_WINDOW_MS, confirmed: false, removed: [] });
      else prev.until = Date.now() + CSD_WINDOW_MS;
    }
  }
  void handle(d).catch((e) => log("capture", e));
}

async function handle(d: chrome.webRequest.OnHeadersReceivedDetails): Promise<void> {
  const url = parseUrl(d.url);
  if (!url) return;
  let a = await getAssignment(d.tabId);
  if (!a) {
    const p = await getPending(d.tabId);
    if (!p || d.type !== "main_frame" || !isInScope(p, url)) return;
    a = await promotePending(d.tabId, url);
    if (!a) return;
  }
  if (!isInScope(a, url)) return;

  const headers = d.responseHeaders ?? [];
  let changed = false;

  const csd = headers.find((h) => h.name.toLowerCase() === "clear-site-data");
  if (csd?.value) {
    const dirs = parseClearSiteData(csd.value);
    if (dirs.has("*") || dirs.has("cookies")) {
      confirmCsd(url.hostname);
      changed = (await clearJar(a.sessionId, url.hostname)) || changed;
    }
    if (dirs.has("*") || dirs.has("storage"))
      void broadcastToTab(d.tabId, { __mt: "ext", type: "clearStorage" });
  }

  const parsed: ParsedSetCookie[] = [];
  for (const h of headers) {
    if (h.name.toLowerCase() !== "set-cookie" || !h.value) continue;
    const p = parseSetCookie(h.value, url);
    if (p) parsed.push(p);
  }
  if (parsed.length) {
    if (CAPTURE_MODE === "cookies") await scrubMainJar(parsed, url);
    changed = (await applyParsed(a.sessionId, parsed)) || changed;
  }
  if (!changed) return;
  await afterJarChange(a.sessionId, { tabId: d.tabId, isNavigation: d.type === "main_frame" });
  if (d.type === "main_frame" && d.statusCode >= 300 && d.statusCode < 400) {
    const loc = headers.find((h) => h.name.toLowerCase() === "location")?.value;
    const target = loc ? parseUrl(new URL(loc, url).href) : null;
    if (target && isInScope(a, target)) await renavigateAfterRedirect(d.tabId, target);
  }
}

async function scrubMainJar(parsed: ParsedSetCookie[], url: URL): Promise<void> {
  for (const p of parsed) {
    await chrome.cookies.remove({ url: url.href, name: p.cookie.name }).catch(() => {});
  }
}
