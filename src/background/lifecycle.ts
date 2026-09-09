/**
 * 编排层：把 assignments / rules / jar / badge / inject 串起来。
 * 所有对外的"动作"都在这里，事件监听器只做分发。
 */
import { sortForHeader, toPageCookie } from "@/src/lib/cookie";
import { isInScope, parseUrl, siteKeyFor } from "@/src/lib/scope";
import type { Assignment, Scope, Session } from "@/src/lib/types";
import { TO_PAGE_MSG, type ExtToPage, type ToPageMessage } from "@/src/messaging";
import {
  clearAssignment,
  clearPending,
  getAssignment,
  getEffective,
  getPending,
  rulesKey,
  setAssignment,
  setPending,
  tabsForSession,
  withTabLock,
} from "./assignments";
import { updateBadge } from "./badge";
import { injectFallback } from "./inject";
import { deleteJar, listJar } from "./jar";
import { applyRules, refreshSession, removeRules } from "./rules";
import { getSession, removeSessionRecord, touchSession } from "./sessions";
import { local, log, session as sessionStore } from "./store";

const USER_INITIATED = new Set([
  "typed",
  "auto_bookmark",
  "generated",
  "keyword",
  "keyword_generated",
  "start_page",
]);

/**
 * 新 tab 的第一个请求几乎总是抢在规则装好之前发出（tabs.onCreated 和导航同时开始）。
 * 记下每个 tab 的顶层导航开始时间和规则就绪时间，转正时若导航早于规则就重新导航一次。
 * 只在内存里，SW 被杀就丢，代价是极端情况下少一次重导航。
 */
const navStartedAt = new Map<number, number>();
const rulesReadyAt = new Map<number, number>();
/** 最近一次由非导航响应（XHR / 子 frame）引起的罐子变化时间 */
const xhrCookieAt = new Map<number, number>();
/** 已经为哪个规则版本重导航过，避免 302 路径和 onCommitted 路径各来一下 */
const renavDoneFor = new Map<number, number>();

export function markRulesReady(tabId: number): void {
  rulesReadyAt.set(tabId, Date.now());
}

/** 这次顶层导航的请求是否在规则就绪之前发出（即带的是旧 cookie） */
function navRacedRules(tabId: number): boolean {
  const nav = navStartedAt.get(tabId);
  const ready = rulesReadyAt.get(tabId);
  if (ready === undefined) return false;
  return nav === undefined || nav <= ready;
}

async function renavigate(tabId: number, url: string, why: string): Promise<void> {
  const version = rulesReadyAt.get(tabId) ?? 0;
  if (renavDoneFor.get(tabId) === version) return;
  renavDoneFor.set(tabId, version);
  log("renavigate", why, tabId, url);
  await chrome.tabs.update(tabId, { url }).catch(() => {});
}

export function toAssignment(s: Session): Assignment {
  return { sessionId: s.id, siteKey: s.siteKey, scope: s.scope };
}

/* ---------- siteKey ---------- */

export async function partitionSiteForTab(tabId: number): Promise<string | null> {
  try {
    const r = await chrome.cookies.getPartitionKey({ tabId });
    return r?.partitionKey?.topLevelSite ?? null;
  } catch {
    return null;
  }
}

export async function siteKeysForTab(
  tabId: number,
  url: URL,
): Promise<{ site: string; host: string }> {
  const top = await partitionSiteForTab(tabId);
  return { site: siteKeyFor(url, "site", top), host: siteKeyFor(url, "host") };
}

export async function siteKeyForTab(tabId: number, url: URL, scope: Scope): Promise<string> {
  const keys = await siteKeysForTab(tabId, url);
  return scope === "site" ? keys.site : keys.host;
}

/* ---------- 动作 ---------- */

export async function assignTab(tabId: number, s: Session): Promise<void> {
  await setAssignment(tabId, toAssignment(s));
  await applyRules(tabId);
  await touchSession(s.id);
  void updateBadge(tabId);
}

export async function leaveTab(tabId: number, reload = true): Promise<void> {
  await clearAssignment(tabId);
  await removeRules(tabId);
  void updateBadge(tabId);
  if (reload) await chrome.tabs.reload(tabId).catch(() => {});
}

/** New tab：先建 about:blank 挂上，再导航，保证首个请求就受管 */
export async function openInNewTab(
  s: Session,
  url: string,
  opener?: chrome.tabs.Tab,
): Promise<number> {
  const tab = await chrome.tabs.create({
    url: "about:blank",
    active: true,
    index: opener?.index !== undefined ? opener.index + 1 : undefined,
    windowId: opener?.windowId,
  });
  const tabId = tab.id!;
  await assignTab(tabId, s);
  await chrome.tabs.update(tabId, { url });
  return tabId;
}

export async function useHere(s: Session, tabId: number): Promise<void> {
  await assignTab(tabId, s);
  await chrome.tabs.reload(tabId).catch(() => {});
}

export async function deleteSessionEverywhere(sessionId: string): Promise<void> {
  const { assigned, pending } = await tabsForSession(sessionId);
  for (const t of assigned) await leaveTab(t, true).catch(() => {});
  for (const t of pending) await leaveTab(t, false).catch(() => {});
  await deleteJar(sessionId);
  await removeSessionRecord(sessionId);
  await local.flush();
}

/* ---------- pending ---------- */

export async function promotePending(tabId: number, url: URL): Promise<Assignment | null> {
  return withTabLock(tabId, async () => {
    const a = await getAssignment(tabId);
    if (a) return a;
    const p = await getPending(tabId);
    if (!p) return null;
    await setAssignment(tabId, p);
    await touchSession(p.sessionId);
    // 新 tab 的第一个请求几乎总是抢在规则之前发出（带的是主罐 cookie），重来一次
    if (navRacedRules(tabId)) await renavigate(tabId, url.href, "promote");
    return p;
  });
}

/** 每一个顶层请求（含跳转链里的每一跳）发出的时间；用导航链开始时间会误伤 OAuth 回跳（重放 code） */
export function onMainFrameRequest(d: { tabId: number; frameId: number; timeStamp: number }): void {
  if (d.frameId === 0 && d.tabId >= 0) navStartedAt.set(d.tabId, d.timeStamp);
}

/* ---------- 罐子变化后 ---------- */

export async function broadcastToTab(tabId: number, inner: ExtToPage): Promise<void> {
  const msg: ToPageMessage = { type: TO_PAGE_MSG, inner };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

/**
 * 罐子变了：先刷规则（热路径，越快越好），再广播 cookie 视图。
 * origin：引起变化的那个响应属于哪个 tab、是不是它自己的导航响应。
 * 对其它 tab 来说这次变化就像"XHR 设了 cookie"，它们若正有导航在飞就该重来（见 onCommitted）。
 */
export async function afterJarChange(
  sessionId: string,
  origin?: { tabId: number; isNavigation: boolean },
): Promise<void> {
  const { assigned, pending } = await tabsForSession(sessionId);
  const now = Date.now();
  for (const t of [...assigned, ...pending]) {
    if (origin && t === origin.tabId && origin.isNavigation) continue;
    xhrCookieAt.set(t, now);
  }
  await refreshSession(sessionId);
  const jar = await listJar(sessionId);
  const cookies = sortForHeader(jar.filter((c) => !c.httpOnly)).map(toPageCookie);
  await Promise.all(
    assigned.map((t) => broadcastToTab(t, { __mt: "ext", type: "cookiesUpdated", cookies })),
  );
}

/** 302 + Set-Cookie：浏览器已经在跟跳转了，那个请求带的是旧 cookie，规则更新完直接重导航到跳转目标 */
export async function renavigateAfterRedirect(tabId: number, target: URL): Promise<void> {
  await renavigate(tabId, target.href, "redirect after Set-Cookie");
}

/* ---------- 事件 ---------- */

export async function onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  const opener = await getEffective(tab.openerTabId);
  if (!opener) return;
  const tabId = tab.id;
  await setPending(tabId, opener.a);
  await applyRules(tabId);
  void updateBadge(tabId, tab.pendingUrl ?? tab.url);
}

export async function onCommitted(
  d: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  const url = parseUrl(d.url);
  if (!url) return;
  const top = d.frameId === 0;
  const a = await getAssignment(d.tabId);
  if (a) {
    if (isInScope(a, url)) {
      // XHR 登录后 JS 跳转：XHR 的 Set-Cookie 先于导航开始，但规则在导航开始之后才就绪，
      // 这个页面带的是旧 cookie。要求 xhrCookieAt < navStartedAt，否则页面自己发的 XHR 设 cookie 会无限重载。
      const nav = navStartedAt.get(d.tabId) ?? 0;
      const xhr = xhrCookieAt.get(d.tabId) ?? 0;
      if (top && xhr > 0 && xhr < nav && navRacedRules(d.tabId)) {
        await renavigate(d.tabId, url.href, "xhr cookie before navigation");
        return;
      }
      await injectFallback(d.tabId, d.frameId, url, a);
    }
    if (top) void updateBadge(d.tabId, d.url);
    return;
  }
  const p = await getPending(d.tabId);
  if (!p) return;
  if (!top) return;
  if (USER_INITIATED.has(d.transitionType)) {
    await clearPending(d.tabId);
    await removeRules(d.tabId);
    void updateBadge(d.tabId, d.url);
    return;
  }
  if (isInScope(p, url)) {
    const promoted = await promotePending(d.tabId, url);
    if (promoted) await injectFallback(d.tabId, d.frameId, url, promoted);
  }
  void updateBadge(d.tabId, d.url);
}

export async function onTabRemoved(tabId: number): Promise<void> {
  navStartedAt.delete(tabId);
  rulesReadyAt.delete(tabId);
  xhrCookieAt.delete(tabId);
  renavDoneFor.delete(tabId);
  const ids = (await sessionStore.get<number[]>(rulesKey(tabId))) ?? [];
  await clearAssignment(tabId);
  await sessionStore.remove(rulesKey(tabId));
  if (ids.length) {
    await chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: ids })
      .catch((e) => log("rm rules", e));
  }
}

export async function currentSessionOf(tabId: number): Promise<Session | null> {
  const eff = await getEffective(tabId);
  return eff ? getSession(eff.a.sessionId) : null;
}
