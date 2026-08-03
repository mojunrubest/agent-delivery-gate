import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { DeliveryReceipt } from "../src/types.js";

const execute = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = resolve(projectRoot, "python-api-pilot/mutation-fixture");
const policyPath = resolve(projectRoot, argument("--policy") ?? "python-api-pilot/contracts/content-blob-v1.json");
const resultPath = resolve(projectRoot, argument("--output") ?? "python-api-pilot/results/mutation-latest.json");
const cliPath = resolve(projectRoot, "dist/src/cli.js");

interface Mutation {
  id: string;
  category: string;
  defect: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface MutationResult extends Mutation {
  publicAccepted: boolean;
  protectedAccepted: boolean;
  gateStatus: DeliveryReceipt["status"];
  tests: DeliveryReceipt["tests"];
  failures: string[];
  failedGroups: string[];
  publicDurationMs: number;
  protectedDurationMs: number;
  controlEvidence?: {
    receiptSchemaVersion: DeliveryReceipt["schema_version"];
    policyBundleSha256: string;
    controlAssets: DeliveryReceipt["policy"]["control_assets"];
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function run(command: string, args: string[], options: Parameters<typeof execute>[2]): Promise<CommandResult> {
  try {
    const result = await execute(command, args, options);
    return { ok: true, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: failure.stdout?.toString() ?? "",
      stderr: failure.stderr?.toString() ?? failure.message,
    };
  }
}

async function initializeWorkspace(id: string): Promise<string> {
  const workspace = await mkdtemp(resolve(tmpdir(), `content-blob-mutant-${id}-`));
  await cp(fixtureRoot, workspace, { recursive: true });
  await execute("git", ["init", "--quiet"], { cwd: workspace });
  await execute("git", ["config", "user.name", "Mutation Campaign"], { cwd: workspace });
  await execute("git", ["config", "user.email", "mutation@local.invalid"], { cwd: workspace });
  await execute("git", ["add", "."], { cwd: workspace });
  await execute("git", ["commit", "--quiet", "-m", "Create mutation fixture"], { cwd: workspace });
  return workspace;
}

function failedTapGroups(output: string): string[] {
  return [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
}

async function evaluate(mutation: Mutation): Promise<MutationResult> {
  const workspace = await initializeWorkspace(mutation.id);
  const environment = {
    ...process.env,
    CONTENT_BLOB_MUTATION: mutation.id,
    PYTHONDONTWRITEBYTECODE: "1",
  };
  try {
    const publicStarted = Date.now();
    const publicResult = await run(
      "python3",
      ["-m", "unittest", "discover", "-s", "test", "-p", "test_*.py", "-v"],
      { cwd: workspace, env: environment, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const publicDurationMs = Date.now() - publicStarted;

    const receiptPath = resolve(workspace, ".delivery-gate/receipt.json");
    await run(
      process.execPath,
      [cliPath, "verify", "--config", policyPath, "--workspace", workspace, "--receipt", receiptPath],
      { cwd: projectRoot, env: environment, timeout: 75_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as DeliveryReceipt;
    const tap = await readFile(receipt.execution.stdout.path, "utf8");
    const result: MutationResult = {
      ...mutation,
      publicAccepted: publicResult.ok,
      protectedAccepted: receipt.status === "verified",
      gateStatus: receipt.status,
      tests: receipt.tests,
      failures: receipt.failures.map((failure) => failure.split(":", 1)[0]),
      failedGroups: failedTapGroups(tap),
      publicDurationMs,
      protectedDurationMs: receipt.execution.duration_ms,
    };
    if (mutation.id === "baseline") {
      result.controlEvidence = {
        receiptSchemaVersion: receipt.schema_version,
        policyBundleSha256: receipt.policy.bundle_sha256,
        controlAssets: receipt.policy.control_assets,
      };
    }
    return result;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function evaluateBaseline(): Promise<MutationResult> {
  return evaluate({ id: "baseline", category: "control", defect: "none" });
}

const mutations = JSON.parse(await readFile(resolve(projectRoot, "python-api-pilot/mutations.json"), "utf8")) as Mutation[];
const requestedConcurrency = Number.parseInt(argument("--concurrency") ?? "4", 10);
if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 8) {
  throw new Error("--concurrency must be between 1 and 8");
}

console.log(`Frozen policy: ${policyPath}`);
console.log(`Mutations: ${mutations.length}; concurrency: ${requestedConcurrency}`);
const campaignStarted = Date.now();
const baseline = await evaluateBaseline();
console.log(`baseline`.padEnd(34) + ` public=${baseline.publicAccepted ? "ACCEPT" : "REJECT"} protected=${baseline.protectedAccepted ? "ACCEPT" : "REJECT"}`);
if (!baseline.publicAccepted || !baseline.protectedAccepted) {
  throw new Error(`mutation fixture baseline failed: ${JSON.stringify(baseline)}`);
}
if (!baseline.controlEvidence) throw new Error("mutation fixture baseline did not produce control bundle evidence");

const rows = new Array<MutationResult>(mutations.length);
let nextIndex = 0;
async function worker(): Promise<void> {
  while (nextIndex < mutations.length) {
    const index = nextIndex;
    nextIndex += 1;
    const row = await evaluate(mutations[index]);
    rows[index] = row;
    console.log(
      row.id.padEnd(34)
      + ` public=${row.publicAccepted ? "SURVIVE" : "KILL"}`
      + ` protected=${row.protectedAccepted ? "SURVIVE" : "KILL"}`,
    );
  }
}
await Promise.all(Array.from({ length: Math.min(requestedConcurrency, mutations.length) }, () => worker()));

const protectedSurvivors = rows.filter((row) => row.protectedAccepted);
const publicSurvivors = rows.filter((row) => row.publicAccepted);
const protectedBlocked = rows.filter((row) => row.gateStatus === "blocked");
const protectedTimedOut = rows.filter((row) => row.failures.includes("command_timeout"));
const protectedAssertionKilled = rows.filter((row) => row.gateStatus === "unverified");
const categories = [...new Set(rows.map((row) => row.category))].sort();
const byCategory = Object.fromEntries(categories.map((category) => {
  const categoryRows = rows.filter((row) => row.category === category);
  const survivors = categoryRows.filter((row) => row.protectedAccepted);
  return [category, {
    mutations: categoryRows.length,
    killed: categoryRows.length - survivors.length,
    survived: survivors.length,
    mutationScore: (categoryRows.length - survivors.length) / categoryRows.length,
    survivorIds: survivors.map((row) => row.id),
  }];
}));
const policy = await readFile(policyPath);
const fixture = await readFile(resolve(fixtureRoot, "src/blob_server.py"));
const { controlEvidence, ...baselineResult } = baseline;
const result = {
  schemaVersion: "1",
  generatedAt: new Date().toISOString(),
  kind: "content_blob_contract_mutation_campaign",
  frozenControlCommit: (await execute("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).stdout.trim(),
  policySha256: createHash("sha256").update(policy).digest("hex"),
  controlEvidence,
  fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
  campaignDurationMs: Date.now() - campaignStarted,
  baseline: baselineResult,
  metrics: {
    mutations: rows.length,
    publicKilled: rows.length - publicSurvivors.length,
    publicSurvived: publicSurvivors.length,
    protectedKilled: rows.length - protectedSurvivors.length,
    protectedSurvived: protectedSurvivors.length,
    protectedAssertionKilled: protectedAssertionKilled.length,
    protectedBlocked: protectedBlocked.length,
    protectedTimedOut: protectedTimedOut.length,
    protectedMutationScore: (rows.length - protectedSurvivors.length) / rows.length,
  },
  assessment: protectedSurvivors.length === 0 ? "NO_SURVIVORS_IN_CORPUS" : "GAPS_FOUND",
  survivorIds: protectedSurvivors.map((row) => row.id),
  byCategory,
  mutationsDetail: rows,
};
await mkdir(dirname(resultPath), { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

console.log(`\nAssessment: ${result.assessment}`);
console.log(`Public killed: ${result.metrics.publicKilled} / ${rows.length}`);
console.log(`Protected killed: ${result.metrics.protectedKilled} / ${rows.length}`);
console.log(`Protected survivors: ${result.survivorIds.join(", ") || "none"}`);
console.log(`Result: ${resultPath}`);
