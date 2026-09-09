import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: ".output",
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
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
        description: "__MSG_cmdNewSession__",
      },
    },
    action: { default_title: "__MSG_extName__" },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
