import {
  BRIDGE_MSG,
  TO_PAGE_MSG,
  type BridgeMessage,
  type PageToExt,
  type ToPageMessage,
} from "@/src/messaging";

/**
 * ISOLATED world。只做两件事：
 * - main world → background：转发 cookie 写操作
 * - background → main world：转发 cookie 更新 / 清存储
 * 不是安全边界，校验在 background。
 */
export function setupBridge(): void {
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as PageToExt | undefined;
    if (!d || d.__mt !== "page" || typeof d.type !== "string") return;
    const msg: BridgeMessage = { type: BRIDGE_MSG, inner: d };
    try {
      void chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      /* 扩展已卸载/重载 */
    }
  });

  chrome.runtime.onMessage.addListener((msg: ToPageMessage) => {
    if (!msg || msg.type !== TO_PAGE_MSG) return;
    window.postMessage(msg.inner, "*");
  });
}
