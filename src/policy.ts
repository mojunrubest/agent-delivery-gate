import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./hash.js";
import type { GatePolicy, ResultAdapter, ResultSource } from "./types.js";

const adapters = new Set<ResultAdapter>(["tap", "junit", "playwright-json"]);
const sources = new Set<ResultSource>(["stdout", "file"]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invalid policy: ${message}`);
}

function assertKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(unknown.length === 0, `${label} contains unknown fields: ${unknown.join(", ")}`);
}

export async function loadPolicy(path: string): Promise<{
  policy: GatePolicy;
  absolutePath: string;
  sha256: string;
}> {
  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, "utf8");
  const value: unknown = JSON.parse(raw);
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "root must be an object");
  const policy = value as Partial<GatePolicy>;
  assertKeys(policy as Record<string, unknown>, [
    "schemaVersion", "policyId", "command", "cwd", "timeoutMs", "maxOutputBytes", "result",
    "requireCleanTree", "requireTests", "requirePassingTest", "allowFlaky", "artifacts",
  ], "root");
  assert(policy.schemaVersion === "1", "schemaVersion must be '1'");
  assert(typeof policy.policyId === "string" && policy.policyId.length > 0, "policyId is required");
  assert(Array.isArray(policy.command) && policy.command.length > 0, "command must be a non-empty argv array");
  assert(policy.command.every((part) => typeof part === "string" && part.length > 0), "command entries must be strings");
  assert(policy.result !== undefined && typeof policy.result === "object", "result is required");
  assertKeys(policy.result as unknown as Record<string, unknown>, ["adapter", "source"], "result");
  assert(adapters.has(policy.result.adapter as ResultAdapter), "unsupported result adapter");
  assert(sources.has(policy.result.source as ResultSource), "unsupported result source");
  assert(!(policy.result.source === "stdout" && policy.command.includes("{report}")), "stdout result cannot use {report}");
  assert(!(policy.result.source === "file" && !policy.command.some((part) => part.includes("{report}"))), "file result requires a {report} argv placeholder");
  if (policy.cwd !== undefined) assert(typeof policy.cwd === "string" && policy.cwd.length > 0, "cwd must be a string");
  if (policy.timeoutMs !== undefined) assert(Number.isInteger(policy.timeoutMs) && policy.timeoutMs > 0, "timeoutMs must be a positive integer");
  if (policy.maxOutputBytes !== undefined) assert(Number.isInteger(policy.maxOutputBytes) && policy.maxOutputBytes > 0, "maxOutputBytes must be a positive integer");
  for (const key of ["requireCleanTree", "requireTests", "requirePassingTest", "allowFlaky"] as const) {
    if (policy[key] !== undefined) assert(typeof policy[key] === "boolean", `${key} must be a boolean`);
  }
  if (policy.artifacts !== undefined) {
    assert(Array.isArray(policy.artifacts), "artifacts must be an array");
    for (const artifact of policy.artifacts) {
      assert(artifact !== null && typeof artifact === "object", "artifact must be an object");
      assertKeys(artifact as unknown as Record<string, unknown>, ["path", "required"], "artifact");
      assert(typeof artifact.path === "string" && artifact.path.length > 0, "artifact path is required");
      if (artifact.required !== undefined) assert(typeof artifact.required === "boolean", "artifact required must be a boolean");
    }
  }
  return { policy: policy as GatePolicy, absolutePath, sha256: sha256(raw) };
}

export function policyDefaults(policy: GatePolicy): Required<Omit<GatePolicy, "cwd" | "artifacts">> & Pick<GatePolicy, "cwd" | "artifacts"> {
  return {
    ...policy,
    timeoutMs: policy.timeoutMs ?? 120_000,
    maxOutputBytes: policy.maxOutputBytes ?? 10 * 1024 * 1024,
    requireCleanTree: policy.requireCleanTree ?? true,
    requireTests: policy.requireTests ?? true,
    requirePassingTest: policy.requirePassingTest ?? true,
    allowFlaky: policy.allowFlaky ?? false,
  };
}
