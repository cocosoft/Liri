/**
 * Read-only scan v2: inspect status blocks and any line containing watermark text
 * Prints sample polluted structures to define cleanup rules.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SESSIONS_ROOT = join(
  process.cwd(),
  "data",
  "pyapp",
  "data",
  "sessions",
);

let statusBlockTotal = 0;
let watermarkStatusTotal = 0;
let rawLineMatches = 0;
const samples: string[] = [];
const statusSamples: string[] = [];

function scanFile(file: string, sessionId: string): void {
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (line.includes("上下文水位")) {
      rawLineMatches++;
      if (samples.length < 5) samples.push(line.slice(0, 200));
    }
    try {
      const msg = JSON.parse(line);
      if (msg.role !== "assistant" || !Array.isArray(msg.blocks)) continue;
      for (const b of msg.blocks as Array<Record<string, unknown>>) {
        if (b.type === "status") {
          statusBlockTotal++;
          if (statusSamples.length < 5)
            statusSamples.push(
              `[${sessionId}] type=${b.type} statusType=${b.statusType ?? "?"} content=${String(b.content ?? "").slice(0, 80)}`,
            );
          if (typeof b.content === "string" && b.content.includes("水位")) {
            watermarkStatusTotal++;
          }
        }
      }
    } catch {
      /* skip */
    }
  }
}

function walk(dir: string, sessionId: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p, sessionId === "" ? entry.name : `${sessionId}/${entry.name}`);
    } else if (entry.isFile() && entry.name === "messages.jsonl") {
      scanFile(p, sessionId);
    }
  }
}

if (!existsSync(SESSIONS_ROOT)) {
  console.log("sessions root missing:", SESSIONS_ROOT);
  process.exit(1);
}

walk(SESSIONS_ROOT, "");

console.log("===== scan v2 =====");
console.log("status blocks total:", statusBlockTotal);
console.log("status blocks containing 'watermark':", watermarkStatusTotal);
console.log("raw lines containing 'watermark':", rawLineMatches);
console.log("--- raw line samples ---");
samples.forEach((s) => console.log(s));
console.log("--- status block samples ---");
statusSamples.forEach((s) => console.log(s));
