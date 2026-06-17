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
 * MCP 自动重连管理器
 *
 * 支持：
 *   - 指数退避重连策略
 *   - 工具列表漂移检测
 *   - 可配置的重连策略（identity 接受 / append 可选接受）
 *
 * 借鉴: DeepSeek-Reasonix src/mcp/reconnect.ts
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { classifyToolListDrift, isDriftAcceptable } from './drift';
import type { DriftKind, McpToolSpec } from './drift';

const logger = new Logger();

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** MCP 客户端接口（重连所需的最小接口） */
export interface McpClientLike {
  initialize(): Promise<void>;
  listTools(): Promise<{ tools: McpToolSpec[] }>;
  close(): Promise<void>;
}

/** 重连配置 */
export interface ReconnectConfig {
  /** 最大重连次数 */
  maxRetries?: number;
  /** 初始退避延迟（毫秒） */
  initialDelayMs?: number;
  /** 退避倍数 */
  backoffMultiplier?: number;
  /** 最大退避延迟（毫秒） */
  maxDelayMs?: number;
  /** 可接受的漂移类型 */
  acceptDrift?: ReadonlyArray<'identity' | 'append'>;
  /** 重连超时（毫秒） */
  timeoutMs?: number;
}

/** 重连结果 */
export type ReconnectResult =
  | {
      ok: true;
      kind: DriftKind;
      afterTools: McpToolSpec[];
      addedTools: McpToolSpec[];
      attemptCount: number;
      totalMs: number;
    }
  | {
      ok: false;
      reason: 'handshake' | 'drift_rejected' | 'max_retries' | 'timeout';
      message: string;
      attemptCount: number;
      totalMs: number;
    };

/** 默认重连配置 */
const DEFAULT_RECONNECT_CONFIG: Required<ReconnectConfig> = {
  maxRetries: 5,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
  acceptDrift: ['identity'],
  timeoutMs: 60_000,
};

// ─── 重连管理器 ──────────────────────────────────────────────────────────────

/**
 * MCP 自动重连管理器
 */
export class McpReconnectManager {
  private config: Required<ReconnectConfig>;

  constructor(config: ReconnectConfig = {}) {
    this.config = { ...DEFAULT_RECONNECT_CONFIG, ...config };
  }

  /**
   * 执行重连循环
   *
   * @param clientFactory 创建新客户端的工厂函数
   * @param beforeTools 重连前的工具列表（用于漂移检测）
   * @param onSwap 成功重连后，替换旧客户端的回调
   */
  async reconnect(
    clientFactory: () => Promise<McpClientLike>,
    beforeTools: readonly McpToolSpec[],
    onSwap: (newClient: McpClientLike) => Promise<void>
  ): Promise<ReconnectResult> {
    const t0 = Date.now();
    let attemptCount = 0;
    let delay = this.config.initialDelayMs;

    while (attemptCount < this.config.maxRetries) {
      attemptCount++;

      // 检查总超时
      if (Date.now() - t0 > this.config.timeoutMs) {
        return {
          ok: false,
          reason: 'timeout',
          message: `Reconnect timed out after ${this.config.timeoutMs}ms`,
          attemptCount,
          totalMs: Date.now() - t0,
        };
      }

      try {
        const client = await clientFactory();
        await client.initialize();
        const listed = await client.listTools();

        const drift = classifyToolListDrift(beforeTools, listed.tools);

        if (!isDriftAcceptable(drift.kind, this.config.acceptDrift)) {
          await client.close().catch(() => {});
          return {
            ok: false,
            reason: 'drift_rejected',
            message: `Drift rejected: ${drift.summary}`,
            attemptCount,
            totalMs: Date.now() - t0,
          };
        }

        const addedTools =
          drift.kind === 'append'
            ? listed.tools.filter((t) => drift.added.includes(t.name))
            : [];

        await onSwap(client);

        logger.info('MCP reconnect succeeded', {
          kind: drift.kind,
          attemptCount,
          addedTools: addedTools.length,
        });

        return {
          ok: true,
          kind: drift.kind,
          afterTools: listed.tools,
          addedTools,
          attemptCount,
          totalMs: Date.now() - t0,
        };
      } catch (err) {
        logger.warn('MCP reconnect attempt failed', {
          attempt: attemptCount,
          error: (err as Error).message,
        });

        if (attemptCount >= this.config.maxRetries) {
          return {
            ok: false,
            reason: 'max_retries',
            message: `All ${attemptCount} reconnect attempts failed: ${(err as Error).message}`,
            attemptCount,
            totalMs: Date.now() - t0,
          };
        }

        // 指数退避
        await sleep(delay);
        delay = Math.min(
          delay * this.config.backoffMultiplier,
          this.config.maxDelayMs
        );
      }
    }

    return {
      ok: false,
      reason: 'max_retries',
      message: `Exhausted ${attemptCount} reconnect attempts`,
      attemptCount,
      totalMs: Date.now() - t0,
    };
  }

  /**
   * 单次重连尝试（不重试）
   */
  async tryReconnect(
    clientFactory: () => Promise<McpClientLike>,
    beforeTools: readonly McpToolSpec[]
  ): Promise<ReconnectResult> {
    const t0 = Date.now();
    try {
      const client = await clientFactory();
      await client.initialize();
      const listed = await client.listTools();

      const drift = classifyToolListDrift(beforeTools, listed.tools);

      if (!isDriftAcceptable(drift.kind, this.config.acceptDrift)) {
        await client.close().catch(() => {});
        return {
          ok: false,
          reason: 'drift_rejected',
          message: `Drift rejected: ${drift.summary}`,
          attemptCount: 1,
          totalMs: Date.now() - t0,
        };
      }

      await client.close().catch(() => {});
      return {
        ok: true,
        kind: drift.kind,
        afterTools: listed.tools,
        addedTools: [],
        attemptCount: 1,
        totalMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'handshake',
        message: (err as Error).message,
        attemptCount: 1,
        totalMs: Date.now() - t0,
      };
    }
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
