import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyDelivery } from "../src/verifier.js";
import type { GatePolicy } from "../src/types.js";
import { createRepository, tapPolicy } from "./helpers.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function verify(root: string) {
  return verifyDelivery({ configPath: resolve(root, "delivery-gate.json") });
}

test("verifies a real node:test run and binds it to an unchanged tree", async () => {
  const root = await createRepository(tapPolicy([process.execPath, "--test", "--test-reporter=tap", "passing.test.mjs"]), {
    "passing.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; test("real", () => assert.equal(2 + 2, 4));\n',
  });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "verified");
  assert.deepEqual(receipt.tests, { collected: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 });
  assert.equal(receipt.repository.tree_digest_before, receipt.repository.tree_digest_after);
  assert.equal(receipt.execution.exit_code, 0);
});

test("rejects a green-looking report paired with a nonzero exit", async () => {
  const script = 'console.log("TAP version 13\\nok 1 - claimed pass\\n1..1"); process.exitCode = 7;\n';
  const root = await createRepository(tapPolicy([process.execPath, "claim.mjs"]), { "claim.mjs": script });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "unverified");
  assert(receipt.failures.includes("command_exit_nonzero:7"));
});

test("rejects zero collected tests", async () => {
  const root = await createRepository(tapPolicy([process.execPath, "zero.mjs"]), { "zero.mjs": 'console.log("TAP version 13\\n1..0");\n' });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "unverified");
  assert(receipt.failures.includes("no_tests_collected"));
});

test("rejects an all-skipped suite", async () => {
  const root = await createRepository(tapPolicy([process.execPath, "--test", "--test-reporter=tap", "skipped.test.mjs"]), {
    "skipped.test.mjs": 'import test from "node:test"; test.skip("not evidence", () => {});\n',
  });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "unverified");
  assert(receipt.failures.includes("all_tests_skipped"));
});

test("rejects a command that dirties the verified tree", async () => {
  const script = 'import { writeFileSync } from "node:fs"; writeFileSync("mutation.txt", "changed"); console.log("TAP version 13\\nok 1 - pass\\n1..1");\n';
  const root = await createRepository(tapPolicy([process.execPath, "mutate.mjs"]), { "mutate.mjs": script });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "unverified");
  assert(receipt.failures.includes("worktree_changed_during_verification"));
  assert(receipt.failures.includes("worktree_dirty_after"));
});

test("atomically replaces a forged cooperative receipt", async () => {
  const forged = JSON.stringify({ status: "verified", tests: { passed: 999 } });
  const script = `import { writeFileSync } from "node:fs"; writeFileSync(".delivery-gate/receipt.json", ${JSON.stringify(forged)}); console.log("TAP version 13\\nnot ok 1 - failed\\n1..1"); process.exitCode = 1;\n`;
  const root = await createRepository(tapPolicy([process.execPath, "forge.mjs"]), { "forge.mjs": script });
  const result = await verify(root);
  const onDisk = JSON.parse(await readFile(result.receiptPath, "utf8")) as { run_id: string; status: string };
  assert.equal(result.receipt.status, "unverified");
  assert.equal(onDisk.status, "unverified");
  assert.equal(onDisk.run_id, result.receipt.run_id);
});

test("fails closed on timeout", async () => {
  const root = await createRepository(tapPolicy([process.execPath, "hang.mjs"], { timeoutMs: 100 }), {
    "hang.mjs": "setInterval(() => {}, 10_000);\n",
  });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "blocked");
  assert(receipt.failures.includes("command_timeout"));
  assert.equal(receipt.execution.timed_out, true);
});

test("does not reuse a stale result file", async () => {
  const policy: GatePolicy = {
    schemaVersion: "1",
    policyId: "test/stale",
    command: [process.execPath, "no-report.mjs", "{report}"],
    result: { adapter: "junit", source: "file" },
  };
  const root = await createRepository(policy, {
    "no-report.mjs": "// exits successfully without producing this run's report\n",
    "old-report.xml": '<testsuites tests="1" failures="0" skipped="0"/>',
  });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "blocked");
  assert(receipt.failures.some((failure) => failure.startsWith("result_unavailable:")));
});

test("accepts a real Vitest run through its JUnit reporter", async () => {
  const vitestCli = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
  const policy: GatePolicy = {
    schemaVersion: "1",
    policyId: "test/vitest-junit",
    command: [process.execPath, vitestCli, "run", "vitest.fixture.test.js", "--globals", "--reporter=junit", "--outputFile={report}"],
    result: { adapter: "junit", source: "file" },
  };
  const root = await createRepository(policy, {
    "vitest.fixture.test.js": 'test("vitest executes", () => { expect(3 * 3).toBe(9); });\n',
  });
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "verified", JSON.stringify(receipt.failures));
  assert.equal(receipt.tests?.passed, 1);
  assert(receipt.execution.report);
});

test("fails closed when the canonical executable cannot launch", async () => {
  const root = await createRepository(tapPolicy(["definitely-not-a-real-delivery-gate-command"]));
  const { receipt } = await verify(root);
  assert.equal(receipt.status, "blocked");
  assert(receipt.failures.some((failure) => failure.startsWith("command_launch_failed:")));
});

test("can load a protected policy outside the candidate workspace", async () => {
  const policy = tapPolicy([process.execPath, "pass.mjs"]);
  const root = await createRepository(policy, { "pass.mjs": 'console.log("TAP version 13\\nok 1 - pass\\n1..1");\n' });
  const control = await mkdtemp(resolve(tmpdir(), "delivery-gate-control-"));
  const controlPolicy = resolve(control, "policy.json");
  await writeFile(controlPolicy, `${JSON.stringify(policy)}\n`);
  const { receipt } = await verifyDelivery({ configPath: controlPolicy, workspace: root });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.repository.root, await realpath(root));
  assert.equal(receipt.policy.path, controlPolicy);
});
