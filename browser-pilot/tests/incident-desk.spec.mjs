import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const candidateRoot = process.cwd();
const artifactDirectory = process.env.DELIVERY_GATE_ARTIFACT_DIR;
let server;
let baseUrl;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function insideCandidate(path) {
  return path === candidateRoot || path.startsWith(`${candidateRoot}${sep}`);
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const path = resolve(candidateRoot, `.${relativePath}`);
      if (!insideCandidate(path) || !(await stat(path)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
});

async function openDesk(page) {
  await page.goto(baseUrl);
  await expect(page.getByRole("heading", { name: "Incident Desk", level: 1 })).toBeVisible();
}

test("renders the operational queue with accessible controls", async ({ page }) => {
  await openDesk(page);
  await expect(page.getByRole("searchbox", { name: "Search incidents" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Incident filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^All\s+3$/i })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Open\s+1$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Investigating\s+1$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Resolved\s+1$/i })).toBeVisible();
  await expect(page.getByRole("region", { name: "Incident queue" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /INC-1042.*Checkout latency spike/i })).toBeVisible();
});

test("filters and searches across incident fields", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("button", { name: /^Resolved\s+1$/i }).click();
  await expect(page.getByRole("region", { name: "Incident queue" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /INC-1029.*Stale inventory counts/i })).toBeVisible();

  await page.getByRole("button", { name: /^All\s+3$/i }).click();
  await page.getByRole("searchbox", { name: "Search incidents" }).fill("maya");
  await expect(page.getByRole("region", { name: "Incident queue" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /INC-1038.*Webhook delivery failures/i })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search incidents" }).fill("does-not-exist");
  await expect(page.getByText("No incidents match this view.", { exact: true })).toBeVisible();
});

test("updates assignment, status, counts, and activity", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("button", { name: /INC-1042.*Checkout latency spike/i }).click();
  const details = page.getByRole("region", { name: "Incident details" });
  await expect(details.getByRole("heading", { name: "Checkout latency spike" })).toBeVisible();
  const initialActivityCount = await details.getByRole("listitem").count();
  await details.getByRole("combobox", { name: "Owner" }).selectOption({ label: "Alex Kim" });
  await details.getByRole("button", { name: "Start investigation" }).click();

  await expect(details.getByText("Investigating", { exact: true }).first()).toBeVisible();
  await expect(details.getByRole("combobox", { name: "Owner" })).toHaveValue("Alex Kim");
  await expect(details.getByRole("button", { name: "Resolve incident" })).toBeVisible();
  expect(await details.getByRole("listitem").count()).toBeGreaterThan(initialActivityCount);
  await expect(page.getByRole("button", { name: /^Open\s+0$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Investigating\s+2$/i })).toBeVisible();

  await page.screenshot({ path: `${artifactDirectory}/incident-desk-desktop.png`, fullPage: true });
});

test("persists incident changes across reload", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("button", { name: /INC-1042.*Checkout latency spike/i }).click();
  const details = page.getByRole("region", { name: "Incident details" });
  await details.getByRole("combobox", { name: "Owner" }).selectOption({ label: "Alex Kim" });
  await details.getByRole("button", { name: "Start investigation" }).click();
  await page.reload();

  const reloadedDetails = page.getByRole("region", { name: "Incident details" });
  await expect(reloadedDetails.getByText("Investigating", { exact: true }).first()).toBeVisible();
  await expect(reloadedDetails.getByRole("combobox", { name: "Owner" })).toHaveValue("Alex Kim");
  expect(await reloadedDetails.getByRole("listitem").count()).toBeGreaterThan(1);
});

test("reset restores the seed state", async ({ page }) => {
  await openDesk(page);
  const details = page.getByRole("region", { name: "Incident details" });
  await details.getByRole("combobox", { name: "Owner" }).selectOption({ label: "Alex Kim" });
  await details.getByRole("button", { name: "Start investigation" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();

  await expect(details.getByText("Open", { exact: true }).first()).toBeVisible();
  await expect(details.getByRole("combobox", { name: "Owner" })).toHaveValue("Unassigned");
  await expect(page.getByRole("button", { name: /^Open\s+1$/i })).toBeVisible();
});

test("remains usable without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  await page.getByRole("button", { name: /INC-1038.*Webhook delivery failures/i }).click();
  await expect(page.getByRole("region", { name: "Incident details" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${artifactDirectory}/incident-desk-mobile.png`, fullPage: true });
});
