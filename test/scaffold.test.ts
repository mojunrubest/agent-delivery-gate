import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { renderConsumerWorkflow, writeConsumerWorkflow } from "../src/scaffold.js";

const valid = {
  controlRepository: "example/delivery-control",
  controlRef: "0123456789abcdef0123456789abcdef01234567",
  policyPath: "contracts/web-v1.json",
};

test("renders an immutable least-privilege consumer workflow", () => {
  const workflow = renderConsumerWorkflow(valid);
  assert.match(workflow, /uses: example\/delivery-control\/.github\/workflows\/reusable-delivery-gate\.yml@0123456789abcdef0123456789abcdef01234567/);
  assert.match(workflow, /install-chromium: false/);
  assert.match(workflow, /attest: false/);
  assert.doesNotMatch(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /\$\{\{/);
});

test("adds browser setup and signing permissions only when requested", () => {
  const workflow = renderConsumerWorkflow({ ...valid, installChromium: true, attest: true });
  assert.match(workflow, /install-chromium: true/);
  assert.match(workflow, /attest: true/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
});

test("rejects mutable refs and escaping policy paths", () => {
  assert.throws(() => renderConsumerWorkflow({ ...valid, controlRef: "main" }), /full lowercase 40-character commit SHA/);
  assert.throws(() => renderConsumerWorkflow({ ...valid, policyPath: "../candidate/policy.json" }), /parent-directory/);
  assert.throws(() => renderConsumerWorkflow({ ...valid, controlRepository: "missing-owner" }), /owner\/repository/);
});

test("writes once by default and requires force to replace a workflow", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-gate-scaffold-"));
  const output = resolve(root, ".github/workflows/agent-delivery-gate.yml");
  await writeConsumerWorkflow(output, valid);
  assert.equal(await readFile(output, "utf8"), renderConsumerWorkflow(valid));
  await assert.rejects(writeConsumerWorkflow(output, valid), { code: "EEXIST" });
  await writeConsumerWorkflow(output, { ...valid, installChromium: true }, true);
  assert.match(await readFile(output, "utf8"), /install-chromium: true/);
});
