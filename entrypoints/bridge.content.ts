import { defineContentScript } from "wxt/utils/define-content-script";
import { setupBridge } from "@/src/page/bridge";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  noScriptStartedPostMessage: true,
  main() {
    setupBridge();
  },
});
