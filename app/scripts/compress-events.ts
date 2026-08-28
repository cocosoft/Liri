/**
 * 压缩 events.jsonl —— 合并连续同 messageId 的 assistant/thinking 事件
 *
 * 背景（2026-08-29）：推理模型 thinking chunk 逐条落盘使 events.jsonl 膨胀到
 * 90MB+/40 万行，会话加载（getMessages 分页全量扫描）O(N²) 卡死 → "重启后打不开"。
 * 代码侧已修复（streamMessageFlow/ReActToolLoop 防抖合并 + EventLogStorage read
 * fromSeq 跳过），本脚本用于一次性瘦身存量超大事件日志。
 *
 * 用法（需先停止应用，脚本需写 ~/.pyapp/data/sessions）：
 *   bun run scripts/compress-events.ts            # 实际压缩（自动备份）
 *   bun run scripts/compress-events.ts --dry-run  # 仅预览，不写盘
 *
 * 安全性：
 *   - 每个文件先备份为 events.jsonl.bak（已存在备份则跳过，防重复处理）
 *   - 仅合并"连续且同 messageId"的 thinking 事件（content 拼接，内容不丢）
 *   - 其余事件原样保留，seq 从 1 重排，同步更新 events.tail
 *   - 损坏行跳过（备份中保留原始数据）
 */
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DRY_RUN = process.argv.includes('--dry-run');
const THRESHOLD_BYTES = 5 * 1024 * 1024; // 仅处理 >5MB

const root = process.env.LIRI_DATA_DIR
  ? join(process.env.LIRI_DATA_DIR, 'sessions')
  : join(homedir(), '.pyapp', 'data', 'sessions');

function collectEventFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectEventFiles(p));
    } else if (entry.name === 'events.jsonl') {
      files.push(p);
    }
  }
  return files;
}

function compress(file: string): { before: number; after: number; lines: number; outLines: number; dropped: number } {
  const backup = `${file}.bak`;
  if (existsSync(backup)) {
    throw new Error(`备份已存在（${backup}），跳过防重复处理`);
  }
  renameSync(file, backup);
  const lines = readFileSync(backup, 'utf8').split('\n');
  const out: string[] = [];
  let pending: { ev: Record<string, unknown>; content: string; messageId: string; lastTime: number } | null = null;
  let seq = 1;
  let dropped = 0;

  const flush = () => {
    if (!pending) return;
    pending.ev.seq = seq++;
    pending.ev.time = pending.lastTime;
    (pending.ev.data as Record<string, unknown>).content = pending.content;
    out.push(JSON.stringify(pending.ev));
    pending = null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: { type?: string; data?: { messageId?: string; content?: string }; seq?: number; time?: number };
    try {
      ev = JSON.parse(line);
    } catch {
      dropped++; // 损坏行跳过（备份保留原始）
      continue;
    }
    const messageId = (ev as { data?: { messageId?: string } }).data?.messageId;
    if (ev.type === 'assistant/thinking' && messageId) {
      if (pending && pending.messageId === messageId) {
        pending.content += (ev.data as { content?: string })?.content ?? '';
        pending.lastTime = (ev.time as number) ?? pending.lastTime;
        continue;
      }
      flush();
      pending = {
        ev: ev as Record<string, unknown>,
        content: (ev.data as { content?: string })?.content ?? '',
        messageId,
        lastTime: (ev.time as number) ?? Date.now(),
      };
      continue;
    }
    flush();
    ev.seq = seq++;
    out.push(JSON.stringify(ev));
  }
  flush();

  if (DRY_RUN) {
    // 恢复备份（dry-run 不写盘）
    renameSync(backup, file);
    return { before: 0, after: 0, lines: lines.length, outLines: out.length, dropped };
  }

  writeFileSync(file, out.join('\n') + '\n');
  const tailFile = join(file.replace('events.jsonl', ''), 'events.tail');
  writeFileSync(tailFile, String(seq - 1));
  return { before: statSync(backup).size, after: statSync(file).size, lines: lines.length, outLines: out.length, dropped };
}

const MB = 1024 * 1024;
const files = collectEventFiles(root);
let ok = 0, skipped = 0;

console.log(`扫描目录: ${root}${DRY_RUN ? '（DRY-RUN，不写盘）' : ''}\n`);

for (const f of files) {
  const size = statSync(f).size;
  if (size < THRESHOLD_BYTES) {
    skipped++;
    continue;
  }
  const sessionId = f.split(/[\\/]/).slice(-2, -1)[0];
  try {
    const r = compress(f);
    if (DRY_RUN) {
      console.log(`[预览] ${sessionId}: ${(size / MB).toFixed(1)}MB, ${r.lines} 行 → ${r.outLines} 行, 损坏跳过 ${r.dropped}`);
    } else {
      console.log(`[ok]   ${sessionId}: ${(r.before / MB).toFixed(1)}MB → ${(r.after / MB).toFixed(1)}MB, ${r.lines} 行 → ${r.outLines} 行, 损坏跳过 ${r.dropped}, tailSeq ${r.outLines}`);
    }
    ok++;
  } catch (e) {
    console.log(`[skip] ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n完成: 处理 ${ok} 个, 跳过小文件 ${skipped} 个`);
