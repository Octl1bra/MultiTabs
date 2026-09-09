import { cookiesForHost, sortForHeader, toPageCookie } from "@/src/lib/cookie";
import type { Assignment, PageCookie, PatchConfig } from "@/src/lib/types";
import { listJar } from "./jar";
import { log } from "./store";

export const PATCH_FILE = "content-scripts/patch.js";

export async function visibleCookies(
  sessionId: string,
  host: string,
  secureContext: boolean,
): Promise<PageCookie[]> {
  const jar = await listJar(sessionId);
  return sortForHeader(cookiesForHost(jar, host, { secureContext, includeHttpOnly: false })).map(
    toPageCookie,
  );
}

/** 兜底注入：先写 __MT_CFG__，再重跑补丁脚本（幂等） */
export async function injectFallback(
  tabId: number,
  frameId: number,
  url: URL,
  a: Assignment,
): Promise<void> {
  const cfg: PatchConfig = {
    sid: a.sessionId,
    cookies: await visibleCookies(a.sessionId, url.hostname, url.protocol === "https:"),
  };
  const target = { tabId, frameIds: [frameId] };
  try {
    const [r] = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      injectImmediately: true,
      func: (c: PatchConfig) => {
        const w = window as unknown as {
          __mt__?: { installed: boolean; update: (x: PatchConfig["cookies"]) => void };
          __MT_CFG__?: PatchConfig;
        };
        if (w.__mt__?.installed) {
          w.__mt__.update(c.cookies); // 信号路径已装好，只同步 cookie 视图
          return true;
        }
        w.__MT_CFG__ = c;
        return false;
      },
      args: [cfg],
    });
    if (r?.result === true) return;
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      injectImmediately: true,
      files: [PATCH_FILE],
    });
  } catch (err) {
    const msg = String(err);
    if (!/removed|No frame|No tab|cannot be scripted|showing error page/i.test(msg))
      log("injectFallback", tabId, frameId, msg);
  }
}
