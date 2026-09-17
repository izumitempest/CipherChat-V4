import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
    // The crypto modules are pure; WebCrypto comes from Node's global.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
