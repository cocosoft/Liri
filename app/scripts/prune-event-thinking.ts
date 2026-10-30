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
 * C（2026-10-30）：事件流 `assistant/thinking` **按轮清理**工具。
 *
 * 口径与不变量见唯一实现 `src/session/storage/eventThinkingPrune.ts`（CS01：脚本不重写规则）。
 * 本脚本只负责：枚举会话 → 逐文件预演/执行 → 备份 + `audit.jsonl` → 打印。
 *
 * 安全边界：
 *  - **默认只读预演**，只有 `--apply` 才写盘；
 *  - `--apply` 先把原文件整份备份到 `<root>/migrations/events-thinking-prune-<ts>/<sessionId>/`，
 *    并逐条写 `audit.jsonl`（回滚 = 用备份覆盖 `events.jsonl` 并删 `events.idx`）；
 *  - 活跃会话跳过（`events.jsonl` 的 `mtime` 在 `--idle-minutes` 窗口内）—— 读写并发时
 *    不碰真源；
 *  - 只删**更早轮次**的 thinking，`seq` 不重排、最大 seq 行永不删（详见实现文件不变量）。
 *
 * 运行（建议先停止应用）：
 *   cd app && bun run prune:event-thinking                       # 预演
 *   cd app && bun run prune:event-thinking -- --apply            # 执行（保留最近 10 轮）
 *   cd app && bun run prune:event-thinking -- --apply --keep-turns=3
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// 清理规则是脚本与运行时的**同一实现**（唯一真源）
import {
  DEFAULT_THINKING_IDLE_MINUTES,
  DEFAULT_THINKING_KEEP_TURNS,
  pruneEventThinkingFile,
  type ThinkingPruneFileResult,
} from '../src/session/storage/eventThinkingPrune';

export interface PruneThinkingOptions {
  apply?: boolean;
  keepTurns?: number;
  idleMinutes?: number;
  now?: Date;
}

export interface PruneThinkingResult {
  items: ThinkingPruneFileResult[];
  backupDir?: string;
  applied: number;
}

/** 递归收集 `<root>/sessions/<partition>/<sessionId>/events.jsonl` */
export function collectEventLogFiles(root: string): string[] {
  const sessionsRoot = join(root, 'sessions');
  const out: string[] = [];
  let partitions: string[];
  try {
    partitions = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // @ignore-catch 目录不存在 ⇒ 无可清理会话
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
      const filePath = join(partitionDir, sessionId, 'events.jsonl');
      if (existsSync(filePath)) out.push(filePath);
    }
  }
  return out;
}

/**
 * 扫描并（可选）执行清理。
 *
 * @returns `items` 为逐会话结果；`apply=false` 时 `applied` 恒为 0 且不建备份目录
 */
export function pruneEventThinking(
  root: string,
  options: PruneThinkingOptions = {}
): PruneThinkingResult {
  const nowDate = options.now ?? new Date();
  const nowMs = nowDate.getTime();
  const idleMs = Math.max(
    0,
    (options.idleMinutes ?? DEFAULT_THINKING_IDLE_MINUTES) * 60_000
  );
  const backupDir = join(
    root,
    'migrations',
    `events-thinking-prune-${nowDate.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`
  );

  const files = collectEventLogFiles(root);
  const items: ThinkingPruneFileResult[] = [];
  const audit: string[] = [];
  let applied = 0;

  for (const filePath of files) {
    const sessionId = filePath.split(/[\\/]/).slice(-2, -1)[0];
    const result = pruneEventThinkingFile({
      filePath,
      sessionId,
      apply: options.apply === true,
      ...(options.keepTurns !== undefined
        ? { keepTurns: options.keepTurns }
        : {}),
      idleMs,
      now: nowMs,
      backupDir,
    });
    if (result.applied && result.plan) {
      applied += 1;
      audit.push(
        JSON.stringify({
          ts: new Date(nowMs).toISOString(),
          sessionId,
          file: filePath,
          bytesBefore: result.bytesBefore,
          bytesAfter: result.bytesAfter,
          eventsBefore: result.plan.totalEvents,
          eventsAfter: result.plan.remainingEvents,
          prunedThinkingEvents: result.plan.prunableEvents,
          keepTurns: options.keepTurns ?? DEFAULT_THINKING_KEEP_TURNS,
          keepFromTurn: result.plan.keepFromTurn,
          maxTurn: result.plan.maxTurn,
          maxSeq: result.plan.maxSeq,
          backup: result.backupPath,
        })
      );
    }
    items.push(result);
  }

  if (applied > 0) {
    mkdirSync(backupDir, { recursive: true });
    appendFileSync(join(backupDir, 'audit.jsonl'), `${audit.join('\n')}\n`, {
      encoding: 'utf-8',
    });
  }

  return {
    items,
    applied,
    ...(applied > 0 ? { backupDir } : {}),
  };
}

const MB = 1024 * 1024;

/** CLI 入口（`--apply` 才写盘；`--root` / `--json` / `--keep-turns` / `--idle-minutes`） */
function main(): number {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const keepTurns = arg('--keep-turns')
    ? Number.parseInt(arg('--keep-turns')!, 10)
    : DEFAULT_THINKING_KEEP_TURNS;
  const idleMinutes = arg('--idle-minutes')
    ? Number.parseInt(arg('--idle-minutes')!, 10)
    : DEFAULT_THINKING_IDLE_MINUTES;

  const result = pruneEventThinking(root, { apply, keepTurns, idleMinutes });
  const candidates = result.items.filter(
    (i) => i.status === 'ok' && (i.plan?.prunableEvents ?? 0) > 0
  );

  if (json) {
    console.log(JSON.stringify({ ...result, candidates: candidates.length }));
    return 0;
  }

  console.log(
    `[prune:event-thinking] root=${root} ${apply ? 'APPLY' : '预演（只读，加 --apply 才写盘）'} keepTurns=${keepTurns}`
  );
  for (const item of candidates) {
    const plan = item.plan!;
    console.log(
      `  ${item.sessionId}  ${(item.bytesBefore / MB).toFixed(1)} MB ⇒ ` +
        `${(item.bytesAfter / MB).toFixed(1)} MB（-${(plan.prunableBytes / MB).toFixed(1)} MB）` +
        ` 轮次 ${plan.keepFromTurn}..${plan.maxTurn} 保留 / ` +
        `${plan.prunableEvents} 条 thinking 清理（共 ${plan.totalEvents} 事件）`
    );
  }
  const skipped = result.items.filter(
    (i) => i.status !== 'ok' || (i.plan?.prunableEvents ?? 0) === 0
  );
  const byStatus = new Map<string, number>();
  for (const s of skipped) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  const freedMb = candidates.reduce(
    (sum, i) => sum + ((i.plan?.prunableBytes ?? 0) || 0),
    0
  );
  console.log(
    `  可清理：${candidates.length} 个会话 / ${(freedMb / MB).toFixed(1)} MB thinking；` +
      `跳过：${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(' / ') || '无'}`
  );
  if (apply) {
    console.log(
      `  已清理 ${result.applied} 个会话；备份 + 审计：${result.backupDir}`
    );
  }
  return 0;
}

// 仅作为入口脚本执行时才跑 main（被测试 import 时不产生副作用）
if (import.meta.main) {
  process.exit(main());
}
