#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outsideTarget = resolve(projectRoot, "..", `.agent-loopback-outside-${randomUUID()}`);

function run() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [
      resolve(projectRoot, "scripts/run-agent-loopback.mjs"),
      "--workspace", projectRoot,
      "--",
      process.execPath,
      resolve(projectRoot, "scripts/agent-loopback-probe-child.mjs"),
    ], {
      cwd: projectRoot,
      env: { ...process.env, AGENT_LOOPBACK_OUTSIDE_TARGET: outsideTarget },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveRun({ code, signal }));
  });
}

try {
  await access(outsideTarget);
  throw new Error(`Probe target already exists: ${outsideTarget}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

try {
  const result = await run();
  if (result.signal) throw new Error(`Loopback probe terminated by ${result.signal}`);
  if (result.code !== 0) process.exitCode = result.code ?? 1;
} finally {
  // This exact random path is cleaned only if a broken profile unexpectedly created it.
  await unlink(outsideTarget).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
