import { spawn } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { sha256 } from "./hash.js";

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolveResult) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resolveResult({ code: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(error.message) }));
    child.on("close", (code) => resolveResult({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

export interface GitSnapshot {
  root: string;
  head: string;
  digest: string;
  dirty: string[];
}

const ignoredEvidencePrefix = `.delivery-gate${sep}`;

function isEvidencePath(path: string): boolean {
  return path === ".delivery-gate" || path.startsWith(ignoredEvidencePrefix) || path.startsWith(".delivery-gate/");
}

export async function snapshotGit(cwd: string): Promise<GitSnapshot> {
  const rootResult = await git(["rev-parse", "--show-toplevel"], cwd);
  if (rootResult.code !== 0) throw new Error("working directory is not inside a Git repository");
  const root = rootResult.stdout.toString("utf8").trim();
  const headResult = await git(["rev-parse", "HEAD"], root);
  if (headResult.code !== 0) throw new Error("Git repository has no HEAD commit");

  const statusResult = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
  if (statusResult.code !== 0) throw new Error(statusResult.stderr.toString("utf8").trim() || "git status failed");
  const dirty = statusResult.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !isEvidencePath(entry.slice(3)))
    .sort();

  const filesResult = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root);
  if (filesResult.code !== 0) throw new Error(filesResult.stderr.toString("utf8").trim() || "git ls-files failed");
  const files = filesResult.stdout.toString("utf8").split("\0").filter(Boolean).filter((path) => !isEvidencePath(path)).sort();
  const entries: string[] = [];
  for (const path of files) {
    const absolute = resolve(root, path);
    if (relative(root, absolute).startsWith(`..${sep}`)) throw new Error(`unsafe repository path: ${path}`);
    try {
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        entries.push(`${path}\0link\0${await readlink(absolute)}`);
      } else if (stats.isFile()) {
        entries.push(`${path}\0${stats.mode & 0o111 ? "executable" : "file"}\0${sha256(await readFile(absolute))}`);
      } else {
        entries.push(`${path}\0unsupported\0${stats.mode}`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") entries.push(`${path}\0missing`);
      else throw error;
    }
  }
  return { root, head: headResult.stdout.toString("utf8").trim(), digest: sha256(entries.join("\n")), dirty };
}
