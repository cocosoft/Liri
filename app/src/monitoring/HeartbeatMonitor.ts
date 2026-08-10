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
 * 监控心跳自检
 *
 * 各监控模块启动时注册，每 5 分钟输出心跳日志。
 * 外部通过 check() 检测超时模块，发现后触发告警。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('monitoring:heartbeat');

export interface HeartbeatEntry {
  module: string;
  lastBeat: number;
  degraded?: boolean;
}

export class HeartbeatMonitor {
  private modules = new Map<string, HeartbeatEntry>();
  private interval: ReturnType<typeof setInterval> | null = null;

  /** 心跳超时阈值（毫秒） */
  beatTimeout = 5 * 60 * 1000;

  /** 心跳间隔（毫秒） */
  beatInterval = 5 * 60 * 1000;

  /**
   * 注册监控模块
   * @param module 模块名称
   * @param options 额外状态（如 degraded: true 表示降级启动）
   */
  register(module: string, options?: { degraded?: boolean }): void {
    const entry: HeartbeatEntry = {
      module,
      lastBeat: Date.now(),
      degraded: options?.degraded ?? false,
    };
    this.modules.set(module, entry);

    if (entry.degraded) {
      logger.warn(`[MONITOR_HEARTBEAT] ${module} 降级启动`, { module });
    } else {
      logger.info(`[MONITOR_HEARTBEAT] ${module} started`, { module });
    }
  }

  /**
   * 更新心跳时间戳
   * @param module 模块名称
   */
  beat(module: string): void {
    const entry = this.modules.get(module);
    if (entry) {
      entry.lastBeat = Date.now();
    }
  }

  /**
   * 启动定时心跳输出与自检
   */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      const dead = this.check();
      for (const mod of this.modules.values()) {
        logger.info(
          `[MONITOR_HEARTBEAT] ${mod.module} alive${mod.degraded ? ' (degraded)' : ''}`,
          {
            module: mod.module,
            degraded: mod.degraded,
          }
        );
      }
      if (dead.length > 0) {
        logger.error(
          `[MONITOR_HEARTBEAT] 以下监控模块超时: ${dead.join(', ')}`,
          { deadModules: dead }
        );
      }
    }, this.beatInterval);

    if (typeof this.interval.unref === 'function') {
      this.interval.unref();
    }
  }

  /**
   * 停止定时自检
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * 检查是否有监控模块心跳超时
   * @returns 超时的模块名列表
   */
  check(): string[] {
    const now = Date.now();
    const dead: string[] = [];
    for (const [name, entry] of this.modules) {
      if (now - entry.lastBeat > this.beatTimeout) {
        dead.push(name);
      }
    }
    return dead;
  }

  /**
   * 获取所有注册模块状态
   */
  getModules(): ReadonlyMap<string, HeartbeatEntry> {
    return this.modules;
  }

  // ── 单例 ──

  private static instance: HeartbeatMonitor | null = null;

  static getInstance(): HeartbeatMonitor {
    if (!HeartbeatMonitor.instance) {
      HeartbeatMonitor.instance = new HeartbeatMonitor();
    }
    return HeartbeatMonitor.instance;
  }
}
