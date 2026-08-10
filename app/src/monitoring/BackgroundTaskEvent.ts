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
 * BackgroundTaskEvent — 统一后台任务事件（§9.3 阶段 2）
 *
 * R08-002 的配套实现：后台任务统一记录 start / skip(原因) / fail(错误) / complete(结果)
 * 四态事件。日志统一命名 `[background:{task}] {phase}`，并追加写入
 * `~/.pyapp/data/background/tasks.jsonl` 供运行状况面板聚合读取。
 */

import fs from 'fs';
import path from 'path';
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('observability:background-task');

export type BackgroundTaskPhase = 'start' | 'skip' | 'fail' | 'complete';

export interface BackgroundTaskEvent {
  /** 任务名（如 dream / knowledge-compile / memory-archive） */
  task: string;
  phase: BackgroundTaskPhase;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** skip 原因 / fail 错误 / complete 结果摘要 */
  status?: string;
  metadata?: Record<string, unknown>;
}

const TASK_LOG_DIR = 'background';
const TASK_LOG_FILE = 'tasks.jsonl';

function taskLogPath(): string {
  return path.join(resolveDataSubDir(TASK_LOG_DIR), TASK_LOG_FILE);
}

/**
 * 统一记录后台任务事件（四态日志 + 追加 JSONL）。
 * 按 R08-002：skip / fail 至少 warn 级。
 */
export function recordBackgroundTask(event: BackgroundTaskEvent): void {
  const base = {
    task: event.task,
    phase: event.phase,
    durationMs: event.durationMs,
    status: event.status,
    ...event.metadata,
  };

  if (event.phase === 'skip' || event.phase === 'fail') {
    logger.warn(`[background:${event.task}] ${event.phase}`, base);
  } else {
    logger.info(`[background:${event.task}] ${event.phase}`, base);
  }

  try {
    const dir = resolveDataSubDir(TASK_LOG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, TASK_LOG_FILE),
      `${JSON.stringify(event)}\n`
    );
  } catch (e) {
    // @ignore-catch — 事件日志写入失败不阻断任务本身
    logger.warn('写入后台任务事件日志失败', { error: String(e) });
  }
}

/** 读取最近的后台任务事件（按时间倒序，limit 条） */
export function getBackgroundTaskLog(limit = 20): BackgroundTaskEvent[] {
  try {
    const raw = fs.readFileSync(taskLogPath(), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const events = lines
      .map((l) => {
        try {
          return JSON.parse(l) as BackgroundTaskEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is BackgroundTaskEvent => e !== null);
    return events.slice(-limit).reverse();
  } catch {
    return [];
  }
}
