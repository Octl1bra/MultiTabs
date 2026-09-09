import { decodeSignalDesc, SIGNAL_NAME } from "@/src/lib/signal";
import type { PageCookie, PatchConfig } from "@/src/lib/types";

declare global {
  interface Window {
    __mt__?: { installed: true; cfg: PatchConfig; update: (cookies: PageCookie[]) => void };
    __MT_CFG__?: PatchConfig;
  }
}

/**
 * 按顺序找同步信号：
 * 1. 导航条目的 Server-Timing（DNR 按 tab 注入）
 * 2. 同源父窗口已安装的配置（about:blank / srcdoc / blob 子 frame）
 * 3. 兜底注入写入的 window.__MT_CFG__
 */
export function readSignal(): PatchConfig | null {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    // 基础规则和 target 规则都会 append 一条，取 cookie 最全的
    let best: PatchConfig | null = null;
    for (const s of nav?.serverTiming ?? []) {
      if (s.name !== SIGNAL_NAME) continue;
      const cfg = decodeSignalDesc(s.description);
      if (cfg && (!best || cfg.cookies.length > best.cookies.length)) best = cfg;
    }
    if (best) return best;
  } catch {
    /* ignore */
  }
  try {
    if (window !== window.parent) {
      const p = window.parent.__mt__;
      if (p?.installed && p.cfg) return p.cfg;
    }
  } catch {
    /* 跨源，放弃 */
  }
  try {
    const cfg = window.__MT_CFG__;
    if (cfg && typeof cfg.sid === "string") {
      delete window.__MT_CFG__;
      return cfg;
    }
  } catch {
    /* ignore */
  }
  return null;
}
