import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import http from "node:http";
import { resolve } from "node:path";

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

function listen(server, host) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolveListen(server.address());
    });
  });
}

async function expectBlocked(operation) {
  try {
    await operation();
    return { blocked: false, code: null };
  } catch (error) {
    return { blocked: true, code: error?.code ?? error?.cause?.code ?? error?.name ?? "unknown" };
  }
}

const workspaceTarget = resolve(process.cwd(), `.agent-loopback-write-${randomUUID()}`);
const outsideTarget = process.env.AGENT_LOOPBACK_OUTSIDE_TARGET;
if (!outsideTarget) throw new Error("AGENT_LOOPBACK_OUTSIDE_TARGET is required");

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

let localHttp = false;
let wildcardBindAllowed = false;
try {
  const address = await listen(server, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${address.port}/probe`);
  localHttp = response.status === 200 && (await response.json()).ok === true;
} finally {
  await close(server);
}

const wildcardServer = http.createServer();
try {
  await listen(wildcardServer, "0.0.0.0");
  wildcardBindAllowed = true;
} catch (error) {
  if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
} finally {
  await close(wildcardServer);
}

await writeFile(workspaceTarget, "workspace write allowed\n");
await unlink(workspaceTarget);

const outsideWrite = await expectBlocked(() => writeFile(outsideTarget, "outside write must fail\n", { flag: "wx" }));
const externalNetwork = await expectBlocked(() => fetch("https://example.com", { signal: AbortSignal.timeout(5_000) }));

const result = {
  externalNetworkBlocked: externalNetwork.blocked,
  externalNetworkError: externalNetwork.code,
  localHttp,
  outsideWriteBlocked: outsideWrite.blocked,
  outsideWriteError: outsideWrite.code,
  wildcardBindAllowed,
  workspaceWrite: true,
};

console.log(JSON.stringify(result));
if (!localHttp || !outsideWrite.blocked || !externalNetwork.blocked) process.exitCode = 1;
