import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("Python API mutation catalog is broad, unique, and wired to the fixture", async () => {
  const catalog = JSON.parse(await readFile(resolve(projectRoot, "python-api-pilot/mutations.json"), "utf8")) as Array<{
    id: string;
    category: string;
    defect: string;
  }>;
  const fixture = await readFile(resolve(projectRoot, "python-api-pilot/mutation-fixture/src/blob_server.py"), "utf8");
  const ids = catalog.map((mutation) => mutation.id);
  assert(catalog.length >= 50);
  assert.equal(new Set(ids).size, ids.length);
  assert(new Set(catalog.map((mutation) => mutation.category)).size >= 8);
  for (const mutation of catalog) {
    assert.match(mutation.id, /^[a-z][a-z0-9_]+$/);
    assert(mutation.defect.length >= 12);
    assert.match(fixture, new RegExp(`active\\(\"${mutation.id}\"\\)`), `mutation is not wired: ${mutation.id}`);
  }
});
