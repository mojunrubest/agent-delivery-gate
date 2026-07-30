import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

export async function stopHttpProcess(child, timeoutMs = 1_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, timeoutMs)) return;
  child.kill("SIGKILL");
  await waitForExit(child, timeoutMs);
}

export async function startHttpProcess(t, options) {
  const {
    command,
    cwd = process.cwd(),
    env = process.env,
    readyTimeoutMs = 5_000,
    maxReadyBytes = 16_384,
  } = options;
  assert(Array.isArray(command) && command.length > 0, "command must be a non-empty argv array");

  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < maxReadyBytes) stderr += chunk.slice(0, maxReadyBytes - stderr.length);
  });

  const ready = await new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = "";
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      operation();
    };
    const fail = (message) => finish(() => rejectReady(new Error(`${message}${stderr ? `: ${stderr.trim()}` : ""}`)));
    const onError = (error) => fail(`HTTP process failed to start (${error.message})`);
    const onExit = (code, signal) => fail(`HTTP process exited before readiness (code=${code}, signal=${signal})`);
    const onData = (chunk) => {
      stdout += chunk;
      if (stdout.length > maxReadyBytes) {
        fail("HTTP readiness line exceeded output limit");
        return;
      }
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      try {
        const value = JSON.parse(stdout.slice(0, newline));
        assert(value && typeof value === "object", "readiness must be a JSON object");
        assert.equal(value.host ?? "127.0.0.1", "127.0.0.1", "readiness host must be loopback");
        assert(Number.isInteger(value.port) && value.port > 0 && value.port <= 65_535, "readiness port must be valid");
        finish(() => resolveReady(value));
      } catch (error) {
        fail(`Invalid HTTP readiness line (${error.message})`);
      }
    };
    const timeout = setTimeout(() => fail("Timed out waiting for HTTP readiness"), readyTimeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  t.after(() => stopHttpProcess(child));
  return {
    child,
    origin: `http://127.0.0.1:${ready.port}`,
    ready,
    stderr: () => stderr,
  };
}
