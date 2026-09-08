import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";
import path from "path";

export default defineConfig({
  plugins: [
    {
      name: "test-tsx-transform",
      enforce: "pre",
      async transform(code, id) {
        if (!id.endsWith(".tsx")) return;
        return transformWithEsbuild(code, id, {
          loader: "tsx",
          jsx: "automatic",
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "client", "src", "assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/tests/**/*.test.ts",
      "client/src/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["client/src/test/setup.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
