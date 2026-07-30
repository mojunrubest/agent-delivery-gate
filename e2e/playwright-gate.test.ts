import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyDelivery } from "../src/verifier.js";
import type { GatePolicy } from "../src/types.js";
import { createRepository } from "../test/helpers.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("a screenshot cannot override a failed Playwright interaction assertion", { timeout: 60_000 }, async () => {
  const playwrightCli = resolve(projectRoot, "node_modules/@playwright/test/cli.js");
  const playwrightImport = pathToFileURL(resolve(projectRoot, "node_modules/@playwright/test/index.mjs")).href;
  const policy: GatePolicy = {
    schemaVersion: "1",
    policyId: "e2e/playwright-dom-contract",
    command: [process.execPath, playwrightCli, "test", "--config=playwright.config.mjs", "--reporter=json"],
    timeoutMs: 30_000,
    result: { adapter: "playwright-json", source: "stdout" },
    artifacts: [{ path: "{artifactDir}/after-click.png", required: true }],
  };
  const root = await createRepository(policy, {
    "playwright.config.mjs": "export default { testDir: '.', testMatch: 'interaction.spec.mjs', workers: 1, use: { browserName: 'chromium', channel: 'chromium', headless: true } };\n",
    "interaction.spec.mjs": `import { test, expect } from ${JSON.stringify(playwrightImport)};

test("counter reaches the accepted state", async ({ page }) => {
  await page.setContent('<button id="increment">Increment</button><output id="count">0</output><script>increment.onclick=()=>count.textContent=String(Number(count.textContent)+1)</script>');
  await page.getByRole("button", { name: "Increment" }).click();
  await page.screenshot({ path: process.env.DELIVERY_GATE_ARTIFACT_DIR + "/after-click.png" });
  await expect(page.locator("#count")).toHaveText("2");
});
`,
  });

  const { receipt } = await verifyDelivery({ configPath: resolve(root, "delivery-gate.json") });
  assert.equal(receipt.status, "unverified");
  assert(receipt.failures.includes("command_exit_nonzero:1"));
  assert(receipt.failures.includes("tests_failed:1"));
  assert.equal(receipt.tests?.failed, 1);
  assert.equal(receipt.artifacts.length, 1);
  const screenshot = await readFile(receipt.artifacts[0].path);
  assert.equal(screenshot.subarray(1, 4).toString("ascii"), "PNG");
});
