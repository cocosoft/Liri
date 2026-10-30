// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * M8（2026-10-30，一致性核查）：会话消息投影（`messages.jsonl`）**分片**工具。
 *
 * 为什么需要：单会话 `messages.jsonl` 实测最大 **17.2 MB**（49 文件共 127 MB、10 个 >5 MB），
 * 单文件越大则追加 / 全量重写 / 坏行定位的代价越高。分片方案把**旧内容**切成
 * `messages.0001.jsonl`、`messages.0002.jsonl`…，**活动尾文件仍是 `messages.jsonl`**
 * ⇒ 写路径（append / compact）零改动；读路径（`FileSystemUnifiedStorage.loadMessages`
 * 与 dream 采集器）已支持「分片升序 + 尾文件」拼接 + 既有反向去重。
 *
 * 安全边界：
 *  - 默认**只读预演**（打印每个会话的切分计划），只有 `--apply` 才写盘；
 *  - `--apply` 先把原文件整份备份到 `<root>/migrations/messages-split-<ts>/<sessionId>/`，
 *    并逐条写 `audit.jsonl`（回滚 = 用备份覆盖原文件并删除分片）；
 *  - **跳过无 `events.jsonl` 的会话**（v0 legacy 投影是唯一真源，切分会让
 *    `MessageToEventMigrator` 只读到尾段 ⇒ 数据丢失）；
 *  - 已有分片的会话跳过（幂等，避免序号冲突）。
 *
 * 运行：`cd app && bun run split:session-messages`（预演）
 *       `cd app && bun run split:session-messages -- --apply`
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
// M8：切块规则是运行时与脚本的**同一实现**（唯一真源 `src/session/storage/messageSegments.ts`）
import {
  MESSAGE_SEGMENT_MAX_BYTES as DEFAULT_MAX_BYTES,
  MESSAGE_SEGMENT_MAX_LINES as DEFAULT_MAX_LINES,
  planMessageSplit,
} from '../src/session/storage/messageSegments';

/** 会话切分状态 */
export type SplitStatus =
  | 'ok'
  | 'missing'
  | 'small'
  | 'empty'
  | 'no-events'
  | 'already-split';

export interface SplitPlanItem {
  sessionId: string;
  filePath: string;
  bytes: number;
  lines: number;
  /** 切出的分片数（0 = 不切；尾文件不计入） */
  segments: number;
  status: SplitStatus;
}

/** 目录内已有的分片（升序） */
function existingSegments(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // @ignore-catch 目录不可读 ⇒ 视为无分片（后续按无分片处理）
    return [];
  }
  return entries
    .filter((name) => /^messages\.(\d{4,})\.jsonl$/.test(name))
    .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]));
}

/** 扫描 `<root>/sessions/<partition>/<sessionId>/` 下的消息投影，给出切分计划 */
export function scanSessions(
  root: string,
  options: { maxBytes?: number; maxLines?: number } = {}
): SplitPlanItem[] {
  const sessionsRoot = join(root, 'sessions');
  const out: SplitPlanItem[] = [];
  let partitions: string[];
  try {
    partitions = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // @ignore-catch 目录不存在 ⇒ 无可扫描会话
    return out;
  }
  for (const partition of partitions) {
    const partitionDir = join(sessionsRoot, partition);
    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(partitionDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      // @ignore-catch 单个分区不可读 ⇒ 跳过
      continue;
    }
    for (const sessionId of sessionDirs) {
      const dir = join(partitionDir, sessionId);
      const filePath = join(dir, 'messages.jsonl');
      if (!existsSync(filePath)) continue;
      const bytes = statSync(filePath).size;
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const item: SplitPlanItem = {
        sessionId,
        filePath,
        bytes,
        lines: lines.length,
        segments: 0,
        status: 'ok',
      };
      if (lines.length === 0) {
        item.status = 'empty';
      } else if (existingSegments(dir).length > 0) {
        item.status = 'already-split';
      } else if (!existsSync(join(dir, 'events.jsonl'))) {
        // v0 legacy 会话：投影是唯一真源，切分会让迁移器只读到尾段
        item.status = 'no-events';
      } else if (
        bytes <= (options.maxBytes ?? DEFAULT_MAX_BYTES) &&
        lines.length <= (options.maxLines ?? DEFAULT_MAX_LINES)
      ) {
        item.status = 'small';
      } else {
        const plan = planMessageSplit(
          lines.map((l) => Buffer.byteLength(l, 'utf-8') + 1),
          options
        );
        item.segments = plan.segments;
        if (plan.segments === 0) item.status = 'small';
      }
      out.push(item);
    }
  }
  return out;
}

/** 逐行原子写（先写 `.tmp` 再 rename，避免半截文件被读到） */
function writeLinesAtomic(filePath: string, lines: readonly string[]): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * 执行切分。
 *
 * @returns 每个会话的处理结果（`applied=false` 即预演）
 */
export function splitSessionMessages(
  root: string,
  options: {
    apply?: boolean;
    maxBytes?: number;
    maxLines?: number;
    now?: Date;
  } = {}
): { items: SplitPlanItem[]; backupDir?: string; applied: number } {
  const items = scanSessions(root, options);
  if (!options.apply) return { items, applied: 0 };

  const targets = items.filter((i) => i.status === 'ok' && i.segments > 0);
  if (targets.length === 0) return { items, applied: 0 };

  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '');
  const backupDir = join(root, 'migrations', `messages-split-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  const auditPath = join(backupDir, 'audit.jsonl');

  let applied = 0;
  for (const item of targets) {
    const backupPath = join(backupDir, item.sessionId);
    mkdirSync(backupPath, { recursive: true });
    const backupFile = join(backupPath, 'messages.jsonl');
    copyFileSync(item.filePath, backupFile);

    const content = readFileSync(item.filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const plan = planMessageSplit(
      lines.map((l) => Buffer.byteLength(l, 'utf-8') + 1),
      options
    );
    const dir = dirname(item.filePath);
    let segNo = 0;
    for (let i = 0; i < plan.chunks.length - 1; i++) {
      const { from, to } = plan.chunks[i];
      segNo += 1;
      writeLinesAtomic(
        join(dir, `messages.${String(segNo).padStart(4, '0')}.jsonl`),
        lines.slice(from, to)
      );
    }
    const tail = plan.chunks[plan.chunks.length - 1];
    writeLinesAtomic(item.filePath, lines.slice(tail.from, tail.to));

    appendFileSync(
      auditPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: item.sessionId,
        bytes: item.bytes,
        lines: item.lines,
        segments: plan.segments,
        tailLines: tail.to - tail.from,
        backup: backupFile,
      })}\n`,
      'utf-8'
    );
    applied += 1;
  }
  return { items, backupDir, applied };
}

/** CLI 入口（`--apply` 才写盘；`--root` / `--json` / `--max-bytes` / `--max-lines`） */
function main(): number {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const maxBytes = arg('--max-bytes')
    ? Number.parseInt(arg('--max-bytes')!, 10)
    : DEFAULT_MAX_BYTES;
  const maxLines = arg('--max-lines')
    ? Number.parseInt(arg('--max-lines')!, 10)
    : DEFAULT_MAX_LINES;

  const result = splitSessionMessages(root, { apply, maxBytes, maxLines });
  const candidates = result.items.filter(
    (i) => i.status === 'ok' && i.segments > 0
  );

  if (json) {
    console.log(JSON.stringify({ ...result, candidates: candidates.length }));
    return 0;
  }

  console.log(
    `[split:messages] root=${root} ${apply ? 'APPLY' : '预演（只读，加 --apply 才写盘）'}`
  );
  for (const item of result.items) {
    if (item.status !== 'ok' || item.segments === 0) continue;
    console.log(
      `  ${item.sessionId}  ${(item.bytes / 1024 / 1024).toFixed(1)} MB / ${item.lines} 行` +
        ` ⇒ ${item.segments} 个分片 + 尾文件`
    );
  }
  const skipped = result.items.filter(
    (i) => i.status !== 'ok' || i.segments === 0
  );
  const byStatus = new Map<string, number>();
  for (const s of skipped)
    byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  console.log(
    `  可切分：${candidates.length} 个会话；跳过：` +
      [...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(' / ')
  );
  if (apply) {
    console.log(
      `  已切分 ${result.applied} 个会话；备份 + 审计：${result.backupDir}`
    );
  }
  return 0;
}

// 仅作为入口脚本执行时才跑 main（被测试 import 时不产生副作用）
if (import.meta.main) {
  process.exit(main());
}
