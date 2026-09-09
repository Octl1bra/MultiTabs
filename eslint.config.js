import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".output/**", ".wxt/**", "node_modules/**", "test/spikes/**", "test/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // puppeteer 脚本里的 evaluate 回调跑在页面上下文，用到 document/window 等浏览器全局
    files: ["test/e2e/**/*.mjs", "scripts/**/*.mjs"],
    rules: { "no-undef": "off" },
  },
  {
    languageOptions: { globals: { chrome: "readonly", browser: "readonly" } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
