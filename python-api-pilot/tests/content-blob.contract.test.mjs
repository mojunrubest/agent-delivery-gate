import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
} from "../../starter-kits/api-contract/tests/process-http-helpers.mjs";

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function start(t, options = {}) {
  const storage = options.storageDir ? null : await temporaryStorage("content-blob-contract-");
  const storageDir = options.storageDir ?? storage.path("store");
  const command = [
    "python3",
    "src/blob_server.py",
    "--storage-dir", storageDir,
    "--port", "0",
  ];
  if (options.maxBodyBytes !== undefined) command.push("--max-body-bytes", String(options.maxBodyBytes));
  const running = await startHttpProcess(t, { command, cwd: process.cwd(), readyTimeoutMs: 5_000 });
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

test("uploads, retrieves, heads, and lists content-addressed blobs", async (t) => {
  const { origin } = await start(t);
  const body = Buffer.from("cross-runtime acceptance\n", "utf8");
  const id = digest(body);
  const created = await put(origin, body);
  assertJsonResult(created, {
    status: 201,
    body: { created: true, blob: { digest: id, size: body.length } },
  });

  const retrieved = await fetch(`${origin}/blobs/${id}`);
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.headers.get("content-type"), "application/octet-stream");
  assert.equal(retrieved.headers.get("content-length"), String(body.length));
  assert.equal(retrieved.headers.get("etag"), `"${id}"`);
  assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), body);

  const head = await fetch(`${origin}/blobs/${id}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(body.length));
  assert.equal(await head.text(), "");

  assertJsonResult(await requestJson(origin, "/blobs"), {
    status: 200,
    body: { blobs: [{ digest: id, size: body.length }] },
  });
});

test("makes identical uploads idempotent and serializes concurrent creation", async (t) => {
  const { origin } = await start(t);
  const firstBody = Buffer.from("same bytes");
  const firstId = digest(firstBody);
  assert.equal((await put(origin, firstBody)).status, 201);
  assertJsonResult(await put(origin, firstBody), {
    status: 200,
    body: { created: false, blob: { digest: firstId, size: firstBody.length } },
  });

  const raceBody = Buffer.alloc(32_768, 7);
  const attempts = await Promise.all(Array.from({ length: 6 }, () => put(origin, raceBody)));
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal((await requestJson(origin, "/blobs")).body.blobs.length, 2);
});

test("rejects invalid IDs, media types, digest mismatches, and oversized bodies", async (t) => {
  const { origin } = await start(t, { maxBodyBytes: 128 });
  const body = Buffer.from("valid body");
  const id = digest(body);

  for (const invalid of ["ABC", "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    assertJsonResult(await put(origin, body, invalid), { status: 400, body: { error: "invalid_digest" } });
  }
  assertJsonResult(await requestJson(origin, `/blobs/${id}`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    rawBody: true,
    body,
  }), { status: 415, body: { error: "unsupported_media_type" } });
  assertJsonResult(await put(origin, Buffer.from("different"), id), {
    status: 422,
    body: { error: "digest_mismatch" },
  });
  assertJsonResult(await put(origin, Buffer.alloc(129, 1)), {
    status: 413,
    body: { error: "body_too_large" },
  });
  assert.equal((await requestJson(origin, "/blobs")).body.blobs.length, 0);
});

test("supports exact ETag revalidation", async (t) => {
  const { origin } = await start(t);
  const body = Buffer.from("cache me");
  const id = digest(body);
  await put(origin, body);

  const exact = await fetch(`${origin}/blobs/${id}`, { headers: { "if-none-match": `"${id}"` } });
  assert.equal(exact.status, 304);
  assert.equal(exact.headers.get("etag"), `"${id}"`);
  assert.equal(await exact.text(), "");

  const weak = await fetch(`${origin}/blobs/${id}`, { headers: { "if-none-match": `W/"${id}"` } });
  assert.equal(weak.status, 200);
  assert.deepEqual(Buffer.from(await weak.arrayBuffer()), body);
});

test("serves inclusive byte ranges and rejects invalid ranges", async (t) => {
  const { origin } = await start(t);
  const body = Buffer.from("0123456789");
  const id = digest(body);
  await put(origin, body);

  const ranged = await fetch(`${origin}/blobs/${id}`, { headers: { range: "bytes=2-5" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(ranged.headers.get("content-length"), "4");
  assert.equal(await ranged.text(), "2345");

  const rangedHead = await fetch(`${origin}/blobs/${id}`, { method: "HEAD", headers: { range: "bytes=0-0" } });
  assert.equal(rangedHead.status, 206);
  assert.equal(rangedHead.headers.get("content-range"), "bytes 0-0/10");
  assert.equal(rangedHead.headers.get("content-length"), "1");
  assert.equal(await rangedHead.text(), "");

  for (const range of ["bytes=5-2", "bytes=10-11", "bytes=-2", "bytes=2-", "items=0-1", "bytes=0-1,3-4"]) {
    const response = await requestJson(origin, `/blobs/${id}`, { headers: { range } });
    assertJsonResult(response, { status: 416, body: { error: "invalid_range" } });
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
});

test("restores files across process restarts and lists by digest", async (t) => {
  const storage = await temporaryStorage("content-blob-restart-");
  const storageDir = storage.path("store");
  const first = await start(t, { storageDir });
  const bodies = [Buffer.from("zeta"), Buffer.from("alpha"), Buffer.alloc(0)];
  for (const body of bodies) assert.equal((await put(first.origin, body)).status, 201);
  await stopHttpProcess(first.child);

  const second = await start(t, { storageDir });
  const listed = await requestJson(second.origin, "/blobs");
  const expected = bodies
    .map((body) => ({ digest: digest(body), size: body.length }))
    .sort((left, right) => left.digest.localeCompare(right.digest));
  assert.deepEqual(listed.body.blobs, expected);
  for (const body of bodies) {
    const response = await fetch(`${second.origin}/blobs/${digest(body)}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  }
});

test("fails startup closed when durable blobs are invalid", async () => {
  const storage = await temporaryStorage("content-blob-invalid-");
  const blobDir = storage.path("store/blobs");
  await mkdir(blobDir, { recursive: true });
  await writeFile(resolve(blobDir, "a".repeat(64)), "contents that do not match the name");
  const result = spawnSync("python3", [
    "src/blob_server.py",
    "--storage-dir", storage.path("store"),
    "--port", "0",
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr.trim()), { error: "invalid_storage" });
});

test("returns stable JSON errors for missing blobs and unsupported routes", async (t) => {
  const { origin } = await start(t);
  const missing = "f".repeat(64);
  for (const [path, options] of [
    [`/blobs/${missing}`, {}],
    ["/missing", {}],
    ["/blobs/extra/path", {}],
    [`/blobs/${missing}`, { method: "DELETE" }],
  ]) {
    assertJsonResult(await requestJson(origin, path, options), { status: 404, body: { error: "not_found" } });
  }
});
