import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertJsonResult,
  closeServer,
  listenOnLoopback,
  requestJson,
  temporaryStorage,
} from "../../starter-kits/api-contract/tests/http-helpers.mjs";

const candidateUrl = pathToFileURL(resolve(process.cwd(), "src/server.mjs")).href;
const candidate = await import(`${candidateUrl}?run=${encodeURIComponent(process.env.DELIVERY_GATE_RUN_ID ?? "local")}`);
assert.equal(typeof candidate.createDocumentServer, "function", "src/server.mjs must export createDocumentServer");

async function start(t, options = {}) {
  const storage = options.storagePath ? null : await temporaryStorage("versioned-documents-contract-");
  const storagePath = options.storagePath ?? storage.path("state/documents.json");
  const server = await candidate.createDocumentServer({ ...options, storagePath });
  const listening = await listenOnLoopback(t, server);
  return { ...listening, storagePath };
}

function put(origin, id, content, headers = { "if-none-match": "*" }) {
  return requestJson(origin, `/documents/${id}`, {
    method: "PUT",
    headers,
    body: { content },
  });
}

function expected(id, revision, content) {
  return { document: { id, revision, content } };
}

test("creates, retrieves, and conditionally updates a versioned document", async (t) => {
  const { origin } = await start(t);
  const first = await put(origin, "guide_1", { title: "Draft", tags: ["api"] });
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("etag"), '"1"');
  assert.deepEqual(first.body, expected("guide_1", 1, { title: "Draft", tags: ["api"] }));

  const retrieved = await requestJson(origin, "/documents/guide_1");
  assert.equal(retrieved.headers.get("etag"), '"1"');
  assertJsonResult(retrieved, { status: 200, body: first.body });

  const updated = await put(origin, "guide_1", { title: "Published" }, { "if-match": '"1"' });
  assert.equal(updated.status, 200);
  assert.equal(updated.headers.get("etag"), '"2"');
  assert.deepEqual(updated.body, expected("guide_1", 2, { title: "Published" }));
});

test("enforces create and update preconditions without changing the winner", async (t) => {
  const { origin } = await start(t);
  assertJsonResult(await put(origin, "policy", { value: 1 }, {}), {
    status: 428,
    body: { error: "precondition_required" },
  });
  assertJsonResult(await put(origin, "policy", { value: 1 }, { "if-match": '"1"' }), {
    status: 412,
    body: { error: "precondition_failed" },
  });
  assert.equal((await put(origin, "policy", { value: 1 })).status, 201);
  assertJsonResult(await put(origin, "policy", { value: 2 }, { "if-none-match": "*" }), {
    status: 412,
    body: { error: "precondition_failed" },
  });
  assertJsonResult(await put(origin, "policy", { value: 2 }, {}), {
    status: 428,
    body: { error: "precondition_required" },
  });
  assertJsonResult(await put(origin, "policy", { value: 2 }, {
    "if-match": '"1"',
    "if-none-match": "*",
  }), { status: 400, body: { error: "invalid_precondition" } });
  assertJsonResult(await put(origin, "policy", { value: 2 }, { "if-match": 'W/"1"' }), {
    status: 412,
    body: { error: "precondition_failed" },
  });

  const current = await requestJson(origin, "/documents/policy");
  assert.equal(current.headers.get("etag"), '"1"');
  assert.deepEqual(current.body, expected("policy", 1, { value: 1 }));
});

test("returns an empty 304 only for the current entity tag", async (t) => {
  const { origin } = await start(t);
  await put(origin, "cache-key", { cacheable: true });

  const fresh = await fetch(`${origin}/documents/cache-key`, { headers: { "if-none-match": '"1"' } });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.headers.get("etag"), '"1"');
  assert.equal(await fresh.text(), "");

  const stale = await requestJson(origin, "/documents/cache-key", { headers: { "if-none-match": '"0"' } });
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("etag"), '"1"');
});

test("serializes concurrent updates against one entity tag", async (t) => {
  const { origin } = await start(t);
  await put(origin, "race", { winner: null });
  const attempts = await Promise.all([
    put(origin, "race", { winner: "a" }, { "if-match": '"1"' }),
    put(origin, "race", { winner: "b" }, { "if-match": '"1"' }),
  ]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 412]);
  const winner = attempts.find(({ status }) => status === 200).body.document;
  const current = await requestJson(origin, "/documents/race");
  assert.equal(current.headers.get("etag"), '"2"');
  assert.deepEqual(current.body.document, winner);
});

test("rejects media type, malformed, invalid, and oversized requests separately", async (t) => {
  const { origin } = await start(t, { maxBodyBytes: 256 });
  assertJsonResult(await requestJson(origin, "/documents/plain", {
    method: "PUT",
    headers: { "if-none-match": "*" },
    rawBody: true,
    body: "plain text",
  }), { status: 415, body: { error: "unsupported_media_type" } });
  assertJsonResult(await requestJson(origin, "/documents/broken", {
    method: "PUT",
    headers: { "content-type": "application/json", "if-none-match": "*" },
    rawBody: true,
    body: "{",
  }), { status: 400, body: { error: "invalid_json" } });

  for (const body of [null, [], {}, { content: null }, { content: [] }, { content: {}, extra: true }]) {
    assertJsonResult(await requestJson(origin, "/documents/invalid", {
      method: "PUT",
      headers: { "if-none-match": "*" },
      body,
    }), { status: 422, body: { error: "invalid_document" } });
  }
  for (const id of ["bad%20id", "bad%2Fid", `${"x".repeat(65)}`]) {
    assertJsonResult(await put(origin, id, { valid: true }), { status: 400, body: { error: "invalid_id" } });
  }
  assertJsonResult(await put(origin, "too-large", { data: "x".repeat(500) }), {
    status: 413,
    body: { error: "body_too_large" },
  });
  assertJsonResult(await requestJson(origin, "/documents/invalid"), {
    status: 404,
    body: { error: "not_found" },
  });
});

test("deletes only the current revision and leaves no response body", async (t) => {
  const { origin } = await start(t);
  await put(origin, "retired", { active: true });

  assertJsonResult(await requestJson(origin, "/documents/retired", { method: "DELETE" }), {
    status: 428,
    body: { error: "precondition_required" },
  });
  assertJsonResult(await requestJson(origin, "/documents/retired", {
    method: "DELETE",
    headers: { "if-match": '"0"' },
  }), { status: 412, body: { error: "precondition_failed" } });

  const removed = await fetch(`${origin}/documents/retired`, {
    method: "DELETE",
    headers: { "if-match": '"1"' },
  });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");
  assertJsonResult(await requestJson(origin, "/documents/retired"), {
    status: 404,
    body: { error: "not_found" },
  });
  assertJsonResult(await requestJson(origin, "/documents/retired", {
    method: "DELETE",
    headers: { "if-match": '"1"' },
  }), { status: 404, body: { error: "not_found" } });
});

test("restores revisions across server instances", async (t) => {
  const storage = await temporaryStorage("versioned-documents-restart-");
  const storagePath = storage.path("nested/documents.json");
  const first = await start(t, { storagePath });
  await put(first.origin, "durable", { version: 1 });
  await put(first.origin, "durable", { version: 2 }, { "if-match": '"1"' });
  await closeServer(first.server);

  const second = await start(t, { storagePath });
  const restored = await requestJson(second.origin, "/documents/durable");
  assert.equal(restored.headers.get("etag"), '"2"');
  assert.deepEqual(restored.body, expected("durable", 2, { version: 2 }));
  const third = await put(second.origin, "durable", { version: 3 }, { "if-match": '"2"' });
  assert.equal(third.headers.get("etag"), '"3"');
});

test("fails closed on invalid storage and returns stable route errors", async (t) => {
  const storage = await temporaryStorage("versioned-documents-invalid-");
  const storagePath = storage.path("documents.json");
  for (const contents of ["not json", JSON.stringify({ documents: [{ id: "bad id", revision: 0, content: null }] })]) {
    await writeFile(storagePath, contents);
    await assert.rejects(
      candidate.createDocumentServer({ storagePath }),
      (error) => error?.code === "ERR_INVALID_STORAGE",
    );
    assert.equal(await readFile(storagePath, "utf8"), contents);
  }

  const { origin } = await start(t, { storagePath: storage.path("fresh.json") });
  for (const [path, options] of [["/missing", {}], ["/documents", {}], ["/documents/id/extra", {}], ["/documents/id", { method: "POST" }]]) {
    assertJsonResult(await requestJson(origin, path, options), { status: 404, body: { error: "not_found" } });
  }
});
