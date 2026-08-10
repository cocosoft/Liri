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
 * ExitRecorder — 进程退出信息记录（根因 C）
 *
 * 记录进程上次退出码/退出时间/退出原因到 `~/.pyapp/data/last-exit.json`，
 * 启动时读取并输出日志，用于区分"手动/正常退出" vs "崩溃退出"。
 * 崩溃恢复（CrashRecoveryManager）把 RUNNING 会话标记 PAUSED 时，
 * 配合退出记录可判断是否真的发生了异常退出。
 */

import fs from 'fs';
import path from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:exit');

export type ExitReason =
  | 'normal'
  | 'graceful'
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'unknown';

export interface ExitRecord {
  code: number;
  reason: ExitReason;
  exitAt: string;
  pid: number;
  uptimeMs: number;
  message?: string;
}

function exitFile(): string {
  return path.join(resolveDataDir(), 'last-exit.json');
}

/** 记录当前进程退出信息（同步写盘，保证退出前完成） */
export function recordExit(
  reason: ExitReason,
  code: number,
  message?: string
): void {
  try {
    const record: ExitRecord = {
      code,
      reason,
      exitAt: new Date().toISOString(),
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      message,
    };
    fs.writeFileSync(exitFile(), JSON.stringify(record, null, 2));
  } catch (e) {
    // @ignore-catch — 退出记录失败不阻断退出流程，仅告警
    logger.warn('写入退出记录失败', { error: String(e) });
  }
}

/** 读取上次退出信息；无记录时返回 null */
export function readLastExit(): ExitRecord | null {
  try {
    const raw = fs.readFileSync(exitFile(), 'utf-8');
    return JSON.parse(raw) as ExitRecord;
  } catch {
    return null;
  }
}

/** 判定上次退出是否为异常（崩溃/非零退出码） */
export function isAbnormalExit(record: ExitRecord): boolean {
  if (record.code !== 0) return true;
  return (
    record.reason === 'uncaughtException' ||
    record.reason === 'unhandledRejection' ||
    record.reason === 'unknown'
  );
}

/** 启动时输出上次退出信息日志，区分正常 vs 崩溃退出 */
export function logStartupContext(): void {
  const last = readLastExit();
  if (!last) {
    logger.info('上次退出记录：无（首次启动或记录已清理）');
    return;
  }
  const abnormal = isAbnormalExit(last);
  const message = `上次退出信息（${abnormal ? '异常退出' : '正常退出'}）`;
  if (abnormal) {
    logger.warn(message, {
      reason: last.reason,
      code: last.code,
      exitAt: last.exitAt,
      uptimeMs: last.uptimeMs,
    });
  } else {
    logger.info(message, {
      reason: last.reason,
      code: last.code,
      exitAt: last.exitAt,
      uptimeMs: last.uptimeMs,
    });
  }
}

/**
 * 安装退出监听（main.ts 启动早期调用）
 * - beforeExit：正常/常规退出路径（code 0）
 * - SIGINT/SIGTERM：手动优雅关闭
 * - uncaughtException / unhandledRejection：异常兜底记录
 */
export function installExitRecorder(): void {
  process.on('beforeExit', (code) => {
    recordExit(code === 0 ? 'normal' : 'unknown', code);
  });
  process.on('SIGINT', () => recordExit('graceful', 0, 'SIGINT'));
  process.on('SIGTERM', () => recordExit('graceful', 0, 'SIGTERM'));
  process.on('uncaughtException', (error: Error) => {
    recordExit('uncaughtException', 1, error?.message ?? String(error));
  });
  process.on('unhandledRejection', (reason: unknown) => {
    recordExit(
      'unhandledRejection',
      1,
      reason instanceof Error ? reason.message : String(reason)
    );
  });
}
