import assert from "node:assert/strict";
import test from "node:test";
import { parseJunit, parsePlaywrightJson, parseTap } from "../src/adapters.js";

test("parses Node TAP summary as structured counts", () => {
  const counts = parseTap("TAP version 13\nok 1 - works\n1..1\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n");
  assert.deepEqual(counts, { collected: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 });
});

test("rejects incomplete TAP instead of inferring green", () => {
  assert.throws(() => parseTap("looks good\n"), /plan.*missing/i);
});

test("parses aggregate JUnit counts", () => {
  const counts = parseJunit('<testsuites tests="4" failures="1" errors="1" skipped="1"></testsuites>');
  assert.deepEqual(counts, { collected: 4, passed: 1, failed: 2, skipped: 1, flaky: 0 });
});

test("parses Playwright outcomes including flaky", () => {
  const report = { suites: [{ specs: [{ tests: [{ status: "expected" }, { status: "unexpected" }, { status: "skipped" }, { status: "flaky" }] }] }] };
  assert.deepEqual(parsePlaywrightJson(JSON.stringify(report)), { collected: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
});
