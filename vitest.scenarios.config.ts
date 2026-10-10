import { defineConfig } from "vitest/config";

// Heure fixe : les snapshots sont identiques d'une machine à l'autre
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["scenarios/**/*.scenario.ts"],
    globalSetup: ["scenarios/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    env: { TZ: "UTC" }
  }
});
