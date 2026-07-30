import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("loopback profile keeps the intended least-privilege shape", async () => {
  const profile = await readFile(resolve(projectRoot, "profiles/agent-loopback.config.toml"), "utf8");
  assert.match(profile, /default_permissions = "agent-loopback"/);
  assert.match(profile, /extends = ":workspace"/);
  assert.match(profile, /network_proxy = true/);
  assert.match(profile, /allow_local_binding = true/);
  assert.match(profile, /allow_upstream_proxy = false/);
  assert.match(profile, /"127\.0\.0\.1" = "allow"/);
  assert.match(profile, /"localhost" = "allow"/);
  assert.doesNotMatch(profile, /^\s*"\*"\s*=\s*"allow"/m);
  assert.doesNotMatch(profile, /danger-full-access/);
});
