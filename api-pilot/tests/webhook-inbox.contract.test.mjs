import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const candidateUrl = pathToFileURL(resolve(process.cwd(), "src/server.mjs")).href;
const candidate = await import(`${candidateUrl}?run=${encodeURIComponent(process.env.DELIVERY_GATE_RUN_ID ?? "local")}`);
assert.equal(typeof candidate.createWebhookServer, "function", "src/server.mjs must export createWebhookServer");

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function start(t, options = {}) {
  const { root: suppliedRoot, storagePath: suppliedStoragePath, ...serverOptions } = options;
  const root = suppliedRoot ?? await mkdtemp(resolve(tmpdir(), "webhook-inbox-contract-"));
  const storagePath = suppliedStoragePath ?? resolve(root, "state/events.json");
  const server = await candidate.createWebhookServer({ ...serverOptions, storagePath });
  assert.equal(typeof server?.listen, "function", "createWebhookServer must resolve to an http.Server");
  t.after(() => close(server));
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, root, server, storagePath };
}

async function request(origin, path, options = {}) {
  const headers = { ...options.headers };
  let body = options.body;
  if (body !== undefined && options.raw !== true) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(`${origin}${path}`, { ...options, headers, body });
  assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/i);
  return { status: response.status, body: await response.json() };
}

function event(id, type = "invoice.paid", payload = { invoiceId: id }) {
  return { id, type, payload };
}

test("creates, retrieves, and lists events in acceptance order", async (t) => {
  const timestamps = ["2026-07-30T10:01:00.000Z", "2026-07-30T10:02:00.000Z"];
  const { origin } = await start(t, { now: () => timestamps.shift() });

  for (const [index, input] of [event("evt-1"), event("evt-2", "refund.created")].entries()) {
    const result = await request(origin, "/events", { method: "POST", body: input });
    assert.equal(result.status, 201);
    assert.equal(result.body.created, true);
    assert.deepEqual(result.body.event, { ...input, receivedAt: `2026-07-30T10:0${index + 1}:00.000Z` });
  }

  assert.deepEqual(await request(origin, "/events/evt-1"), {
    status: 200,
    body: { event: { ...event("evt-1"), receivedAt: "2026-07-30T10:01:00.000Z" } },
  });
  const listed = await request(origin, "/events");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.events.map(({ id }) => id), ["evt-1", "evt-2"]);
  assert.equal(listed.body.nextCursor, null);
});

test("treats semantically equal duplicates as idempotent and preserves the original", async (t) => {
  let nowCalls = 0;
  const { origin } = await start(t, { now: () => `time-${++nowCalls}` });
  const original = event("evt-semantic", "invoice.paid", { invoice: { id: "in-9", amount: 700 }, tags: ["a", "b"] });
  const reordered = event("evt-semantic", "invoice.paid", { tags: ["a", "b"], invoice: { amount: 700, id: "in-9" } });

  assert.equal((await request(origin, "/events", { method: "POST", body: original })).status, 201);
  const duplicate = await request(origin, "/events", { method: "POST", body: reordered });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);
  assert.equal(duplicate.body.event.receivedAt, "time-1");
  assert.deepEqual(duplicate.body.event.payload, original.payload);
  assert.equal(nowCalls, 1);
  assert.equal((await request(origin, "/events")).body.events.length, 1);
});

test("rejects conflicting duplicates without overwriting the winner", async (t) => {
  let nowCalls = 0;
  const { origin } = await start(t, { now: () => `time-${++nowCalls}` });
  const original = event("evt-conflict", "invoice.paid", { value: 1 });
  assert.equal((await request(origin, "/events", { method: "POST", body: original })).status, 201);

  for (const conflicting of [
    event("evt-conflict", "invoice.failed", { value: 1 }),
    event("evt-conflict", "invoice.paid", { value: 2 }),
  ]) {
    assert.deepEqual(await request(origin, "/events", { method: "POST", body: conflicting }), {
      status: 409,
      body: { error: "id_conflict" },
    });
  }

  assert.deepEqual((await request(origin, "/events/evt-conflict")).body.event.payload, { value: 1 });
  assert.equal(nowCalls, 1);
  assert.equal((await request(origin, "/events")).body.events.length, 1);
});

test("serializes concurrent duplicate and conflicting submissions", async (t) => {
  let nowCalls = 0;
  const { origin } = await start(t, { now: () => `time-${++nowCalls}` });
  const duplicate = event("evt-race", "shipment.sent", { tracking: "trk-1" });
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    request(origin, "/events", { method: "POST", body: structuredClone(duplicate) })
  ));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
  assert.equal(nowCalls, 1);
  assert.equal((await request(origin, "/events")).body.events.length, 1);

  const races = await Promise.all([
    request(origin, "/events", { method: "POST", body: event("evt-winner", "alpha", { side: "a" }) }),
    request(origin, "/events", { method: "POST", body: event("evt-winner", "beta", { side: "b" }) }),
  ]);
  assert.deepEqual(races.map(({ status }) => status).sort(), [201, 409]);
  const winner = (await request(origin, "/events/evt-winner")).body.event;
  assert(races.some(({ body }) => body.event?.type === winner.type));
});

test("rejects malformed, invalid, and oversized bodies without partial acceptance", async (t) => {
  const { origin } = await start(t, { maxBodyBytes: 512 });
  assert.deepEqual(await request(origin, "/events", { method: "POST", raw: true, body: "{" }), {
    status: 400,
    body: { error: "invalid_json" },
  });

  const invalid = [
    null,
    [],
    {},
    event("", "valid"),
    event("x".repeat(101), "valid"),
    event("valid", ""),
    event("valid", "x".repeat(101)),
    event("valid", "type", null),
    event("valid", "type", []),
  ];
  for (const body of invalid) {
    assert.deepEqual(await request(origin, "/events", { method: "POST", body }), {
      status: 422,
      body: { error: "invalid_event" },
    });
  }

  assert.deepEqual(await request(origin, "/events", {
    method: "POST",
    body: event("evt-large", "large", { data: "x".repeat(1_000) }),
  }), { status: 413, body: { error: "body_too_large" } });
  assert.equal((await request(origin, "/events")).body.events.length, 0);
});

test("filters and paginates after a global acceptance cursor", async (t) => {
  const { origin } = await start(t, { now: () => "time" });
  const inputs = [
    event("evt-1", "alpha"),
    event("evt-2", "beta"),
    event("evt-3", "alpha"),
    event("evt-4", "alpha"),
    event("evt-5", "beta"),
  ];
  for (const input of inputs) assert.equal((await request(origin, "/events", { method: "POST", body: input })).status, 201);

  assert.deepEqual(await request(origin, "/events?limit=2"), {
    status: 200,
    body: { events: inputs.slice(0, 2).map((input) => ({ ...input, receivedAt: "time" })), nextCursor: "evt-2" },
  });
  const alpha = await request(origin, "/events?after=evt-2&type=alpha&limit=1");
  assert.deepEqual(alpha.body.events.map(({ id }) => id), ["evt-3"]);
  assert.equal(alpha.body.nextCursor, "evt-3");
  const finalAlpha = await request(origin, "/events?after=evt-3&type=alpha&limit=2");
  assert.deepEqual(finalAlpha.body.events.map(({ id }) => id), ["evt-4"]);
  assert.equal(finalAlpha.body.nextCursor, null);

  for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=nope", "after=missing"]) {
    assert.deepEqual(await request(origin, `/events?${query}`), { status: 400, body: { error: "invalid_query" } });
  }
});

test("restores durable state across server instances", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "webhook-inbox-restart-"));
  const storagePath = resolve(root, "nested/events.json");
  const first = await start(t, { root, storagePath, now: () => "original-time" });
  const input = event("evt-durable", "customer.updated", { customer: "cus-1" });
  assert.equal((await request(first.origin, "/events", { method: "POST", body: input })).status, 201);
  await close(first.server);

  let restartNowCalls = 0;
  const second = await start(t, { root, storagePath, now: () => `restart-${++restartNowCalls}` });
  assert.deepEqual((await request(second.origin, "/events/evt-durable")).body.event, {
    ...input,
    receivedAt: "original-time",
  });
  assert.equal((await request(second.origin, "/events", { method: "POST", body: input })).status, 200);
  assert.equal(restartNowCalls, 0);
  assert.equal((await request(second.origin, "/events", { method: "POST", body: event("evt-new") })).status, 201);
  assert.equal(restartNowCalls, 1);
});

test("fails closed on invalid durable storage", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "webhook-inbox-invalid-storage-"));
  const storagePath = resolve(root, "events.json");
  const invalidContents = ["not json", JSON.stringify({ definitely: "not an inbox" })];
  for (const contents of invalidContents) {
    await writeFile(storagePath, contents);
    await assert.rejects(
      candidate.createWebhookServer({ storagePath }),
      (error) => error?.code === "ERR_INVALID_STORAGE",
    );
    assert.equal(await readFile(storagePath, "utf8"), contents);
  }
});

test("returns JSON not-found errors for unsupported routes", async (t) => {
  const { origin } = await start(t);
  assert.deepEqual(await request(origin, "/missing"), { status: 404, body: { error: "not_found" } });
  assert.deepEqual(await request(origin, "/events", { method: "DELETE" }), { status: 404, body: { error: "not_found" } });
  assert.deepEqual(await request(origin, "/events/no-such-id"), { status: 404, body: { error: "not_found" } });
});
