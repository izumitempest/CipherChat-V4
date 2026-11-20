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
    // The property suite, the store rules and the component renders.
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    // The crypto modules are pure; WebCrypto comes from Node's global.
    // The canonical-collision hunt exercises every field pair and can
    // take ~30s on a cold runner; give it headroom so it never flakes.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
