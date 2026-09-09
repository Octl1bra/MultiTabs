import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  test: {
    include: ["test/unit/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
});
