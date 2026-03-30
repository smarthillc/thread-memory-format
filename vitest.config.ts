import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@tmf/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@tmf/storage": resolve(__dirname, "packages/storage/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/__tests__/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/index.ts"],
    },
  },
});
