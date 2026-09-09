import { isInScope, parseUrl } from "@/src/lib/scope";
import { getEffective } from "./assignments";
import { getSession } from "./sessions";

export const BADGE_GRAY = "#9ca3af";

export async function updateBadge(tabId: number, urlHint?: string): Promise<void> {
  try {
    const eff = await getEffective(tabId);
    if (!eff) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: "MultiTabs" });
      return;
    }
    const s = await getSession(eff.a.sessionId);
    const name = s?.name ?? "?";
    let url = parseUrl(urlHint);
    if (!url) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      url = parseUrl(tab?.url);
    }
    const inScope = !!url && isInScope(eff.a, url);
    const color = inScope && !eff.pending ? (s?.color ?? BADGE_GRAY) : BADGE_GRAY;
    const suffix = eff.pending ? "（待挂载）" : inScope ? "" : "（当前页面不在范围内）";
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text: " " });
    await chrome.action.setTitle({ tabId, title: `${name} · ${eff.a.siteKey}${suffix}` });
  } catch {
    /* tab 可能已关闭 */
  }
}
