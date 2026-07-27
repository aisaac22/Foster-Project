import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests share one live Postgres connection pool; running
    // them in parallel workers each opening their own pool is wasteful and
    // makes cleanup harder to reason about.
    fileParallelism: false,
    // ingest() refreshes a materialized view every run — a genuinely slow
    // step (~5-8s against the real dataset), not a hung test.
    testTimeout: 20_000,
  },
});
