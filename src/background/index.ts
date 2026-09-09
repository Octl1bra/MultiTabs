import { isHttpUrl, parseUrl } from "@/src/lib/scope";
import { updateBadge } from "./badge";
import { onCookieChanged, onHeadersReceived } from "./capture";
import { purgeExpired } from "./jar";
import {
  onCommitted,
  onMainFrameRequest,
  onTabCreated,
  onTabRemoved,
  openInNewTab,
  siteKeyForTab,
} from "./lifecycle";
import { onMessage } from "./messages";
import { createSession, nextAutoName } from "./sessions";
import { log } from "./store";

/** 所有监听器必须在 service worker 顶层同步注册，否则唤不醒 */
export function setupBackground(): void {
  chrome.runtime.onMessage.addListener(onMessage);

  chrome.webRequest.onHeadersReceived.addListener(
    (d) => {
      onHeadersReceived(d);
      return undefined;
    },
    { urls: ["<all_urls>"] }, // 不给 types：webRequest 的枚举和 DNR 不同（没有 webtransport），给错会让 SW 启动即崩
    ["responseHeaders", "extraHeaders"],
  );

  chrome.cookies.onChanged.addListener(onCookieChanged);

  chrome.tabs.onCreated.addListener(
    (tab) => void onTabCreated(tab).catch((e) => log("onCreated", e)),
  );
  chrome.tabs.onRemoved.addListener(
    (tabId) => void onTabRemoved(tabId).catch((e) => log("onRemoved", e)),
  );
  chrome.tabs.onActivated.addListener(({ tabId }) => void updateBadge(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url || info.status === "complete") void updateBadge(tabId, info.url);
  });
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => {
      onMainFrameRequest(d);
      return undefined;
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
  );
  chrome.webNavigation.onCommitted.addListener(
    (d) => void onCommitted(d).catch((e) => log("onCommitted", e)),
  );

  chrome.runtime.onInstalled.addListener(() => void purgeExpired().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => void purgeExpired().catch(() => {}));

  chrome.commands.onCommand.addListener((command) => {
    if (command !== "new-session") return;
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const url = parseUrl(tab?.url);
      if (!tab?.id || !url || !isHttpUrl(url)) return;
      const siteKey = await siteKeyForTab(tab.id, url, "site");
      const s = await createSession({ name: await nextAutoName(siteKey), siteKey, scope: "site" });
      await openInNewTab(s, url.href, tab);
    })().catch((e) => log("command", e));
  });
}
