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
 * P3-2.12: AlertBridge — 告警抑制 + 级别路由 + 通道分发
 *
 * 订阅 error:occurred / alert:triggered EventBus 事件，
 * 实现去重抑制 → 级别路由 → 通道分发告警管线。
 *
 * 告警规则（6 条）：
 *   1. CRITICAL 错误突增: 1 分钟内 CRITICAL ≥ 3 → P1
 *   2. Token 消耗异常: 单次 Token > 预算 80% → P1
 *   3. LLM 延迟高: P99 > 30s → P2
 *   4. Trace 磁盘高: ~/.pyapp/data/traces/ > 1GB → P2
 *   5. 心跳丢失: [MONITOR_HEARTBEAT] 超 5 分钟 → P1
 *   6. OTel Exporter 失败: OTLP 连续失败 5 次 → P2
 */

import { createLogger, LogLevel } from '../logs/Logger';
import { globalEventBus } from '../../core/events/EventBus';

const logger = createLogger({
  module: 'monitoring:alerts',
  level: LogLevel.WARN,
});

interface AlertEvent {
  errorId?: string;
  module?: string;
  message?: string;
  severity?: string;
  category?: string;
  code?: string;
  timestamp?: number;
}

export class AlertBridge {
  /** 最近告警抑制表（key → last timestamp） */
  private recentAlerts = new Map<string, number>();

  /** 抑制窗口（毫秒） */
  private suppressWindow = 5 * 60 * 1000;

  /** CRITICAL 错误计数器（用于规则 1: 1 分钟内 ≥ 3 次触发 P1） */
  private criticalCount = 0;
  private criticalCountResetTime = Date.now();

  private initialized = false;

  /**
   * 初始化告警桥接
   * 订阅 error:occurred 和 alert:triggered 事件
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    globalEventBus.subscribe('error:occurred', (event: unknown) => {
      this.handleError(event as AlertEvent);
    });
    globalEventBus.subscribe('alert:triggered', (event: unknown) => {
      this.handleAlert(event as AlertEvent);
    });

    logger.info(
      'AlertBridge 已初始化（订阅 error:occurred + alert:triggered）'
    );
  }

  // ── 规则 1: CRITICAL 错误突增 ──

  private handleError(event: AlertEvent): void {
    // 重置计数器窗口（1 分钟）
    const now = Date.now();
    if (now - this.criticalCountResetTime > 60_000) {
      this.criticalCount = 0;
      this.criticalCountResetTime = now;
    }

    if (event.severity === 'CRITICAL') {
      this.criticalCount++;
      if (this.criticalCount >= 3) {
        this.route(
          {
            module: event.module || 'unknown',
            message: `CRITICAL 错误突增: ${this.criticalCount} 次/分钟`,
          },
          'P1'
        );
        this.criticalCount = 0; // 防止重复触发
      }
    }

    // 抑制去重：同一 errorId 5 分钟内不重复告警
    if (this.isSuppressed(event.errorId || event.code || 'unknown')) return;

    const level =
      event.severity === 'CRITICAL' || event.severity === 'HIGH' ? 'P1' : 'P2';
    this.route(
      {
        module: event.module || 'unknown',
        message: `[${event.severity}] ${event.category}: ${event.message || ''}`,
      },
      level
    );
  }

  // ── 通用告警处理 ──

  private handleAlert(event: AlertEvent): void {
    if (this.isSuppressed(event.errorId || event.code || 'unknown')) return;
    this.route(event, 'P1');
  }

  // ── 抑制检查 ──

  private isSuppressed(key: string): boolean {
    const last = this.recentAlerts.get(key);
    const now = Date.now();
    if (last && now - last < this.suppressWindow) {
      return true;
    }
    this.recentAlerts.set(key, now);

    // 清理过期条目
    if (this.recentAlerts.size > 500) {
      const expired = now - this.suppressWindow;
      for (const [k, t] of this.recentAlerts) {
        if (t < expired) this.recentAlerts.delete(k);
      }
    }

    return false;
  }

  // ── 路由分发 ──

  private route(event: AlertEvent, level: 'P1' | 'P2'): void {
    const fullMessage = `[${level}] [${event.module || 'unknown'}] ${event.message || ''}`;

    if (level === 'P1') {
      // P1: 即时通知 → 发布到 channel:send（由各通道适配器消费）
      globalEventBus.publish('channel:send', {
        channel: 'system',
        message: fullMessage,
        timestamp: Date.now(),
      });
      logger.error(`[ALERT] ${fullMessage}`);
    } else {
      // P2: 聚合报告 → 仅记录日志
      logger.warn(`[ALERT] ${fullMessage}`);
    }
  }
}

/** 全局单例 */
let bridge: AlertBridge | null = null;

export function getAlertBridge(): AlertBridge {
  if (!bridge) {
    bridge = new AlertBridge();
  }
  return bridge;
}
