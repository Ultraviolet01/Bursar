import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db", BLAAIZ_MODE: "mock", BLAAIZ_WEBHOOK_SECRET: "test_secret" },
    fileParallelism: false,
  },
});
