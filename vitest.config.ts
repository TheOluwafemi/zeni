import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't boot the Cloudflare plugin.
// Shared physics and rules are plain TypeScript and run fine in Node.
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.ts"],
  },
});
