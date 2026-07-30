import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("reusable workflow isolates verification from signing authority", async () => {
  const workflow = await readFile(resolve(projectRoot, ".github/workflows/reusable-delivery-gate.yml"), "utf8");
  const verifyStart = workflow.indexOf("\n  verify:\n");
  const attestStart = workflow.indexOf("\n  attest:\n");
  assert(verifyStart >= 0 && attestStart > verifyStart);

  const verifyJob = workflow.slice(verifyStart, attestStart);
  const attestJob = workflow.slice(attestStart);
  const actionRefs = [...workflow.matchAll(/uses:\s+\S+@(\S+)/g)].map((match) => match[1]);
  assert(actionRefs.length > 0);
  assert(actionRefs.every((ref) => /^[0-9a-f]{40}$/.test(ref)), `unpinned action refs: ${actionRefs.join(", ")}`);
  assert.doesNotMatch(verifyJob, /id-token: write/);
  assert.doesNotMatch(verifyJob, /attestations: write/);
  assert.doesNotMatch(verifyJob, /cache: npm/);
  assert.match(verifyJob, /Check out candidate[\s\S]*persist-credentials: false/);
  assert.match(
    verifyJob,
    /if \[\[ -f package\.json \]\]; then[\s\S]*if \[\[ -f package-lock\.json \|\| -f npm-shrinkwrap\.json \]\]; then[\s\S]*npm run build --if-present[\s\S]*fi/,
  );
  assert.match(verifyJob, /--receipt "\$RUNNER_TEMP\/delivery-gate\/receipt\.json"/);
  assert.match(verifyJob, /Preserve delivery receipt[\s\S]*if: always\(\)/);
  assert.match(verifyJob, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(attestJob, /needs: verify/);
  assert.match(attestJob, /id-token: write/);
  assert.match(attestJob, /attestations: write/);
});
