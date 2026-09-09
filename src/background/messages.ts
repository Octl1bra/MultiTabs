import { parseSetCookie } from "@/src/lib/cookie";
import { t } from "@/src/lib/i18n";
import { hostInScope, isHttpUrl, isInScope, parseUrl } from "@/src/lib/scope";
import {
  BRIDGE_MSG,
  type Api,
  type ApiName,
  type ApiRequest,
  type BridgeMessage,
  type PopupState,
  type SessionSummary,
} from "@/src/messaging";
import { allAssignedTabs, getAssignment, getEffective } from "./assignments";
import { applyParsed, clearJar, countJar, purgeExpired } from "./jar";
import {
  afterJarChange,
  deleteSessionEverywhere,
  leaveTab,
  openInNewTab,
  siteKeysForTab,
  useHere,
} from "./lifecycle";
import { createSession, getSession, getSessions, sessionsForHost, updateSession } from "./sessions";
import { local, log } from "./store";

type Handlers = {
  [K in ApiName]: (
    p: Api[K]["req"],
    sender: chrome.runtime.MessageSender,
  ) => Promise<Api[K]["res"]>;
};

async function summarize(
  list: Awaited<ReturnType<typeof getSessions>>[string][],
): Promise<SessionSummary[]> {
  const tabs = await allAssignedTabs();
  return Promise.all(
    list.map(async (s) => ({
      ...s,
      cookieCount: await countJar(s.id),
      tabCount: tabs[s.id]?.length ?? 0,
    })),
  );
}

const handlers: Handlers = {
  async getPopupState({ tabId }): Promise<PopupState> {
    const tab = await chrome.tabs.get(tabId);
    const url = parseUrl(tab.url);
    const isHttp = !!url && isHttpUrl(url);
    const host = isHttp ? url.hostname.toLowerCase() : null;
    const siteKeys = isHttp ? await siteKeysForTab(tabId, url) : null;
    const all = await getSessions();
    const eff = await getEffective(tabId);
    const assignment = eff
      ? { ...eff.a, session: all[eff.a.sessionId] ?? null, inScope: !!url && isInScope(eff.a, url) }
      : null;
    const sessions = host ? await summarize(sessionsForHost(all, host)) : [];
    return {
      tab: { id: tabId, url: tab.url ?? null, host, isHttp },
      siteKeys,
      assignment,
      sessions,
    };
  },

  async createSession({ tabId, name, scope, action }) {
    const tab = await chrome.tabs.get(tabId);
    const url = parseUrl(tab.url);
    if (!url || !isHttpUrl(url)) throw new Error(t("errNotHttp"));
    const keys = await siteKeysForTab(tabId, url);
    const s = await createSession({
      name,
      siteKey: scope === "site" ? keys.site : keys.host,
      scope,
    });
    if (action === "newTab") return { session: s, tabId: await openInNewTab(s, url.href, tab) };
    if (action === "here") {
      await useHere(s, tabId);
      return { session: s, tabId };
    }
    return { session: s, tabId: null };
  },

  async openInNewTab({ sessionId, url }) {
    const s = await getSession(sessionId);
    if (!s) throw new Error(t("errNoSession"));
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return { tabId: await openInNewTab(s, url, active) };
  },

  async useHere({ sessionId, tabId }) {
    const s = await getSession(sessionId);
    if (!s) throw new Error(t("errNoSession"));
    await useHere(s, tabId);
    return {};
  },

  async leave({ tabId }) {
    await leaveTab(tabId, true);
    return {};
  },

  async deleteSession({ sessionId }) {
    await deleteSessionEverywhere(sessionId);
    return {};
  },

  async renameSession({ sessionId, name, color }) {
    return { session: await updateSession(sessionId, { name, color }) };
  },

  async clearJar({ sessionId }) {
    await clearJar(sessionId);
    await afterJarChange(sessionId);
    await local.flush();
    return {};
  },

  async listAllSessions() {
    const all = await getSessions();
    const list = Object.values(all).sort(
      (a, b) => a.siteKey.localeCompare(b.siteKey) || a.createdAt - b.createdAt,
    );
    return { sessions: await summarize(list) };
  },

  async purgeExpired() {
    return { removed: await purgeExpired() };
  },
};

function isApiRequest(m: unknown): m is ApiRequest {
  return (
    !!m &&
    typeof m === "object" &&
    typeof (m as ApiRequest).type === "string" &&
    (m as ApiRequest).type in handlers
  );
}

/** bridge 转来的页面消息：校验 sender 后写会话罐 */
async function handleBridge(
  msg: BridgeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  const url = parseUrl(sender.url);
  if (tabId === undefined || !url || !isHttpUrl(url)) return;
  const a = await getAssignment(tabId);
  if (!a || !isInScope(a, url)) return;
  if (msg.inner.type === "setCookie") {
    const p = parseSetCookie(msg.inner.header, url);
    if (!p || p.cookie.httpOnly) return;
    if (!hostInScope(a, p.cookie.domain)) return;
    if (await applyParsed(a.sessionId, [p])) await afterJarChange(a.sessionId);
  }
}

export function onMessage(
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void,
): boolean {
  if (isApiRequest(msg)) {
    const h = handlers[msg.type] as (
      p: unknown,
      s: chrome.runtime.MessageSender,
    ) => Promise<unknown>;
    h(msg.payload, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) => {
        log("api", msg.type, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  if (!!msg && typeof msg === "object" && (msg as BridgeMessage).type === BRIDGE_MSG) {
    void handleBridge(msg as BridgeMessage, sender).catch((e) => log("bridge", e));
  }
  return false;
}
