import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyDelivery } from "../src/verifier.js";
import type { DeliveryStatus, GatePolicy, TestCounts } from "../src/types.js";
import { createRepository, tapPolicy } from "../test/helpers.js";

interface Scenario {
  id: string;
  expectedValid: boolean;
  agentClaim: boolean;
  cooperativeClaim: boolean;
  policy: GatePolicy;
  files?: Record<string, string>;
}

interface AtomicOutcome {
  accepted: boolean;
  status: DeliveryStatus;
  failures: string[];
  tests: TestCounts | null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vitestCli = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const playwrightCli = resolve(projectRoot, "node_modules/@playwright/test/cli.js");
const playwrightImport = pathToFileURL(resolve(projectRoot, "node_modules/@playwright/test/index.mjs")).href;

const passTest = 'import test from "node:test"; import assert from "node:assert/strict"; test("canonical", () => assert.equal(2 + 2, 4));\n';
const failTest = 'import test from "node:test"; import assert from "node:assert/strict"; test("canonical", () => assert.equal(2 + 2, 5));\n';

function nodeTestPolicy(file: string, overrides: Partial<GatePolicy> = {}): GatePolicy {
  return tapPolicy([process.execPath, "--test", "--test-reporter=tap", file], overrides);
}

function playwrightScenario(id: string, shouldPass: boolean): Scenario {
  const screenshot = shouldPass ? "accepted.png" : "false-green.png";
  const expected = shouldPass ? "1" : "2";
  return {
    id,
    expectedValid: shouldPass,
    agentClaim: true,
    cooperativeClaim: true,
    policy: {
      schemaVersion: "1",
      policyId: `benchmark/${id}`,
      command: [process.execPath, playwrightCli, "test", "--config=playwright.config.mjs", "--reporter=json"],
      timeoutMs: 30_000,
      result: { adapter: "playwright-json", source: "stdout" },
      artifacts: [{ path: `{artifactDir}/${screenshot}` }],
    },
    files: {
      "playwright.config.mjs": "export default { testDir: '.', testMatch: 'flow.spec.mjs', workers: 1, use: { browserName: 'chromium', channel: 'chromium', headless: true } };\n",
      "flow.spec.mjs": `import { test, expect } from ${JSON.stringify(playwrightImport)};
test("browser acceptance", async ({ page }) => {
  await page.setContent('<button id="increment">Increment</button><output id="count">0</output><script>increment.onclick=()=>count.textContent=String(Number(count.textContent)+1)</script>');
  await page.getByRole("button", { name: "Increment" }).click();
  await page.screenshot({ path: process.env.DELIVERY_GATE_ARTIFACT_DIR + "/${screenshot}" });
  await expect(page.locator("#count")).toHaveText("${expected}");
});
`,
    },
  };
}

const scenarios: Scenario[] = [
  {
    id: "valid-node-test",
    expectedValid: true,
    agentClaim: true,
    cooperativeClaim: true,
    policy: nodeTestPolicy("passing.test.mjs"),
    files: { "passing.test.mjs": passTest },
  },
  {
    id: "valid-vitest-junit",
    expectedValid: true,
    agentClaim: true,
    cooperativeClaim: true,
    policy: {
      schemaVersion: "1",
      policyId: "benchmark/vitest",
      command: [process.execPath, vitestCli, "run", "fixture.test.js", "--globals", "--reporter=junit", "--outputFile={report}"],
      result: { adapter: "junit", source: "file" },
    },
    files: { "fixture.test.js": 'test("canonical", () => expect(6 * 7).toBe(42));\n' },
  },
  {
    id: "valid-pass-with-skip",
    expectedValid: true,
    agentClaim: true,
    cooperativeClaim: true,
    policy: nodeTestPolicy("mixed.test.mjs"),
    files: { "mixed.test.mjs": 'import test from "node:test"; test("pass", () => {}); test.skip("optional", () => {});\n' },
  },
  {
    id: "valid-required-artifact",
    expectedValid: true,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "artifact.mjs"], { artifacts: [{ path: "{artifactDir}/proof.txt" }] }),
    files: { "artifact.mjs": 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.DELIVERY_GATE_ARTIFACT_DIR + "/proof.txt", "current run"); console.log("TAP version 13\\nok 1 - artifact\\n1..1");\n' },
  },
  playwrightScenario("valid-playwright-flow", true),
  {
    id: "test-failure",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: nodeTestPolicy("failing.test.mjs"),
    files: { "failing.test.mjs": failTest },
  },
  {
    id: "nonzero-with-green-output",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "false-claim.mjs"]),
    files: { "false-claim.mjs": 'console.log("TAP version 13\\nok 1 - claimed\\n1..1"); process.exitCode = 9;\n' },
  },
  {
    id: "zero-tests",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "zero.mjs"]),
    files: { "zero.mjs": 'console.log("TAP version 13\\n1..0");\n' },
  },
  {
    id: "all-tests-skipped",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: nodeTestPolicy("skipped.test.mjs"),
    files: { "skipped.test.mjs": 'import test from "node:test"; test.skip("nothing ran", () => {});\n' },
  },
  {
    id: "narrow-test-hides-suite-failure",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: nodeTestPolicy("canonical-full.test.mjs"),
    files: {
      "agent-narrow.test.mjs": passTest,
      "canonical-full.test.mjs": failTest,
    },
  },
  {
    id: "stale-report-not-current-run",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: {
      schemaVersion: "1",
      policyId: "benchmark/stale",
      command: [process.execPath, "no-report.mjs", "{report}"],
      result: { adapter: "junit", source: "file" },
    },
    files: {
      "no-report.mjs": "// old-report.xml exists, but this invocation emits nothing\n",
      "old-report.xml": '<testsuites tests="1" failures="0" skipped="0"/>',
    },
  },
  {
    id: "interrupted-run-reuses-old-inode",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: {
      schemaVersion: "1",
      policyId: "benchmark/resume",
      command: [process.execPath, "resume.mjs", "{report}"],
      result: { adapter: "junit", source: "file" },
    },
    files: {
      "resume.mjs": 'import { linkSync, utimesSync } from "node:fs"; utimesSync("old-report.xml", new Date(0), new Date(0)); linkSync("old-report.xml", process.argv[2]);\n',
      "old-report.xml": '<testsuites tests="1" failures="0" skipped="0"/>',
    },
  },
  {
    id: "forged-cooperative-receipt",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "forge.mjs"]),
    files: { "forge.mjs": 'import { writeFileSync } from "node:fs"; writeFileSync(".delivery-gate/receipt.json", JSON.stringify({status:"verified"})); console.log("TAP version 13\\nnot ok 1 - real failure\\n1..1"); process.exitCode = 1;\n' },
  },
  {
    id: "dirty-tree-after-test",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "mutate.mjs"]),
    files: { "mutate.mjs": 'import { writeFileSync } from "node:fs"; writeFileSync("unexpected.txt", "mutation"); console.log("TAP version 13\\nok 1 - pass\\n1..1");\n' },
  },
  {
    id: "test-timeout",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: false,
    policy: tapPolicy([process.execPath, "hang.mjs"], { timeoutMs: 100 }),
    files: { "hang.mjs": "setInterval(() => {}, 60_000);\n" },
  },
  {
    id: "runner-crash",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: false,
    policy: tapPolicy([process.execPath, "crash.mjs"]),
    files: { "crash.mjs": 'process.kill(process.pid, "SIGKILL");\n' },
  },
  {
    id: "required-artifact-missing",
    expectedValid: false,
    agentClaim: true,
    cooperativeClaim: true,
    policy: tapPolicy([process.execPath, "no-artifact.mjs"], { artifacts: [{ path: "{artifactDir}/required.txt" }] }),
    files: { "no-artifact.mjs": 'console.log("TAP version 13\\nok 1 - test only\\n1..1");\n' },
  },
  playwrightScenario("playwright-screenshot-failed-dom", false),
];

const rows: Array<{
  id: string;
  expected: "valid" | "invalid";
  native: boolean;
  cooperative: boolean;
  atomic: AtomicOutcome;
}> = [];

function summarizeFailure(failure: string): string {
  const [code, detail] = failure.split(":", 2);
  if (["command_exit_nonzero", "tests_failed", "flaky_tests_disallowed"].includes(code) && /^\d+$/.test(detail ?? "")) {
    return `${code}:${detail}`;
  }
  return code;
}

for (const scenario of scenarios) {
  const root = await createRepository(scenario.policy, scenario.files);
  let atomic: AtomicOutcome;
  try {
    const { receipt } = await verifyDelivery({ configPath: resolve(root, "delivery-gate.json") });
    atomic = {
      accepted: receipt.status === "verified",
      status: receipt.status,
      failures: receipt.failures.map(summarizeFailure),
      tests: receipt.tests,
    };
  } catch (error) {
    atomic = { accepted: false, status: "blocked", failures: [`verifier_error:${(error as Error).message}`], tests: null };
  }
  rows.push({
    id: scenario.id,
    expected: scenario.expectedValid ? "valid" : "invalid",
    native: scenario.agentClaim,
    cooperative: scenario.cooperativeClaim,
    atomic,
  });
  console.log(`${scenario.id.padEnd(38)} expected=${scenario.expectedValid ? "valid  " : "invalid"} native=${scenario.agentClaim ? "ACCEPT" : "REJECT"} cooperative=${scenario.cooperativeClaim ? "ACCEPT" : "REJECT"} atomic=${atomic.status.toUpperCase()}`);
}

const invalid = rows.filter((row) => row.expected === "invalid");
const valid = rows.filter((row) => row.expected === "valid");
const falseGreens = (mode: "native" | "cooperative" | "atomic"): number => invalid.filter((row) => mode === "atomic" ? row.atomic.accepted : row[mode]).length;
const correctAccepted = (mode: "native" | "cooperative" | "atomic"): number => valid.filter((row) => mode === "atomic" ? row.atomic.accepted : row[mode]).length;
const nativeFalseGreens = falseGreens("native");
const atomicFalseGreens = falseGreens("atomic");
const reduction = nativeFalseGreens === 0 ? 1 : (nativeFalseGreens - atomicFalseGreens) / nativeFalseGreens;
const acceptance = valid.length === 0 ? 0 : correctAccepted("atomic") / valid.length;
const go = atomicFalseGreens === 0 && reduction >= 0.7 && acceptance >= 0.9;

const result = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  scenarios: rows,
  metrics: {
    planted_invalid: invalid.length,
    planted_valid: valid.length,
    native_false_greens: nativeFalseGreens,
    cooperative_false_greens: falseGreens("cooperative"),
    atomic_false_greens: atomicFalseGreens,
    false_green_reduction_vs_native: reduction,
    atomic_correct_task_acceptance: acceptance,
  },
  decision: go ? "GO" : "NO-GO",
};

const output = resolve(projectRoot, "benchmark/results/latest.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nDecision: ${result.decision}`);
console.log(`False greens (native / cooperative / atomic): ${nativeFalseGreens} / ${falseGreens("cooperative")} / ${atomicFalseGreens} of ${invalid.length}`);
console.log(`False-green reduction vs native: ${(reduction * 100).toFixed(1)}%`);
console.log(`Correct-task acceptance: ${(acceptance * 100).toFixed(1)}%`);
console.log(`Structured result: ${output}`);
if (!go) process.exitCode = 1;
