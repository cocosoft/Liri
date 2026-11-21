// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 一次性回填：修复历史 `messages.jsonl` 中被压平的 text 块（2026-11-21）
 *
 * 背景：`EventBasedStreamAggregator.appendChunk` 曾把「纯空白文本帧」当空帧丢弃，
 * 导致落盘 blocks 丢失换行/空格（`## 标题` → `##标题`、围栏闭合行被吞），而 `events.jsonl`
 * 是完整的。根因已修，但历史块不会自动恢复 —— 本脚本按事件重派生正文并回填。
 *
 * 安全边界（任一不满足即跳过）：
 *   1. 只改 `role==='assistant'` 且含 text 块的消息；**多 text 块**按"逐块非空白签名"
 *      在事件正文里按序切回（块间空白不归属任何块）；
 *   2. 该消息 id 能在事件中找到 `assistant/text|text-batch` 正文；
 *   3. **去掉全部空白后逐字相等** ⇒ 仅空白差异，绝不改写正文内容；
 *   4. 先写 `messages.jsonl.bak-<ts>` 备份，再原子替换（临时文件 + rename）；
 *   5. 同 id 多行全部改写（存储层按"后写覆盖先写"读取）。
 *
 * 用法：
 *   bun run scripts/backfill-collapsed-text-blocks.ts            # dry-run（只报告）
 *   bun run scripts/backfill-collapsed-text-blocks.ts --apply     # 实际写入
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';

const apply = process.argv.includes('--apply');
const sessionsRoot = join(
  process.env.USERPROFILE ?? process.env.HOME ?? '.',
  '.pyapp',
  'data',
  'sessions'
);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

interface Stats {
  sessions: number;
  scanned: number;
  changed: number;
  skipped: number;
  files: number;
}

const stats: Stats = {
  sessions: 0,
  scanned: 0,
  changed: 0,
  skipped: 0,
  files: 0,
};

/** 去掉全部空白（判"仅空白差异"用） */
function noWs(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * 把事件正文按"各 text 块的非空白签名"切回逐块（2026-11-21 扩展：多 text 块）。
 *
 * 前提：`noWs(blocks.join('')) === noWs(source)`（调用方已校验）⇒ 逐块签名必按序命中。
 * 块间空白不归属任何块（原块边界来自工具卡片/状态块，块间空白不参与块内渲染）。
 * @returns 每块的新内容；任一签名不匹配 ⇒ null（调用方跳过）
 */
function recoverSegments(source: string, blocks: string[]): string[] | null {
  const out: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const sig = noWs(block);
    if (!sig) {
      out.push('');
      continue;
    }
    let start = -1;
    let end = -1;
    let matched = 0;
    for (let i = cursor; i < source.length && matched < sig.length; i++) {
      const ch = source[i];
      if (/\s/.test(ch)) continue;
      if (ch !== sig[matched]) return null;
      if (start === -1) start = i;
      matched++;
      end = i + 1;
    }
    if (matched !== sig.length) return null;
    out.push(source.slice(start, end));
    cursor = end;
  }
  return out;
}

/**
 * 读事件：messageId → 拼接正文，以及**按轮次切分的正文段**。
 *
 * 段边界 = `assistant/thinking` / `assistant/tool_call` / `tool/result`（同 messageId 时闭合当前段）。
 * 为什么需要：跨轮被改写/取代的消息，其"整条拼接"与块对不上；但**单段**通常仍与某个块逐字同源
 * （块正是在这些非文本块处被切开）⇒ 可按段对齐恢复。
 */
function readEvents(eventsPath: string): {
  textByMessage: Map<string, string>;
  segmentsByMessage: Map<string, string[]>;
} {
  const textByMessage = new Map<string, string>();
  const segmentsByMessage = new Map<string, string[]>();
  const buffers = new Map<string, string>();

  const flush = (messageId: string): void => {
    const buf = buffers.get(messageId);
    if (!buf) return;
    buffers.set(messageId, '');
    if (noWs(buf) === '') return;
    const list = segmentsByMessage.get(messageId) ?? [];
    list.push(buf);
    segmentsByMessage.set(messageId, list);
  };

  const lines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const data = e.data as { content?: string; messageId?: string } | undefined;
    const messageId = data?.messageId;
    if (!messageId) continue;

    if (e.type === 'assistant/text' || e.type === 'assistant/text-batch') {
      const content = typeof data?.content === 'string' ? data.content : '';
      if (!content) continue;
      textByMessage.set(
        messageId,
        (textByMessage.get(messageId) ?? '') + content
      );
      buffers.set(messageId, (buffers.get(messageId) ?? '') + content);
      continue;
    }
    // 非文本块 = 段边界（工具卡片/思考块会把正文切块）
    if (
      e.type === 'assistant/thinking' ||
      e.type === 'assistant/tool_call' ||
      e.type === 'tool/result'
    ) {
      flush(messageId);
    }
  }
  for (const messageId of buffers.keys()) flush(messageId);
  return { textByMessage, segmentsByMessage };
}

function processSession(dir: string): void {
  const messagesPath = join(dir, 'messages.jsonl');
  const eventsPath = join(dir, 'events.jsonl');
  if (!existsSync(messagesPath) || !existsSync(eventsPath)) return;
  stats.sessions++;

  const { textByMessage, segmentsByMessage } = readEvents(eventsPath);
  if (textByMessage.size === 0) return;

  const raw = readFileSync(messagesPath, 'utf8');
  const lines = raw.split('\n');
  const out: string[] = [];
  let fileChanged = 0;

  for (const line of lines) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      out.push(line);
      continue;
    }
    stats.scanned++;
    const id = typeof msg.id === 'string' ? msg.id : '';
    const blocks = Array.isArray(msg.blocks)
      ? (msg.blocks as Array<Record<string, unknown>>)
      : null;
    if (msg.role !== 'assistant' || !id || !blocks) {
      out.push(line);
      continue;
    }
    const textBlocks = blocks.filter((b) => b.type === 'text');
    if (textBlocks.length === 0) {
      stats.skipped++;
      out.push(line);
      continue;
    }
    const source = textByMessage.get(id);
    if (!source) {
      stats.skipped++;
      out.push(line);
      continue;
    }
    const persistedContents = textBlocks.map((b) => String(b.content ?? ''));
    const persistedConcat = persistedContents.join('');
    let nextContents: string[] | null = null;

    if (noWs(persistedConcat) === noWs(source)) {
      // ① 仅空白差异（含多块的"段间空白"）：按非空白签名逐块切回
      if (persistedConcat !== source) {
        nextContents = recoverSegments(source, persistedContents);
      }
    } else {
      // ② 跨轮改写/取代：整条拼不上 ⇒ 按 thinking/tool 边界切段，逐块对齐**单段**
      //    只替换"与某一段去空白后逐字相等"的块；对不上的块原样保留（不猜）。
      const segments = segmentsByMessage.get(id) ?? [];
      let segCursor = 0;
      let replaced = false;
      const bySegment = persistedContents.map((persisted) => {
        const target = noWs(persisted);
        for (let s = segCursor; s < segments.length; s++) {
          if (noWs(segments[s]) === target) {
            segCursor = s + 1;
            if (segments[s] !== persisted) replaced = true;
            return segments[s];
          }
        }
        return persisted;
      });
      if (replaced) nextContents = bySegment;
    }

    if (!nextContents) {
      stats.skipped++;
      out.push(line);
      continue;
    }
    // 幂等判据：逐块已与恢复结果一致 ⇒ 视为无需改动
    if (nextContents.every((seg, i) => seg === persistedContents[i])) {
      out.push(line);
      continue;
    }
    const resolved = nextContents;
    let textIndex = 0;
    const nextBlocks = blocks.map((b) =>
      b.type === 'text' ? { ...b, content: resolved[textIndex++] } : b
    );
    out.push(JSON.stringify({ ...msg, blocks: nextBlocks }));
    fileChanged++;
    stats.changed++;
  }

  if (fileChanged === 0) return;
  stats.files++;
  console.log(
    `${apply ? '[APPLY]' : '[DRY]'} ${dir} → ${fileChanged} 条消息恢复空白`
  );
  if (!apply) return;

  copyFileSync(messagesPath, `${messagesPath}.bak-${stamp}`);
  const tmpPath = `${messagesPath}.tmp-${stamp}`;
  writeFileSync(tmpPath, out.join('\n'), 'utf8');
  renameSync(tmpPath, messagesPath);
}

function main(): void {
  if (!existsSync(sessionsRoot)) {
    console.error(`sessions 根目录不存在：${sessionsRoot}`);
    process.exit(1);
  }
  for (const hash of readdirSync(sessionsRoot)) {
    const hashDir = join(sessionsRoot, hash);
    let entries: string[];
    try {
      entries = readdirSync(hashDir);
    } catch {
      continue;
    }
    for (const sid of entries) {
      processSession(join(hashDir, sid));
    }
  }
  console.log(
    `${apply ? 'APPLY' : 'DRY-RUN'} 完成：sessions=${stats.sessions} scanned=${stats.scanned} ` +
      `changed=${stats.changed} skipped=${stats.skipped} files=${stats.files}`
  );
  if (!apply) {
    console.log('未写入任何文件；确认无误后加 --apply。');
  }
}

main();
