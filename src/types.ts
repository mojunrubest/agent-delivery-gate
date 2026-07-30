export type DeliveryStatus = "verified" | "unverified" | "blocked";
export type ResultAdapter = "tap" | "junit" | "playwright-json";
export type ResultSource = "stdout" | "file";

export interface ArtifactRule {
  path: string;
  required?: boolean;
}

export interface GatePolicy {
  schemaVersion: "1";
  policyId: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  result: {
    adapter: ResultAdapter;
    source: ResultSource;
  };
  requireCleanTree?: boolean;
  requireTests?: boolean;
  requirePassingTest?: boolean;
  allowFlaky?: boolean;
  artifacts?: ArtifactRule[];
}

export interface TestCounts {
  collected: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface FileEvidence {
  path: string;
  sha256: string;
  bytes: number;
}

export interface DeliveryReceipt {
  schema_version: "1.0";
  run_id: string;
  status: DeliveryStatus;
  policy: {
    id: string;
    path: string;
    sha256: string;
  };
  repository: {
    root: string | null;
    head: string | null;
    tree_digest_before: string | null;
    tree_digest_after: string | null;
    dirty_before: string[];
    dirty_after: string[];
  };
  execution: {
    command: string[];
    command_sha256: string;
    cwd: string;
    started_at: string;
    ended_at: string;
    duration_ms: number;
    exit_code: number | null;
    signal: string | null;
    timed_out: boolean;
    launch_error: string | null;
    stdout: FileEvidence;
    stderr: FileEvidence;
    report: FileEvidence | null;
  };
  tests: TestCounts | null;
  artifacts: FileEvidence[];
  failures: string[];
}

export interface VerificationResult {
  receipt: DeliveryReceipt;
  receiptPath: string;
}
