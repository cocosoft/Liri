/**
 * 一次性回填：把 `cost_records` 里按会话汇总的 tokens / 金额写回会话元数据。
 *
 * 背景（2026-11-11）：`recordChatResponseUsage` 此前从不回写 `metadata.totalTokens/totalCost`
 * ⇒ 历史会话全部是 0（新代码已修，但只对之后的请求生效）。本脚本用于**一次性补齐存量**。
 *
 * 用法：
 *   bun run scripts/backfill-session-usage.ts            # dry-run（只打印差异）
 *   bun run scripts/backfill-session-usage.ts --apply    # 实际写入
 *
 * 约束：必须在后端停止时运行（运行中的进程持有会话内存副本，直接改盘会被覆盖）。
 */
import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const DATA_DIR = process.env.LIRI_DATA_DIR?.trim()
  ? process.env.LIRI_DATA_DIR.trim()
  : join(homedir(), '.pyapp', 'data');
const DB_PATH = join(DATA_DIR, 'app.db');
const SESSIONS_ROOT = join(DATA_DIR, 'sessions');

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function assertBackendStopped(): Promise<void> {
  try {
    await fetch('http://127.0.0.1:18990/v1/sessions', {
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    return; // 连不上 ⇒ 已停止
  }
  fail('后端仍在运行（18990 可访问）。请先停止后端再回填，否则内存副本会覆盖写盘。');
}

interface SessionUsageTotal {
  tokens: number;
  cost: number;
}

function loadUsageTotals(): Map<string, SessionUsageTotal> {
  if (!existsSync(DB_PATH)) fail(`找不到数据库：${DB_PATH}`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db
      .query(
        `SELECT session_id AS sessionId,
                SUM(input_tokens + output_tokens) AS tokens,
                SUM(cost_usd) AS cost
           FROM cost_records
          WHERE session_id IS NOT NULL AND session_id <> ''
          GROUP BY session_id`
      )
      .all() as Array<{ sessionId: string; tokens: number; cost: number }>;
    return new Map(
      rows.map((row) => [
        row.sessionId,
        { tokens: Number(row.tokens ?? 0), cost: Number(row.cost ?? 0) },
      ])
    );
  } finally {
    db.close();
  }
}

interface SessionJson {
  id?: string;
  metadata?: Record<string, unknown>;
}

await assertBackendStopped();

const usageTotals = loadUsageTotals();
console.log(`库内会话数（有 cost_records）：${usageTotals.size}`);

let scanned = 0;
let changed = 0;
let missingUsage = 0;
let trashedSkipped = 0;
const samples: string[] = [];

for (const bucket of readdirSync(SESSIONS_ROOT)) {
  const bucketDir = join(SESSIONS_ROOT, bucket);
  let entries: string[];
  try {
    entries = readdirSync(bucketDir);
  } catch {
    continue;
  }
  // `.trash` 是**软删除**会话（用户已删除，仅留回收站副本）：不参与回填。
  // 结构：`sessions/<bucket>/.trash/<sessionId>_<ts>/session.json`（不是顶层桶）。
  // 2026-11-11 实证：递归扫描时这里会多出 15 个"零 tokens 但有 cost_records"的文件，
  // 看似回填缺口，实际全是回收站会话 ⇒ 显式计数，避免下次误判。
  const trashDir = join(bucketDir, '.trash');
  if (existsSync(trashDir)) {
    trashedSkipped += readdirSync(trashDir).length;
  }
  for (const sessionId of entries) {
    const file = join(bucketDir, sessionId, 'session.json');
    if (!existsSync(file)) continue;
    let session: SessionJson;
    try {
      session = JSON.parse(readFileSync(file, 'utf-8')) as SessionJson;
    } catch {
      continue;
    }
    if (!session.metadata) continue;
    scanned++;

    const usage = usageTotals.get(session.id ?? sessionId);
    if (!usage) {
      missingUsage++;
      continue;
    }
    const totalTokens = Math.round(usage.tokens);
    const totalCost = Math.round(usage.cost * 1e6) / 1e6;
    const prevTokens = Number(session.metadata.totalTokens ?? 0);
    const prevCost = Number(session.metadata.totalCost ?? 0);
    if (prevTokens === totalTokens && prevCost === totalCost) continue;

    changed++;
    if (samples.length < 5) {
      samples.push(
        `${session.id ?? sessionId}: tokens ${prevTokens} → ${totalTokens}, cost ${prevCost} → ${totalCost}`
      );
    }
    if (APPLY) {
      session.metadata.totalTokens = totalTokens;
      session.metadata.totalCost = totalCost;
      writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, 'utf-8');
    }
  }
}

console.log(
  `扫描会话文件：${scanned}，回收站跳过：${trashedSkipped}，有差异：${changed}，无用量记录：${missingUsage}`
);
for (const line of samples) console.log(`  ${line}`);
console.log(
  APPLY
    ? '✅ 已写入（请重启后端后核对 /v1/sessions）'
    : '（dry-run）加 --apply 才会写入'
);
