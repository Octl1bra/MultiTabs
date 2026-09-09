import { defineBackground } from "wxt/utils/define-background";
import { setupBackground } from "@/src/background";

export default defineBackground(() => {
  setupBackground();
});
