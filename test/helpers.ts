import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GatePolicy } from "../src/types.js";

export function tapPolicy(command: string[], overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    schemaVersion: "1",
    policyId: "test/canonical",
    command,
    timeoutMs: 5_000,
    result: { adapter: "tap", source: "stdout" },
    ...overrides,
  };
}

export async function createRepository(policy: GatePolicy, files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "delivery-gate-"));
  const allFiles: Record<string, string> = {
    ".gitignore": ".delivery-gate/\nnode_modules/\ntest-results/\n",
    "delivery-gate.json": `${JSON.stringify(policy, null, 2)}\n`,
    ...files,
  };
  for (const [path, content] of Object.entries(allFiles)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Delivery Gate Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "gate@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
  return root;
}
