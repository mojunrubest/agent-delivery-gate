#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileName = "agent-loopback";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/run-agent-loopback.mjs [--workspace <path>] -- <command> [args...]");
  process.exit(2);
}

function parseArgs(args) {
  const separator = args.indexOf("--");
  if (separator === -1 || separator === args.length - 1) usage("A command is required after --.");
  const options = args.slice(0, separator);
  const command = args.slice(separator + 1);
  let workspace = process.cwd();

  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--workspace" || !options[index + 1]) usage(`Unknown or incomplete option: ${options[index]}`);
    workspace = options[index + 1];
    index += 1;
  }
  return { command, workspace: resolve(workspace) };
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveRun({ code, signal }));
  });
}

const { command, workspace } = parseArgs(process.argv.slice(2));
const codexHome = await mkdtemp(resolve(tmpdir(), "delivery-gate-codex-home-"));

try {
  const profile = await readFile(resolve(projectRoot, "profiles/agent-loopback.config.toml"), "utf8");
  await writeFile(resolve(codexHome, `${profileName}.config.toml`), profile, { mode: 0o600 });
  const result = await run("codex", [
    "sandbox",
    "--profile", profileName,
    "--permission-profile", profileName,
    "--cd", workspace,
    ...command,
  ], { cwd: workspace, env: { ...process.env, CODEX_HOME: codexHome } });

  if (result.signal) {
    console.error(`Sandboxed command terminated by ${result.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.code ?? 1;
  }
} finally {
  await rm(codexHome, { recursive: true, force: true });
}
