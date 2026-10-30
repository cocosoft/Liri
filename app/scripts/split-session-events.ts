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
 * A（2026-10-30）：事件流（`events.jsonl`）**分片**工具（一次性运维）。
 *
 * 规则与不变量见唯一实现 `src/session/storage/eventSegments.ts`（CS01：脚本不重写规则）。
 * 本脚本只负责：枚举会话 → 预演/切分 → 备份 + `audit.jsonl` → 打印。
 *
 * 安全边界：
 *  - **默认只读预演**，只有 `--apply` 才写盘；
 *  - `--apply` 先把原文件整份备份到 `<root>/migrations/events-split-<ts>/<sessionId>/`，
 *    并逐条写 `audit.jsonl`（回滚 = 用备份覆盖 `events.jsonl` 并删除 `events.*.jsonl`）；
 *  - **不重排 `seq`、不改内容**：读侧「分片升序 + 尾文件」拼接后与切分前逐字节相同；
 *  - 切分后删除 `events.idx`（单文件绝对偏移已失效），`events.tail` 保持最大 seq 不变；
 *  - 已分片 / 未超阈 / 空文件 ⇒ 跳过（幂等）。
 *
 * 运行（**先停止应用**：运行期只追加尾文件，切分期间不得并发写）：
 *   cd app && bun run split:session-events            # 预演
 *   cd app && bun run split:session-events -- --apply
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
// 切块规则是脚本与运行时的**同一实现**（唯一真源 `src/session/storage/eventSegments.ts`）
import {
  EVENT_SEGMENT_MAX_BYTES,
  EVENT_SEGMENT_MAX_LINES,
  eventSegmentFileName,
  listEventSegmentsSync,
  planEventSplit,
} from '../src/session/storage/eventSegments';

export type EventSplitStatus =
  | 'ok'
  | 'missing'
  | 'small'
  | 'empty'
  | 'already-split';

export interface EventSplitPlanItem {
  sessionId: string;
  filePath: string;
  bytes: number;
  lines: number;
  /** 切出的分片数（0 = 不切；活动尾文件不计入） */
  segments: number;
  status: EventSplitStatus;
}

export interface EventSplitOptions {
  apply?: boolean;
  maxBytes?: number;
  maxLines?: number;
  now?: Date;
}

/** 扫描 `<root>/sessions/<partition>/<sessionId>/events.jsonl` 并给出切分计划 */
export function scanSessions(
  root: string,
  options: Pick<EventSplitOptions, 'maxBytes' | 'maxLines'> = {}
): EventSplitPlanItem[] {
  const sessionsRoot = join(root, 'sessions');
  const out: EventSplitPlanItem[] = [];
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
      const filePath = join(dir, 'events.jsonl');
      if (!existsSync(filePath)) continue;
      const bytes = statSync(filePath).size;
      const lines = readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      const item: EventSplitPlanItem = {
        sessionId,
        filePath,
        bytes,
        lines: lines.length,
        segments: 0,
        status: 'ok',
      };
      if (lines.length === 0) {
        item.status = 'empty';
      } else if (listEventSegmentsSync(dir).length > 0) {
        item.status = 'already-split';
      } else if (
        bytes <= (options.maxBytes ?? EVENT_SEGMENT_MAX_BYTES) &&
        lines.length <= (options.maxLines ?? EVENT_SEGMENT_MAX_LINES)
      ) {
        item.status = 'small';
      } else {
        const plan = planEventSplit(
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
 * 执行切分（`apply=false` 只预演）。
 *
 * `events.tail` 重写为原最大 seq（值不变，仅确保与切分结果一致）；
 * `events.idx` 直接删除（字节偏移跨文件后失效，运行期按需重建）。
 */
export function splitSessionEvents(
  root: string,
  options: EventSplitOptions = {}
): { items: EventSplitPlanItem[]; backupDir?: string; applied: number } {
  const items = scanSessions(root, options);
  if (!options.apply) return { items, applied: 0 };

  const targets = items.filter((i) => i.status === 'ok' && i.segments > 0);
  if (targets.length === 0) return { items, applied: 0 };

  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '');
  const backupDir = join(root, 'migrations', `events-split-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  const auditPath = join(backupDir, 'audit.jsonl');

  let applied = 0;
  for (const item of targets) {
    const backupPath = join(backupDir, item.sessionId);
    mkdirSync(backupPath, { recursive: true });
    const backupFile = join(backupPath, 'events.jsonl');
    copyFileSync(item.filePath, backupFile);

    const lines = readFileSync(item.filePath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const plan = planEventSplit(
      lines.map((l) => Buffer.byteLength(l, 'utf-8') + 1),
      options
    );
    const dir = dirname(item.filePath);
    let segNo = 0;
    for (let i = 0; i < plan.chunks.length - 1; i++) {
      const { from, to } = plan.chunks[i];
      segNo += 1;
      writeLinesAtomic(
        join(dir, eventSegmentFileName(segNo)),
        lines.slice(from, to)
      );
    }
    const tail = plan.chunks[plan.chunks.length - 1];
    writeLinesAtomic(item.filePath, lines.slice(tail.from, tail.to));

    // 索引是**单文件绝对字节偏移**，跨文件后失效 ⇒ 删除（运行期按需重建）
    rmSync(join(dir, 'events.idx'), { force: true });
    // tailSeq 不变（最大 seq 仍在活动尾文件），重写为同值仅作一致性兜底
    const maxSeq = lines.reduce((max, line) => {
      const match = line.match(/"seq":(\d+)/);
      const seq = match ? Number.parseInt(match[1], 10) : 0;
      return seq > max ? seq : max;
    }, 0);
    writeFileSync(join(dir, 'events.tail'), String(maxSeq), 'utf-8');

    appendFileSync(
      auditPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: item.sessionId,
        bytes: item.bytes,
        lines: item.lines,
        segments: plan.segments,
        tailLines: tail.to - tail.from,
        maxSeq,
        backup: backupFile,
      })}\n`,
      'utf-8'
    );
    applied += 1;
  }
  return { items, backupDir, applied };
}

const MB = 1024 * 1024;

/** CLI 入口（`--apply` 才写盘；`--root` / `--json` / `--max-bytes` / `--max-lines`） */
function main(): number {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  // 同时支持 `--name value` 与 `--name=value`
  const arg = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = arg(name);
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const root = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const maxBytes = num('--max-bytes', EVENT_SEGMENT_MAX_BYTES);
  const maxLines = num('--max-lines', EVENT_SEGMENT_MAX_LINES);

  const result = splitSessionEvents(root, { apply, maxBytes, maxLines });
  const candidates = result.items.filter(
    (i) => i.status === 'ok' && i.segments > 0
  );

  if (json) {
    console.log(JSON.stringify({ ...result, candidates: candidates.length }));
    return 0;
  }

  console.log(
    `[split:events] root=${root} ${apply ? 'APPLY' : '预演（只读，加 --apply 才写盘）'}`
  );
  for (const item of candidates) {
    console.log(
      `  ${item.sessionId}  ${(item.bytes / MB).toFixed(1)} MB / ${item.lines} 行` +
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
