import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the NEON//ECOLOGY core test suites.
 *
 * The simulation engine is pure TypeScript with no DOM dependency, so the whole
 * suite runs in the `node` environment. A fixed TZ keeps any future date-based
 * reporting stable across machines.
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./tests/setup.ts"],
    // 只运行本代号的测试；archive/ 里是旧原型（其 smoke test 断言旧版文件存在）。
    include: ["tests/**/*.test.ts"],
  },
});
