import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseResult } from "./adapters.js";
import { snapshotGit, type GitSnapshot } from "./git.js";
import { hashFile, sha256, stableJson } from "./hash.js";
import { loadPolicy, policyDefaults } from "./policy.js";
import type { DeliveryReceipt, DeliveryStatus, FileEvidence, VerificationResult } from "./types.js";

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputExceeded: boolean;
  launchError: string | null;
}

function replaceToken(value: string, token: string, replacement: string): string {
  return value.split(token).join(replacement);
}

function materialize(value: string, reportPath: string, artifactDir: string, policyDirectory: string): string {
  return replaceToken(
    replaceToken(replaceToken(value, "{report}", reportPath), "{artifactDir}", artifactDir),
    "{policyDir}",
    policyDirectory,
  );
}

function killProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

function runProcess(command: string[], cwd: string, timeoutMs: number, maxOutputBytes: number, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let launchError: string | null = null;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stop = (reason: "timeout" | "output"): void => {
      if (reason === "timeout") timedOut = true;
      else outputExceeded = true;
      killProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 750);
      forceKillTimer.unref();
    };

    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    timeout.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.byteLength, remaining);
      }
      if (!outputExceeded && stdoutBytes + stderrBytes >= maxOutputBytes) stop("output");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrBytes;
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.byteLength, remaining);
      }
      if (!outputExceeded && stdoutBytes + stderrBytes >= maxOutputBytes) stop("output");
    });
    child.on("error", (error) => { launchError = error.message; });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolveResult({
        exitCode,
        signal: signal as NodeJS.Signals | null,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        outputExceeded,
        launchError,
      });
    });
  });
}

async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function evidence(path: string): Promise<FileEvidence> {
  const hash = await hashFile(path);
  return { path, ...hash };
}

async function controlBundle(
  policySha256: string,
  policyDirectory: string,
  declaredAssets: string[],
  candidateWorkspace: string,
): Promise<{ sha256: string; assets: FileEvidence[] }> {
  const assets = await Promise.all([...declaredAssets].sort().map(async (declaredPath) => {
    const absolutePath = resolve(policyDirectory, declaredPath);
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) throw new Error(`control asset is not a regular file: ${declaredPath}`);
    if (inside(candidateWorkspace, await realpath(absolutePath))) {
      throw new Error(`control asset is inside the candidate workspace: ${declaredPath}`);
    }
    return { path: declaredPath, ...await hashFile(absolutePath) };
  }));
  return {
    sha256: sha256(stableJson({ policy_sha256: policySha256, control_assets: assets })),
    assets,
  };
}

function inside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function snapshotFields(snapshot: GitSnapshot | null): { root: string | null; head: string | null; digest: string | null; dirty: string[] } {
  return snapshot
    ? { root: snapshot.root, head: snapshot.head, digest: snapshot.digest, dirty: snapshot.dirty }
    : { root: null, head: null, digest: null, dirty: [] };
}

export async function verifyDelivery(options: { configPath: string; receiptPath?: string; workspace?: string }): Promise<VerificationResult> {
  const loaded = await loadPolicy(options.configPath);
  const policy = policyDefaults(loaded.policy);
  const policyDirectory = dirname(loaded.absolutePath);
  const workspace = await realpath(resolve(options.workspace ?? policyDirectory));
  const controlBefore = await controlBundle(loaded.sha256, policyDirectory, policy.controlAssets ?? [], workspace);
  const cwd = await realpath(resolve(workspace, policy.cwd ?? "."));
  if (!inside(workspace, cwd)) throw new Error("policy cwd escapes the candidate workspace");
  const receiptPath = resolve(options.receiptPath ?? resolve(policyDirectory, ".delivery-gate/receipt.json"));
  const runId = randomUUID();
  const runDirectory = resolve(dirname(receiptPath), "runs", runId);
  const reportPath = resolve(runDirectory, "report");
  const artifactDirectory = resolve(runDirectory, "artifacts");
  const stdoutPath = resolve(runDirectory, "stdout.log");
  const stderrPath = resolve(runDirectory, "stderr.log");
  await mkdir(artifactDirectory, { recursive: true });

  const command = policy.command.map((part) => materialize(part, reportPath, artifactDirectory, policyDirectory));
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let before: GitSnapshot | null = null;
  let after: GitSnapshot | null = null;
  const failures: string[] = [];
  const blocked: string[] = [];

  try {
    before = await snapshotGit(cwd);
  } catch (error) {
    blocked.push(`git_preflight_failed:${(error as Error).message}`);
  }
  if (before && policy.requireCleanTree && before.dirty.length > 0) failures.push("worktree_dirty_before");

  let processResult: ProcessResult = {
    exitCode: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: false,
    outputExceeded: false,
    launchError: null,
  };
  if (blocked.length === 0 && failures.length === 0) {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    processResult = await runProcess(command, cwd, policy.timeoutMs, policy.maxOutputBytes, {
      ...childEnvironment,
      DELIVERY_GATE_RUN_ID: runId,
      DELIVERY_GATE_REPORT_PATH: reportPath,
      DELIVERY_GATE_ARTIFACT_DIR: artifactDirectory,
    });
  }
  await writeAtomic(stdoutPath, processResult.stdout);
  await writeAtomic(stderrPath, processResult.stderr);

  if (processResult.timedOut) blocked.push("command_timeout");
  if (processResult.outputExceeded) blocked.push("output_limit_exceeded");
  if (processResult.launchError) blocked.push(`command_launch_failed:${processResult.launchError}`);
  if (processResult.signal && !processResult.timedOut && !processResult.outputExceeded) blocked.push(`command_terminated_by_signal:${processResult.signal}`);
  if (processResult.exitCode !== null && processResult.exitCode !== 0) failures.push(`command_exit_nonzero:${processResult.exitCode}`);

  let tests: DeliveryReceipt["tests"] = null;
  let reportEvidence: FileEvidence | null = null;
  if (blocked.length === 0 && failures[0] !== "worktree_dirty_before") {
    try {
      if (policy.result.source === "stdout") {
        tests = parseResult(policy.result.adapter, processResult.stdout.toString("utf8"));
        reportEvidence = await evidence(stdoutPath);
      } else {
        const reportStats = await stat(reportPath);
        if (!reportStats.isFile()) throw new Error("report is not a regular file");
        if (reportStats.mtimeMs < started - 2_000) throw new Error("report predates this verifier run");
        const report = await readFile(reportPath);
        tests = parseResult(policy.result.adapter, report.toString("utf8"));
        reportEvidence = await evidence(reportPath);
      }
    } catch (error) {
      blocked.push(`result_unavailable:${(error as Error).message}`);
    }
  }

  if (tests) {
    if (policy.requireTests && tests.collected === 0) failures.push("no_tests_collected");
    if (policy.requireTests && tests.collected > 0 && tests.passed === 0 && tests.skipped === tests.collected) failures.push("all_tests_skipped");
    if (tests.failed > 0) failures.push(`tests_failed:${tests.failed}`);
    if (!policy.allowFlaky && tests.flaky > 0) failures.push(`flaky_tests_disallowed:${tests.flaky}`);
    if (policy.requirePassingTest && tests.passed === 0 && !failures.includes("no_tests_collected") && !failures.includes("all_tests_skipped")) {
      failures.push("no_passing_test");
    }
  }

  const artifacts: FileEvidence[] = [];
  for (const rule of policy.artifacts ?? []) {
    const materialized = materialize(rule.path, reportPath, artifactDirectory, policyDirectory);
    const artifactPath = isAbsolute(materialized) ? resolve(materialized) : resolve(cwd, materialized);
    if (before && !inside(before.root, artifactPath) && !inside(runDirectory, artifactPath)) {
      blocked.push(`artifact_outside_allowed_roots:${rule.path}`);
      continue;
    }
    try {
      const artifactStats = await stat(artifactPath);
      if (!artifactStats.isFile()) throw new Error("not a regular file");
      if (artifactStats.mtimeMs < started - 2_000) throw new Error("artifact predates this verifier run");
      artifacts.push(await evidence(artifactPath));
    } catch (error) {
      if (rule.required ?? true) failures.push(`required_artifact_unavailable:${rule.path}:${(error as Error).message}`);
    }
  }

  if (before) {
    try {
      after = await snapshotGit(cwd);
      if (before.head !== after.head || before.digest !== after.digest) failures.push("worktree_changed_during_verification");
      if (policy.requireCleanTree && after.dirty.length > 0) failures.push("worktree_dirty_after");
    } catch (error) {
      blocked.push(`git_postflight_failed:${(error as Error).message}`);
    }
  }

  try {
    const policyAfter = await hashFile(loaded.absolutePath);
    const controlAfter = await controlBundle(policyAfter.sha256, policyDirectory, policy.controlAssets ?? [], workspace);
    if (controlBefore.sha256 !== controlAfter.sha256) failures.push("control_assets_changed_during_verification");
  } catch (error) {
    blocked.push(`control_assets_postflight_failed:${(error as Error).message}`);
  }

  const ended = Date.now();
  const status: DeliveryStatus = blocked.length > 0 ? "blocked" : failures.length > 0 ? "unverified" : "verified";
  const beforeFields = snapshotFields(before);
  const afterFields = snapshotFields(after);
  const receipt: DeliveryReceipt = {
    schema_version: "1.0",
    run_id: runId,
    status,
    policy: {
      id: policy.policyId,
      path: loaded.absolutePath,
      sha256: loaded.sha256,
      bundle_sha256: controlBefore.sha256,
      control_assets: controlBefore.assets,
    },
    repository: {
      root: beforeFields.root,
      head: beforeFields.head,
      tree_digest_before: beforeFields.digest,
      tree_digest_after: afterFields.digest,
      dirty_before: beforeFields.dirty,
      dirty_after: afterFields.dirty,
    },
    execution: {
      command,
      command_sha256: sha256(stableJson(command)),
      cwd,
      started_at: startedAt,
      ended_at: new Date(ended).toISOString(),
      duration_ms: ended - started,
      exit_code: processResult.exitCode,
      signal: processResult.signal,
      timed_out: processResult.timedOut,
      launch_error: processResult.launchError,
      stdout: await evidence(stdoutPath),
      stderr: await evidence(stderrPath),
      report: reportEvidence,
    },
    tests,
    artifacts,
    failures: [...blocked, ...failures],
  };
  await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, receiptPath };
}
