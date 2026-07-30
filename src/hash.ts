import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const content = await readFile(path);
  return { sha256: sha256(content), bytes: content.byteLength };
}
