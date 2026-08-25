/**
 * 只读验证脚本（不触发 EventLogStorage 崩溃恢复副作用）：
 * 直接读文件 + splitJsonLine 恢复 + deriveMessagesFromEvents 派生，
 * 确认 assistant 消息 finishReason 是否仍有 canceled（前端中断提示来源）。
 * 用法：bun run scripts/verify-derive.ts <sessionId>
 */
import fs from 'fs';
import path from 'path';
import { deriveMessagesFromEvents } from '../src/session/storage/EventMessageDeriver';
import { splitJsonLine } from '../src/session/storage/EventLogStorage';

const sid = process.argv[2];
if (!sid) {
  console.error('用法: bun run scripts/verify-derive.ts <sessionId>');
  process.exit(1);
}

// 与 EventLogStorage 相同的会话目录解析（default worktree）
const env: NodeJS.ProcessEnv = { PYAPP_PROJECT_DIR: '' };
const { resolveSessionsDir } = await import('../src/core/paths');
const sessionsRoot = path.dirname(resolveSessionsDir(env));
const filePath = path.join(sessionsRoot, 'default', sid, 'events.jsonl');
if (!fs.existsSync(filePath)) {
  console.error(`会话 events.jsonl 不存在: ${filePath}`);
  process.exit(1);
}

// 读所有行（恢复损坏行后展平）
const rawLines = fs.readFileSync(filePath, 'utf-8').split('\n');
const events: unknown[] = [];
let tornLineCount = 0;
for (const line of rawLines) {
  if (!line.trim()) continue;
  let parsed = false;
  try {
    events.push(JSON.parse(line));
    parsed = true;
  } catch {
    // 拼接/半写行：用官方 splitJsonLine 恢复（贪心匹配，可恢复外层未闭合的内层完整 JSON）
    const objs = splitJsonLine(line);
    if (objs.length > 0) {
      events.push(...objs);
      tornLineCount++;
    }
  }
}
console.log(`原始行数=${rawLines.length} 恢复后事件数=${events.length} 损坏行恢复=${tornLineCount}`);

const derived = deriveMessagesFromEvents(
  events as never,
  [],
  { compactionRanges: undefined }
) as Array<{ id: string; role: string; finishReason?: string; content?: unknown }>;

let canceledCount = 0;
let asstCount = 0;
for (const m of derived) {
  if (m.role !== 'assistant') continue;
  asstCount++;
  const contentLen =
    typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length;
  const flag = m.finishReason === 'canceled' || m.finishReason === 'abort' ? ' ⚠️ CANCELED' : '';
  if (m.finishReason === 'canceled' || m.finishReason === 'abort') canceledCount++;
  console.log(
    `assistant ${m.id.slice(0, 8)} finishReason=${m.finishReason ?? '(无)'} contentLen=${contentLen}${flag}`,
  );
}
console.log(`\n中断标记消息数: ${canceledCount} / assistant ${asstCount}`);
