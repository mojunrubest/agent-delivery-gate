import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile } from "node:fs/promises";
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

test("starter kit stays business-neutral", async () => {
  const paths = [
    "README.md",
    "task-packet.md",
    "contracts/api-v1.json",
    "tests/http-helpers.mjs",
    "tests/contract.test.mjs",
    "calibration/CHECKLIST.md",
  ];
  const contents = await Promise.all(paths.map((path) => readFile(resolve(kitRoot, path), "utf8")));
  assert.doesNotMatch(contents.join("\n"), /webhook|invoice|incident desk/i);
});
