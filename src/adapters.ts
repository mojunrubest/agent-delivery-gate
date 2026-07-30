import { XMLParser } from "fast-xml-parser";
import type { TestCounts } from "./types.js";

function emptyCounts(): TestCounts {
  return { collected: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) throw new Error(`invalid ${label} count`);
  return number;
}

export function parseTap(input: string): TestCounts {
  const summaries = new Map<string, number>();
  for (const line of input.split(/\r?\n/)) {
    const match = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)\s*$/.exec(line.trim());
    if (match) summaries.set(match[1], Number(match[2]));
  }
  if (summaries.has("tests")) {
    const collected = summaries.get("tests") ?? 0;
    const passed = summaries.get("pass") ?? 0;
    const failed = (summaries.get("fail") ?? 0) + (summaries.get("cancelled") ?? 0);
    const skipped = (summaries.get("skipped") ?? 0) + (summaries.get("todo") ?? 0);
    if (passed + failed + skipped < collected) throw new Error("incomplete TAP summary");
    return { collected, passed, failed, skipped, flaky: 0 };
  }

  let plan: number | null = null;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    const planMatch = /^1\.\.(\d+)(?:\s*#.*)?$/.exec(trimmed);
    if (planMatch) plan = Number(planMatch[1]);
    const assertion = /^(not )?ok\s+\d+(?:\s+-.*)?(?:\s+#\s*(SKIP|TODO).*)?$/i.exec(trimmed);
    if (!assertion) continue;
    if (assertion[2]) skipped += 1;
    else if (assertion[1]) failed += 1;
    else passed += 1;
  }
  if (plan === null) throw new Error("TAP plan or Node test summary missing");
  if (passed + failed + skipped !== plan) throw new Error("TAP assertion count does not match plan");
  return { collected: plan, passed, failed, skipped, flaky: 0 };
}

export function parseJunit(input: string): TestCounts {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const document = parser.parse(input) as Record<string, unknown>;
  const root = (document.testsuites ?? document.testsuite) as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") throw new Error("JUnit testsuite root missing");
  const collected = nonNegativeInteger(root["@_tests"], "tests");
  const failed = nonNegativeInteger(root["@_failures"], "failures") + nonNegativeInteger(root["@_errors"], "errors");
  const skipped = nonNegativeInteger(root["@_skipped"], "skipped") + nonNegativeInteger(root["@_disabled"], "disabled");
  if (failed + skipped > collected) throw new Error("JUnit counts are inconsistent");
  return { collected, passed: collected - failed - skipped, failed, skipped, flaky: 0 };
}

function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object");
}

export function parsePlaywrightJson(input: string): TestCounts {
  const report = JSON.parse(input) as Record<string, unknown>;
  const counts = emptyCounts();
  const visitSuite = (suite: Record<string, unknown>): void => {
    for (const spec of array(suite.specs)) {
      for (const test of array(spec.tests)) {
        counts.collected += 1;
        switch (test.status) {
          case "expected": counts.passed += 1; break;
          case "skipped": counts.skipped += 1; break;
          case "flaky": counts.flaky += 1; counts.passed += 1; break;
          default: counts.failed += 1;
        }
      }
    }
    for (const child of array(suite.suites)) visitSuite(child);
  };
  for (const suite of array(report.suites)) visitSuite(suite);
  return counts;
}

export function parseResult(adapter: "tap" | "junit" | "playwright-json", input: string): TestCounts {
  if (adapter === "tap") return parseTap(input);
  if (adapter === "junit") return parseJunit(input);
  return parsePlaywrightJson(input);
}
