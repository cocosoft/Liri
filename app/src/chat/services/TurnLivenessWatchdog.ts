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
 * TurnLivenessWatchdog — 会话 turn 卡死看门狗（P3-3，对标 Hermes agent/turn_liveness.py）
 *
 * 背景（对应 hermes #95548）：会话 turn 可能在"模型返回 tool_calls 后、工具执行前"
 * 或"LLM 流静默挂起"处卡死——无错误日志、无进一步产出，会话锁（SimpleMutex）一直
 * 持有，用户只能干等。既有防线：P14 loopGuard 循环级 no_progress 熔断、P1-a
 * withToolTimeout 工具超时诊断，但缺"turn 整体静默"的采样看门狗兜底。
 *
 * 机制：turn 生命周期内采样活动时钟（每次产出 chunk 由挂载方 touch），
 * 超过 timeoutMs 无活动 → 触发 onStall 回调（挂载方负责中断 + 日志 + 用户可见提示）。
 * 每次 touch 复位，因此长任务（如 375s 工具循环）只要持续有产出就不会被误判。
 *
 * 配置（环境变量，与 Hermes config.yaml turn_liveness 对齐的语义）：
 *   TURN_LIVENESS_TIMEOUT_MS  空闲判定阈值（默认 600000 = 10 分钟；<=0 关闭看门狗）
 *   TURN_LIVENESS_POLL_MS     采样间隔（默认 15000，最小 1000）
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat:TurnLivenessWatchdog');

export const DEFAULT_LIVENESS_TIMEOUT_MS = 600_000;
export const DEFAULT_LIVENESS_POLL_MS = 15_000;
const MIN_POLL_MS = 100;

export interface LivenessSnapshot {
  sessionId?: string;
  idleSeconds: number;
  lastActivityAt: number | null;
}

export interface TurnLivenessOptions {
  /** 空闲判定阈值（毫秒），默认读环境变量 TURN_LIVENESS_TIMEOUT_MS，兜底 600s */
  timeoutMs?: number;
  /** 采样间隔（毫秒），默认读环境变量 TURN_LIVENESS_POLL_MS，兜底 15s */
  pollMs?: number;
  /** 卡死回调（挂载方提供中断 + 日志动作） */
  onStall: (snapshot: LivenessSnapshot) => void;
}

/** 解析空闲阈值：环境变量优先，非正数/非数字回退默认值（对标 Hermes 配置校验，绝不静默禁用） */
export function resolveLivenessTimeout(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['TURN_LIVENESS_TIMEOUT_MS']?.trim();
  if (!raw) return DEFAULT_LIVENESS_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn('TURN_LIVENESS_TIMEOUT_MS 非法（回退默认 600s）', { raw });
    return DEFAULT_LIVENESS_TIMEOUT_MS;
  }
  return value;
}

/** 解析采样间隔：环境变量优先，非法/过小回退默认（对标 Hermes MIN_TURN_LIVENESS_POLL_S） */
export function resolveLivenessPoll(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['TURN_LIVENESS_POLL_MS']?.trim();
  if (!raw) return DEFAULT_LIVENESS_POLL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_POLL_MS) {
    logger.warn('TURN_LIVENESS_POLL_MS 非法（回退默认 15s）', { raw });
    return DEFAULT_LIVENESS_POLL_MS;
  }
  return value;
}

export class TurnLivenessWatchdog {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private lastActivityAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private surfaced = false;
  private sessionId: string | undefined;

  constructor(private readonly options: TurnLivenessOptions) {
    this.timeoutMs = options.timeoutMs ?? resolveLivenessTimeout();
    this.pollMs = Math.max(MIN_POLL_MS, options.pollMs ?? resolveLivenessPoll());
  }

  /** 启动采样（幂等）。turn 开始后调用；首次 touch 前的活动时钟以 start 时刻为准。 */
  start(sessionId?: string): void {
    if (this.timer) return;
    this.sessionId = sessionId;
    this.lastActivityAt = Date.now();
    this.surfaced = false;
    this.timer = setInterval(() => this.check(), this.pollMs);
    // 不阻止进程退出
    if (this.timer && typeof (this.timer as unknown as { unref?: () => void }).unref === 'function') {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  /** 有产出时由挂载方调用（每次 yield 一次），复位空闲计时并允许重新触发 onStall */
  touch(): void {
    this.lastActivityAt = Date.now();
    this.surfaced = false;
  }

  /** 停止采样（turn 结束，幂等） */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private check(): void {
    if (this.lastActivityAt === null) {
      this.lastActivityAt = Date.now();
      return;
    }
    const idleMs = Date.now() - this.lastActivityAt;
    if (idleMs >= this.timeoutMs && !this.surfaced) {
      this.surfaced = true;
      const snapshot: LivenessSnapshot = {
        sessionId: this.sessionId,
        idleSeconds: Math.round(idleMs / 1000),
        lastActivityAt: this.lastActivityAt,
      };
      logger.error('Turn liveness watchdog fired（无产出超过阈值，尝试中断）', {
        sessionId: this.sessionId ?? null,
        idleSeconds: snapshot.idleSeconds,
        timeoutMs: this.timeoutMs,
      });
      try {
        this.options.onStall(snapshot);
      } catch (err) {
        logger.warn('Turn liveness onStall 回调异常', { error: String(err) });
      }
    }
  }
}
