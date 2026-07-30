import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyDelivery } from "../src/verifier.js";

const execute = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const repository = argument("--repo");
if (!repository) throw new Error("Usage: npm run pilot -- --repo <candidate-repository>");
const candidateRepository = resolve(repository);
const cases = JSON.parse(await readFile(resolve(projectRoot, "pilot/cases.json"), "utf8")) as Array<{ id: string; expectedValid: boolean }>;
const policyPath = resolve(projectRoot, "pilot/contracts/checkout-v1.json");
const rows: Array<Record<string, unknown>> = [];

for (const scenario of cases) {
  const branch = `candidate/${scenario.id}`;
  const workspace = await mkdtemp(resolve(tmpdir(), `checkout-${scenario.id}-`));
  await execute("git", ["clone", "--quiet", "--single-branch", "--branch", branch, candidateRepository, workspace]);
  const { stdout: commitOutput } = await execute("git", ["rev-parse", "HEAD"], { cwd: workspace });
  let publicTestPassed = true;
  try {
    await execute("npm", ["test"], { cwd: workspace, maxBuffer: 2 * 1024 * 1024 });
  } catch {
    publicTestPassed = false;
  }
  const { receipt } = await verifyDelivery({
    configPath: policyPath,
    workspace,
    receiptPath: resolve(workspace, ".delivery-gate/receipt.json"),
  });
  const atomicAccepted = receipt.status === "verified";
  rows.push({
    id: scenario.id,
    branch,
    commit: commitOutput.trim(),
    expected: scenario.expectedValid ? "valid" : "invalid",
    public_test_accepted: publicTestPassed,
    atomic_status: receipt.status,
    atomic_accepted: atomicAccepted,
    tests: receipt.tests,
    failures: receipt.failures.map((failure) => failure.split(":", 1)[0]),
  });
  console.log(`${scenario.id.padEnd(34)} public=${publicTestPassed ? "ACCEPT" : "REJECT"} atomic=${receipt.status.toUpperCase()}`);
}

const invalid = rows.filter((row) => row.expected === "invalid");
const valid = rows.filter((row) => row.expected === "valid");
const publicFalseGreens = invalid.filter((row) => row.public_test_accepted).length;
const atomicFalseGreens = invalid.filter((row) => row.atomic_accepted).length;
const validAccepted = valid.filter((row) => row.atomic_accepted).length;
const decision = atomicFalseGreens === 0 && validAccepted === valid.length ? "GO" : "NO-GO";
const result = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  control_commit: (await execute("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).stdout.trim(),
  candidate_repository: basename(candidateRepository),
  metrics: {
    candidates: rows.length,
    planted_valid: valid.length,
    planted_invalid: invalid.length,
    public_false_greens: publicFalseGreens,
    atomic_false_greens: atomicFalseGreens,
    atomic_correct_task_acceptance: valid.length === 0 ? 0 : validAccepted / valid.length,
  },
  decision,
  candidates_detail: rows,
};

const output = resolve(projectRoot, "pilot/results/latest.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nDecision: ${decision}`);
console.log(`False greens (public / atomic): ${publicFalseGreens} / ${atomicFalseGreens} of ${invalid.length}`);
console.log(`Correct-task acceptance: ${validAccepted} / ${valid.length}`);
console.log(`Result: ${output}`);
if (decision !== "GO") process.exitCode = 1;
