import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertJsonResult,
  requestJson,
  temporaryStorage,
} from "../../starter-kits/api-contract/tests/http-helpers.mjs";
import {
  startHttpProcess,
  stopHttpProcess,
  tcpListenerBindings,
} from "../../starter-kits/api-contract/tests/process-http-helpers.mjs";

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function start(t, options = {}) {
  const storage = options.storageDir ? null : await temporaryStorage("content-blob-adversarial-");
  const storageDir = options.storageDir ?? storage.path("store");
  const command = ["python3", "src/blob_server.py", "--storage-dir", storageDir];
  if (!options.omitPort) command.push("--port", "0");
  if (options.maxBodyBytes !== undefined) command.push("--max-body-bytes", String(options.maxBodyBytes));
  const running = await startHttpProcess(t, { command, cwd: process.cwd(), readyTimeoutMs: 3_000 });
  return { ...running, storageDir };
}

async function put(origin, body, pathDigest = digest(body), headers = {}) {
  return requestJson(origin, `/blobs/${pathDigest}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...headers },
    rawBody: true,
    body,
  });
}

function rejectedCli(args) {
  return spawnSync("python3", ["src/blob_server.py", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 1_000,
  });
}

async function rawRequest(port, request, timeoutMs = 1_000, stopAtHeaders = false) {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectResponse(new Error("raw HTTP response timed out"));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      const response = Buffer.concat(chunks);
      socket.destroy();
      resolveResponse(response);
    };
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      if (stopAtHeaders && Buffer.concat(chunks).includes(Buffer.from("\r\n\r\n"))) finish();
    });
    socket.on("end", finish);
    socket.on("error", (error) => {
      clearTimeout(timeout);
      rejectResponse(error);
    });
  });
}

test("enforces CLI defaults and rejects missing or negative arguments", async (t) => {
  const running = await start(t, { omitPort: true });
  assertJsonResult(await requestJson(running.origin, "/blobs"), { status: 200, body: { blobs: [] } });

  const missingStorage = rejectedCli(["--port", "0"]);
  assert.notEqual(missingStorage.status, null, "missing --storage-dir must exit instead of starting");
  assert.notEqual(missingStorage.status, 0);

  const storage = await temporaryStorage("content-blob-negative-max-");
  const negativeMaximum = rejectedCli([
    "--storage-dir", storage.path("store"),
    "--port", "0",
    "--max-body-bytes", "-1",
  ]);
  assert.notEqual(negativeMaximum.status, null, "negative --max-body-bytes must exit instead of starting");
  assert.notEqual(negativeMaximum.status, 0);
});

test("binds only exact loopback, keeps stdout quiet, and exits cleanly on SIGTERM", async (t) => {
  const running = await start(t);
  assertJsonResult(await requestJson(running.origin, "/blobs"), { status: 200, body: { blobs: [] } });
  await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  assert.equal(running.stdoutAfterReady(), "");
  assert.deepEqual(tcpListenerBindings(running.child, running.ready.port), [
    `127.0.0.1:${running.ready.port}`,
  ]);

  const stopped = await stopHttpProcess(running.child, 500);
  assert.equal(stopped.graceful, true);
  assert.equal(stopped.exitCode, 0);
  assert.equal(stopped.signalCode, null);
});

test("rejects every invalid durable entry without modifying storage", async () => {
  const cases = [
    {
      name: "invalid name",
      setup: async (blobDir) => {
        const marker = resolve(blobDir, "not-a-digest");
        await writeFile(marker, "invalid name contents");
        return async () => assert.equal(await readFile(marker, "utf8"), "invalid name contents");
      },
    },
    {
      name: "non-regular directory",
      setup: async (blobDir) => {
        const marker = resolve(blobDir, "b".repeat(64));
        await mkdir(marker);
        return async () => assert.equal((await lstat(marker)).isDirectory(), true);
      },
    },
    {
      name: "symbolic link",
      setup: async (blobDir, root) => {
        const target = resolve(root, "target");
        await writeFile(target, "target contents");
        const marker = resolve(blobDir, "c".repeat(64));
        await symlink(target, marker);
        return async () => {
          assert.equal((await lstat(marker)).isSymbolicLink(), true);
          assert.equal(await readFile(target, "utf8"), "target contents");
        };
      },
    },
    {
      name: "hash mismatch",
      setup: async (blobDir) => {
        const marker = resolve(blobDir, "d".repeat(64));
        await writeFile(marker, "contents do not match digest");
        return async () => assert.equal(await readFile(marker, "utf8"), "contents do not match digest");
      },
    },
  ];

  for (const scenario of cases) {
    const storage = await temporaryStorage("content-blob-invalid-matrix-");
    const blobDir = storage.path("store/blobs");
    await mkdir(blobDir, { recursive: true });
    const assertUnchanged = await scenario.setup(blobDir, storage.root);
    const result = rejectedCli(["--storage-dir", storage.path("store"), "--port", "0"]);
    assert.equal(result.status, 2, scenario.name);
    assert.equal(result.stdout, "", scenario.name);
    assert.deepEqual(JSON.parse(result.stderr.trim()), { error: "invalid_storage" }, scenario.name);
    await assertUnchanged();
  }
});

test("rejects uppercase digests and enforces an exact zero body limit", async (t) => {
  const regular = await start(t);
  assertJsonResult(await put(regular.origin, Buffer.from("uppercase"), "A".repeat(64)), {
    status: 400,
    body: { error: "invalid_digest" },
  });

  const zero = await start(t, { maxBodyBytes: 0 });
  assert.equal((await put(zero.origin, Buffer.alloc(0))).status, 201);
  assertJsonResult(await put(zero.origin, Buffer.from("x")), {
    status: 413,
    body: { error: "body_too_large" },
  });
});

test("rejects an oversized Content-Length before waiting for request bytes", async (t) => {
  const running = await start(t, { maxBodyBytes: 8 });
  const response = await rawRequest(
    running.ready.port,
    [
      `PUT /blobs/${"a".repeat(64)} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Content-Type: application/octet-stream",
      "Content-Length: 1048576",
      "Connection: close",
      "",
      "",
    ].join("\r\n"),
    750,
    true,
  );
  assert.match(response.toString("latin1"), /^HTTP\/1\.1 413 /);
});

test("writes no bytes after raw HEAD response headers", async (t) => {
  const running = await start(t);
  const body = Buffer.from("head must stay empty");
  const id = digest(body);
  await put(running.origin, body);
  const response = await rawRequest(
    running.ready.port,
    `HEAD /blobs/${id} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
  );
  const separator = response.indexOf("\r\n\r\n");
  assert(separator >= 0);
  assert.match(response.subarray(0, separator).toString("latin1"), /^HTTP\/1\.1 200 /);
  assert.equal(response.subarray(separator + 4).length, 0);
});

test("returns stable 404 for every unsupported path and method", async (t) => {
  const running = await start(t);
  const body = Buffer.from("route boundaries");
  const id = digest(body);
  await put(running.origin, body);

  const trailingSlash = await requestJson(running.origin, "/blobs/");
  assert([400, 404].includes(trailingSlash.status));
  assert.deepEqual(
    trailingSlash.body,
    { error: trailingSlash.status === 400 ? "invalid_digest" : "not_found" },
  );
  for (const [path, method] of [
    ["/blobs/extra/path", "PUT"],
    [`/blobs/${id}`, "POST"],
    [`/blobs/${id}`, "DELETE"],
    ["/blobs", "PUT"],
  ]) {
    assertJsonResult(await requestJson(running.origin, path, {
      method,
      headers: { "content-type": "application/octet-stream" },
      rawBody: true,
      body,
    }), { status: 404, body: { error: "not_found" } });
  }
  const collectionHead = await fetch(`${running.origin}/blobs`, { method: "HEAD" });
  assert.equal(collectionHead.status, 404);
  assert.equal(await collectionHead.text(), "");
  const preserved = await fetch(`${running.origin}/blobs/${id}`);
  assert.deepEqual(Buffer.from(await preserved.arrayBuffer()), body);
});
