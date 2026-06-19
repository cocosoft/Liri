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
 * DreamIdleDetector — 梦境空闲检测器
 *
 * 独立于守护进程，通过 EventBus 监听用户交互事件判断系统空闲状态。
 * 不依赖 Daemon 心跳，低频轮询（每分钟一次）。
 */

import { globalEventBus, SystemEvents } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export class DreamIdleDetector {
  private lastActivity = Date.now();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs: number;
  private idleThresholdMs: number;

  constructor(
    idleThresholdMs: number = 15 * 60 * 1000,
    checkIntervalMs: number = 60_000
  ) {
    this.idleThresholdMs = idleThresholdMs;
    this.checkIntervalMs = checkIntervalMs;
  }

  /** 获取当前空闲时长（毫秒） */
  getIdleDuration(): number {
    return Date.now() - this.lastActivity;
  }

  /** 设置最后活动时间（外部更新用） */
  updateActivity(timestamp: number = Date.now()): void {
    this.lastActivity = timestamp;
  }

  /**
   * 开始空闲检测
   * @param onIdle 当空闲时长超过阈值时回调
   */
  start(onIdle: (duration: number) => void): void {
    // 订阅用户交互事件
    globalEventBus.subscribe(SystemEvents.USER_INTERACTION, () => {
      this.lastActivity = Date.now();
    });

    // 独立的检测循环，低频轮询
    this.checkTimer = setInterval(() => {
      const idleDuration = this.getIdleDuration();
      if (idleDuration >= this.idleThresholdMs) {
        logger.info(
          `[DreamIdleDetector] 系统已空闲 ${Math.round(idleDuration / 1000)}s，触发梦境`
        );
        onIdle(idleDuration);
      }
    }, this.checkIntervalMs);

    // 不阻止进程退出
    if (this.checkTimer && 'unref' in this.checkTimer) {
      this.checkTimer.unref();
    }

    logger.info(
      `[DreamIdleDetector] 已启动，空闲阈值 ${this.idleThresholdMs / 1000}s，检查间隔 ${this.checkIntervalMs / 1000}s`
    );
  }

  /** 停止检测 */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    logger.info('[DreamIdleDetector] 已停止');
  }
}
