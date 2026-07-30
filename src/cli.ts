#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyDelivery } from "./verifier.js";

function usage(): never {
  console.error("Usage: delivery-gate verify --config <path> [--workspace <path>] [--receipt <path>]");
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) usage();
  return args[index + 1];
}

const args = process.argv.slice(2);
if (args[0] !== "verify") usage();
const config = option(args, "--config");
if (!config) usage();

try {
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
} catch (error) {
  console.error(JSON.stringify({ status: "blocked", error: (error as Error).message }));
  process.exitCode = 2;
}
