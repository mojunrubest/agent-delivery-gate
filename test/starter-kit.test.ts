import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPolicy } from "../src/policy.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const kitRoot = resolve(projectRoot, "starter-kits/api-contract");

test("API starter policy is protected-test ready and fail closed", async () => {
  const { policy } = await loadPolicy(resolve(kitRoot, "contracts/api-v1.json"));
  assert.equal(policy.result.adapter, "tap");
  assert.equal(policy.result.source, "stdout");
  assert.equal(policy.requireCleanTree, true);
  assert.equal(policy.requireTests, true);
  assert.equal(policy.requirePassingTest, true);
  assert.equal(policy.allowFlaky, false);
  assert(policy.command.some((part) => part.includes("{policyDir}")));

  const placeholder = spawnSync(process.execPath, [
    "--test",
    "--test-reporter=tap",
    resolve(kitRoot, "tests/contract.test.mjs"),
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
  });
  assert.notEqual(placeholder.status, 0);
  assert.match(placeholder.stdout, /contract_not_customized/);
});

test("HTTP starter helper exercises a real loopback JSON request", async (t) => {
  const helpers = await import(pathToFileURL(resolve(kitRoot, "tests/http-helpers.mjs")).href) as {
    assertJsonResult(actual: unknown, expected: unknown): void;
    listenOnLoopback(context: typeof t, server: http.Server): Promise<{ origin: string }>;
    requestJson(origin: string, path: string): Promise<unknown>;
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  const { origin } = await helpers.listenOnLoopback(t, server);
  const result = await helpers.requestJson(origin, "/health");
  helpers.assertJsonResult(result, { status: 200, body: { ok: true } });
});

test("process HTTP helper starts and stops a cross-runtime style server", async (t) => {
  const helpers = await import(pathToFileURL(resolve(kitRoot, "tests/process-http-helpers.mjs")).href) as {
    startHttpProcess(context: typeof t, options: { command: string[] }): Promise<{
      child: import("node:child_process").ChildProcess;
      origin: string;
      ready: { port: number };
      stdoutAfterReady(): string;
    }>;
    tcpListenerBindings(child: import("node:child_process").ChildProcess, port: number): string[];
  };
  const script = [
    'const http = require("node:http")',
    'const server = http.createServer((_request, response) => response.end("process-ok"))',
    'server.listen(0, "127.0.0.1", () => { console.log(JSON.stringify({ host: "127.0.0.1", port: server.address().port })); console.log("after-ready") })',
    'process.on("SIGTERM", () => server.close(() => process.exit(0)))',
  ].join(";");
  const running = await helpers.startHttpProcess(t, { command: [process.execPath, "-e", script] });
  const { origin } = running;
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "process-ok");
  assert.match(running.stdoutAfterReady(), /after-ready/);
  assert.deepEqual(helpers.tcpListenerBindings(running.child, running.ready.port), [
    `127.0.0.1:${running.ready.port}`,
  ]);
});

test("process HTTP helper cleans up a child that fails readiness validation", async (t) => {
  const helpers = await import(pathToFileURL(resolve(kitRoot, "tests/process-http-helpers.mjs")).href) as {
    startHttpProcess(context: typeof t, options: { command: string[] }): Promise<unknown>;
  };
  const root = await mkdtemp(resolve(tmpdir(), "invalid-readiness-cleanup-"));
  const marker = resolve(root, "terminated.txt");
  const script = [
    'const fs = require("node:fs")',
    'process.on("SIGTERM", () => { fs.writeFileSync(process.argv[1], "terminated"); process.exit(0) })',
    'console.log(JSON.stringify({ host: "0.0.0.0", port: 12345 }))',
    'setInterval(() => {}, 1000)',
  ].join(";");
  await assert.rejects(
    helpers.startHttpProcess(t, { command: [process.execPath, "-e", script, marker] }),
    /readiness host must be loopback/,
  );
  assert.equal(await readFile(marker, "utf8"), "terminated");
});

test("starter kit stays business-neutral", async () => {
  const paths = [
    "README.md",
    "task-packet.md",
    "contracts/api-v1.json",
    "tests/http-helpers.mjs",
    "tests/process-http-helpers.mjs",
    "tests/contract.test.mjs",
    "calibration/CHECKLIST.md",
  ];
  const contents = await Promise.all(paths.map((path) => readFile(resolve(kitRoot, path), "utf8")));
  assert.doesNotMatch(contents.join("\n"), /webhook|invoice|incident desk/i);
});
