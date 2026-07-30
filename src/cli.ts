#!/usr/bin/env node
import { resolve } from "node:path";
import { writeConsumerWorkflow } from "./scaffold.js";
import { verifyDelivery } from "./verifier.js";

function usage(): never {
  console.error(`Usage:
  delivery-gate verify --config <path> [--workspace <path>] [--receipt <path>]
  delivery-gate init --control-repository <owner/repo> --control-ref <40-char-sha> --policy-path <path> [--node-version <version>] [--browser] [--attest] [--output <path>] [--force]`);
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) usage();
  return args[index + 1];
}

const args = process.argv.slice(2);

try {
  if (args[0] === "verify") {
    const config = option(args, "--config");
    if (!config) usage();
    const result = await verifyDelivery({
      configPath: resolve(config),
      receiptPath: option(args, "--receipt"),
      workspace: option(args, "--workspace"),
    });
    console.log(JSON.stringify({
      status: result.receipt.status,
      receipt: result.receiptPath,
      failures: result.receipt.failures,
    }));
    process.exitCode = result.receipt.status === "verified" ? 0 : result.receipt.status === "unverified" ? 1 : 2;
  } else if (args[0] === "init") {
    const controlRepository = option(args, "--control-repository");
    const controlRef = option(args, "--control-ref");
    const policyPath = option(args, "--policy-path");
    if (!controlRepository || !controlRef || !policyPath) usage();
    const output = await writeConsumerWorkflow(option(args, "--output") ?? ".github/workflows/agent-delivery-gate.yml", {
      controlRepository,
      controlRef,
      policyPath,
      nodeVersion: option(args, "--node-version"),
      installChromium: args.includes("--browser"),
      attest: args.includes("--attest"),
    }, args.includes("--force"));
    console.log(JSON.stringify({ status: "created", workflow: output }));
  } else {
    usage();
  }
} catch (error) {
  console.error(JSON.stringify({ status: "blocked", error: (error as Error).message }));
  process.exitCode = 2;
}
