/**
 * 存量水位状态块扫描（只读，不修改任何数据）
 *
 * 背景：2026-08-10 修复前，前端对 SSE context_state 事件无条件 addStatus，
 * 导致历史会话消息的 assistant.blocks 中被写入大量 "上下文水位: xx%" status 块。
 * 本脚本统计存量污染规模，用于评估清理方案。
 *
 * 用法：cd app && bun run scripts/scan-watermark-blocks.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SESSIONS_ROOT = join(process.cwd(), "data", "pyapp", "data", "sessions");
const CHECKPOINTS_ROOT = join(process.cwd(), "data", "pyapp", "data", "checkpoints");

/** 污染块判定：type === 'status' 且 content 含 '上下文水位' */
function isPollutedStatusBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const b = block as Record<string, unknown>;
  return b.type === "status" && typeof b.content === "string" && b.content.includes("上下文水位");
}

interface FileStats {
  file: string;
  pollutedBlocks: number;
  pollutedMsgs: number;
  emptyAfterClean: number; // 删除污染块后 blocks 变为空的消息数
}

const allFiles: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.isFile() && entry.name === "messages.jsonl") {
      allFiles.push(p);
    }
  }
}

function scanFile(file: string): FileStats {
  const stats: FileStats = { file, pollutedBlocks: 0, pollutedMsgs: 0, emptyAfterClean: 0 };
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const blocks = msg.blocks;
    if (!Array.isArray(blocks)) continue;
    const polluted = blocks.filter(isPollutedStatusBlock).length;
    if (polluted > 0) {
      stats.pollutedBlocks += polluted;
      stats.pollutedMsgs++;
      if (blocks.length - polluted === 0) stats.emptyAfterClean++;
    }
  }
  return stats;
}

walk(SESSIONS_ROOT);
console.log(`扫描根目录: ${SESSIONS_ROOT}`);
console.log(`messages.jsonl 文件数: ${allFiles.length}`);

const perFile: FileStats[] = allFiles.map(scanFile);
const totalFiles = perFile.filter((s) => s.pollutedBlocks > 0).length;
const totalBlocks = perFile.reduce((a, s) => a + s.pollutedBlocks, 0);
const totalMsgs = perFile.reduce((a, s) => a + s.pollutedMsgs, 0);
const totalEmpty = perFile.reduce((a, s) => a + s.emptyAfterClean, 0);

console.log("\n===== 存量污染统计（sessions）=====");
console.log(`受影响文件: ${totalFiles} / ${allFiles.length}`);
console.log(`污染块总数: ${totalBlocks}`);
console.log(`污染消息条数: ${totalMsgs}`);
console.log(`删除后 blocks 为空的消息数: ${totalEmpty}`);

// ---- 检查点目录扫描：检查点 JSON 文件含 messages 快照 ----
interface CpStats {
  file: string;
  pollutedBlocks: number;
  pollutedMsgs: number;
  cpCreatedAt?: string;
  cpSessionId?: string;
}
const cpFiles: string[] = [];
function walkCp(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkCp(p);
    else if (entry.isFile() && p.endsWith(".json")) cpFiles.push(p);
  }
}
function scanCp(file: string): CpStats {
  const stats: CpStats = { file, pollutedBlocks: 0, pollutedMsgs: 0 };
  try {
    const obj = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    stats.cpCreatedAt = typeof obj.createdAt === "string" ? String(obj.createdAt) : undefined;
    stats.cpSessionId = typeof obj.sessionId === "string" ? String(obj.sessionId) : undefined;
    const messages = obj.messages;
    if (!Array.isArray(messages)) return stats;
    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const blocks = m.blocks;
      if (!Array.isArray(blocks)) continue;
      const polluted = blocks.filter(isPollutedStatusBlock).length;
      if (polluted > 0) {
        stats.pollutedBlocks += polluted;
        stats.pollutedMsgs++;
      }
    }
  } catch {
    /* ignore malformed */
  }
  return stats;
}

walkCp(CHECKPOINTS_ROOT);
console.log(`\n===== 检查点目录 =====`);
console.log(`checkpoint JSON 文件数: ${cpFiles.length}`);
const cpStats = cpFiles.map(scanCp);
const cpAffected = cpStats.filter((s) => s.pollutedBlocks > 0);
const cpTotalBlocks = cpAffected.reduce((a, s) => a + s.pollutedBlocks, 0);
const cpTotalMsgs = cpAffected.reduce((a, s) => a + s.pollutedMsgs, 0);
console.log(`含污染块的文件: ${cpAffected.length} / ${cpFiles.length}`);
console.log(`污染块总数: ${cpTotalBlocks}`);
console.log(`污染消息条数: ${cpTotalMsgs}`);
if (cpAffected.length > 0) {
  console.log("\n===== 含污染的检查点文件（按污染块数降序，最多 20）=====");
  const top = [...cpAffected].sort((a, b) => b.pollutedBlocks - a.pollutedBlocks).slice(0, 20);
  for (const s of top) {
    console.log(`  blocks=${s.pollutedBlocks} msgs=${s.pollutedMsgs} createdAt=${s.cpCreatedAt ?? "?"} ${relative(CHECKPOINTS_ROOT, s.file)}`);
  }
  const sessions = new Set(cpAffected.map((s) => s.cpSessionId).filter(Boolean));
  console.log(`\n涉及会话数: ${sessions.size} → [${[...sessions].join(", ")}]`);
}

const top = [...perFile].filter((s) => s.pollutedBlocks > 0).sort((a, b) => b.pollutedBlocks - a.pollutedBlocks).slice(0, 15);
if (top.length > 0) {
  console.log("\n===== 受影响最严重的前 15 个文件 =====");
  for (const s of top) {
    console.log(`  blocks=${s.pollutedBlocks} msgs=${s.pollutedMsgs} emptyAfterClean=${s.emptyAfterClean}  ${relative(SESSIONS_ROOT, s.file)}`);
  }
}

// ---- 诊断：找出所有含 '上下文水位' 文本的行，输出其结构（用于确认污染形态）----
const WMK = "上下文水位";
let diagShown = 0;
for (const file of allFiles) {
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.includes(WMK)) continue;
    try {
      const msg = JSON.parse(line) as Record<string, unknown>;
      const blocks = msg.blocks;
      const inBlocks = Array.isArray(blocks)
        ? blocks
            .map((b, i) => {
              const blk = b as Record<string, unknown>;
              const hit =
                (typeof blk.content === "string" && blk.content.includes(WMK)) ||
                (typeof blk.text === "string" && (blk.text as string).includes(WMK));
              return hit ? i : -1;
            })
            .filter((i) => i >= 0)
        : [];
      const inOther = Object.entries(msg)
        .filter(([k, v]) => k !== "blocks" && typeof v === "string" && (v as string).includes(WMK))
        .map(([k]) => k);
      if (diagShown < 8) {
        console.log("\n----- 命中样例 -----");
        console.log(`  file: ${relative(SESSIONS_ROOT, file)}`);
        console.log(`  msg: id=${msg.id} role=${msg.role} type=${msg.type}`);
        console.log(`  命中位置: blocks索引=[${inBlocks.join(",")}] 其他字段=[${inOther.join(",")}]`);
        if (Array.isArray(blocks) && blocks.length > 0) {
          console.log(`  blocks[0] 结构: ${JSON.stringify((blocks[0] as Record<string, unknown>) as Record<string, unknown>).slice(0, 400)}`);
        }
        diagShown++;
      }
    } catch {
      /* ignore */
    }
  }
}
console.log(`\n（诊断样例最多输出 8 条）`);
