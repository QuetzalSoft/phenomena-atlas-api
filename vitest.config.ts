import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // NestJS dependency injection needs decorator metadata, which only SWC emits here.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["tests/**/*.e2e-spec.ts", "src/**/*.spec.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Starting PostGIS takes longer than the default when Docker has to emulate it.
    hookTimeout: 120_000,
  },
});
