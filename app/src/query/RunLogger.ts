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
 * RunLogger — Agent 循环运行日志记录器
 *
 * Phase 2 新增。对标 loop-engineering-main 的 loop-run-log.md。
 * 在每次 TAORLoop.run() 结束时记录结构化运行数据到 JSONL 文件。
 * 使用 Promise 链写入队列串行化，防止并发写入交错。
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDir } from '@modules/core/paths';

/** 停止原因类型 */
type StopReason = 'completed' | 'aborted' | 'error' | 'timeout' | 'max_turns';

/** 运行日志条目 */
interface RunLogEntry {
  runId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  turnCount: number;
  reason: StopReason;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cacheRead: number;
    cacheCreation: number;
  };
  toolCalls: {
    total: number;
    unique: number;
    failed: number;
    topTools: Array<{ name: string; count: number }>;
  };
  compressions: {
    count: number;
    totalTokensSaved: number;
    avgRatio: number;
  };
  loopDetections: {
    warnings: number;
    criticals: number;
  };
  errorRecoveries: {
    count: number;
    byType: Record<string, number>;
  };
  cost: {
    estimatedUsd: number;
    modelName: string;
  };
  featureFlags: {
    phase1: boolean;
    phase2: boolean;
  };
}

/** 默认日志目录 */
function getRunLogsDir(): string {
  return join(resolveDataDir(), 'run-logs');
}

/** 当天日志文件路径 */
function getDailyLogPath(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(getRunLogsDir(), `${today}.jsonl`);
}

export class RunLogger {
  private writeQueue: Promise<void> = Promise.resolve();
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? getRunLogsDir();
  }

  /**
   * 记录一条运行日志
   * 使用 Promise 链串行化写入，防止多会话并发交错。
   * .catch() 确保 writeQueue 始终 resolved，后续写入不会被阻断。
   */
  async record(entry: RunLogEntry): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() => this._ensureDir())
      .then(() => this._appendToFile(entry))
      .catch((err) => {
        // 日志写入失败不应影响主流程，使用 process.stderr 避免循环依赖 Logger
        process.stderr.write(`[RunLogger] write failed: ${String(err)}\n`);
      });
    return this.writeQueue;
  }

  /**
   * 确保日志目录存在
   */
  private async _ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /**
   * 追加一行 JSON 到当天日志文件
   */
  private async _appendToFile(entry: RunLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await appendFile(getDailyLogPath(), line, 'utf-8');
  }

  /**
   * 生成运行 ID
   */
  static generateRunId(sessionId: string): string {
    return `run_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

/** 工厂函数 */
export function createRunLogger(dir?: string): RunLogger {
  return new RunLogger(dir);
}
