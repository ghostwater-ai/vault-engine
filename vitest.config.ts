import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "bin/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts", "bin/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "bin/**/*.test.ts"],
    },
  },
});
