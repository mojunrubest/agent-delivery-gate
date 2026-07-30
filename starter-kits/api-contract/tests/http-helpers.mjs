import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

export async function listenOnLoopback(t, server) {
  assert.equal(typeof server?.listen, "function", "candidate factory must return an http.Server");
  t.after(() => closeServer(server));
  await new Promise((resolveListen, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object", "server must expose its bound TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

export async function requestJson(origin, path, options = {}) {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body !== undefined && options.rawBody !== true) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(new URL(path, origin), { ...options, headers, body });
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /^application\/json(?:;|$)/i, `expected JSON response for ${options.method ?? "GET"} ${path}`);
  return {
    body: await response.json(),
    headers: response.headers,
    status: response.status,
  };
}

export function assertJsonResult(actual, expected) {
  assert.equal(actual.status, expected.status);
  assert.deepEqual(actual.body, expected.body);
}

export async function temporaryStorage(prefix = "api-contract-") {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  return { root, path: (...segments) => resolve(root, ...segments) };
}
