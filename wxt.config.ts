import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: ".output",
  manifest: {
    name: "MultiTabs",
    description: "同一个窗口里，同一个网站的多个标签页各自保持独立登录态。",
    minimum_chrome_version: "132",
    permissions: [
      "declarativeNetRequest",
      "webRequest",
      "cookies",
      "scripting",
      "storage",
      "tabs",
      "webNavigation",
    ],
    host_permissions: ["<all_urls>"],
    commands: {
      "new-session": {
        suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
        description: "为当前站点新建会话并在新标签页打开",
      },
    },
    action: { default_title: "MultiTabs" },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
