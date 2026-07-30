import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: resolve(root, "tests"),
  testMatch: "incident-desk.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 15_000,
  use: {
    browserName: "chromium",
    headless: true,
  },
});
