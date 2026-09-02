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
 * IdleScaleMonitor — 空闲降载监控（P3-5，对标 Hermes gateway/scale_to_zero.py）
 *
 * Hermes 的 scale-to-zero 是云网关"空闲 → 机器休眠 → 唤醒"；桌面应用无此基础设施，
 * 落地为同构的"空闲检测 → 降载回调"：无活跃会话流、无运行任务、且一段时间无 inbound
 * 活动 → 触发 onIdle（默认清理过期临时文件 + 日志），活动恢复自动重置。判定逻辑与
 * Hermes is_idle 一致：active_work_count > 0 || has_live_background_work → 不空闲。
 *
 * 低风险动作：只清理 ~/.pyapp/temp/ 下 mtime 超过阈值的文件（temp 目录语义即"启动时可清理"），
 * 绝不触碰 downloads/attachments/output 等用户数据。
 */

import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { resolveTempDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:idleScale');

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000; // 30 分钟无活动
export const DEFAULT_POLL_MS = 60_000; // 每分钟采样一次
export const DEFAULT_TEMP_MAX_AGE_MS = 24 * 3600_000; // 过期临时文件阈值（24h）

export interface IdleScaleDeps {
  /** 空闲判定阈值（毫秒） */
  idleTimeoutMs?: number;
  /** 采样间隔（毫秒） */
  pollMs?: number;
  /** 活跃工作计数：进行中的会话流 + 运行任务（>0 = 不空闲，Hermes active_work_count） */
  activeWorkCount: () => number;
  /** 是否有存活的后台工作（Hermes has_live_background_work） */
  hasLiveBackgroundWork?: () => boolean;
  /** 空闲回调（默认动作之外可扩展；可异步） */
  onIdle: (idleSeconds: number) => void | Promise<void>;
}

export class IdleScaleMonitor {
  private readonly idleTimeoutMs: number;
  private readonly pollMs: number;
  private lastActivityAt = Date.now();
  private idleFired = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: IdleScaleDeps) {
    this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  /** 启动采样（幂等；timer unref 不阻止进程退出） */
  start(): void {
    if (this.timer) return;
    this.lastActivityAt = Date.now();
    this.idleFired = false;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    if (this.timer && typeof (this.timer as unknown as { unref?: () => void }).unref === 'function') {
      (this.timer as unknown as { unref: () => void }).unref();
    }
    logger.info('IdleScaleMonitor 已启动', {
      idleTimeoutMs: this.idleTimeoutMs,
      pollMs: this.pollMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 有 inbound 活动时由挂载方调用（如新消息到达），重置空闲计时 */
  poke(): void {
    this.lastActivityAt = Date.now();
    this.idleFired = false;
  }

  /** 当前是否已判定空闲 */
  isIdle(): boolean {
    return this.idleFired;
  }

  private poll(): void {
    const active = this.deps.activeWorkCount();
    const hasBackground = this.deps.hasLiveBackgroundWork?.() ?? false;
    if (active > 0 || hasBackground) {
      // 有工作 = 不空闲，且视为活动（Hermes：idle 判定失败保持唤醒）
      this.poke();
      return;
    }
    const idleMs = Date.now() - this.lastActivityAt;
    if (idleMs >= this.idleTimeoutMs && !this.idleFired) {
      this.idleFired = true;
      const idleSeconds = Math.round(idleMs / 1000);
      logger.info('系统空闲超过阈值，触发降载', {
        idleSeconds,
        idleTimeoutMs: this.idleTimeoutMs,
      });
      void Promise.resolve(this.deps.onIdle(idleSeconds)).catch((err) => {
        logger.warn('IdleScale onIdle 回调异常', { error: String(err) });
      });
    }
  }
}

/**
 * 默认降载动作：清理过期临时文件（~/.pyapp/temp/ 下 mtime 超过 maxAgeMs 的文件）。
 * 失败不影响主功能（CS03）；temp 目录不存在视为无事可做。
 */
export async function cleanupStaleTempFiles(
  maxAgeMs: number = DEFAULT_TEMP_MAX_AGE_MS
): Promise<number> {
  const tempDir = resolveTempDir();
  let removed = 0;
  try {
    const entries = await readdir(tempDir);
    const now = Date.now();
    for (const name of entries) {
      const full = join(tempDir, name);
      try {
        const st = await stat(full);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > maxAgeMs) {
          await unlink(full);
          removed++;
        }
      } catch {
        // 单个文件 stat/unlink 失败不影响其余清理
      }
    }
  } catch {
    // 目录不存在或无权限：无事可做
    return 0;
  }
  if (removed > 0) {
    logger.info('空闲降载：清理过期临时文件', { tempDir, removed, maxAgeMs });
  }
  return removed;
}
