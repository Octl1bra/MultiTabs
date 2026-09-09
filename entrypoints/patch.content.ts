import { defineContentScript } from "wxt/utils/define-content-script";
import { readSignal } from "@/src/page/signal";
import { install } from "@/src/page/install";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  main() {
    const cfg = readSignal();
    if (cfg) install(cfg);
  },
});
