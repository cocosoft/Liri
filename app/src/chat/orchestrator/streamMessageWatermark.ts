/**
 * streamMessageFlow 的**流式水位上报**决策 + 载荷（P2-1h）。
 *
 * 动因（S4 事件持久化 / 观测）：`host.unifiedTracker.startStreamingCheck(cb)` 的回调此前**内联**在
 * `runStreamMessage`：既做**节流决策**（状态跃迁必记 + 同级时间节流），又构造**日志载荷**与
 * **前端进度载荷**，还持有两个跨回调的节流状态（`lastWatermarkWarnAt` / `lastWatermarkSeverity`）
 * ⇒ 无法独立测试，且节流口径与其事故背景（compact 级此前无节流 ⇒ 水位长期持平时每 1.5s 一条
 * warn，**单会话单日 14852 条**，见 `debug-long-task-interrupt.md`）绑死在编排函数里。
 *
 * 拆分手法（与 P2-1d-3 / P2-1d-4 一致）：**判据/载荷纯化、动作留下** ——
 * 本模块产出「该记哪一级 + 两份载荷」；**日志与 `onProgress` 的实际调用留在编排函数**。
 *
 * **类型取自既有契约**（R02，不复制数据形状）：入参 `WatermarkState`（`@modules/tokenBudget`）；
 * 进度载荷的 `watermarkState` 用 `ChatStreamChunk['watermarkState']`。
 * 依赖方向：本模块**仅类型依赖**，无运行时环。
 */

import type { WatermarkState } from '@modules/tokenBudget/UnifiedTokenTracker';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';

/** 水位日志载荷（与会话排查口径一致；`ratio` 保留 3 位，避免长小数） */
export interface WatermarkLogPayload {
  sessionId: string;
  currentTokens: number;
  contextLimit: number;
  ratio: number;
  severity: WatermarkState['severity'];
}

/** 该次采样应记的日志级别：`normal` ⇒ `debug`；非 `normal` 且未被节流 ⇒ `warn`；被节流 ⇒ `none` */
export type WatermarkLogLevel = 'debug' | 'warn' | 'none';

/** 前端进度载荷（`StreamMessageOptions.onProgress` 入参的子集） */
export interface WatermarkProgressPayload {
  stage: 'generating';
  message: string;
  watermarkState: NonNullable<ChatStreamChunk['watermarkState']>;
}

export interface WatermarkSample {
  logLevel: WatermarkLogLevel;
  logPayload: WatermarkLogPayload;
  progress: WatermarkProgressPayload;
}

/**
 * 创建水位上报器（**有状态**：仅持有节流所需的两项内部状态）。
 *
 * 口径（与拆分前**逐字等价**）：
 * 1. `severity === 'normal'` ⇒ `debug` 级（**不受节流**）；
 * 2. 非 `normal`：**状态跃迁必记**（`severity` 与上次不同 ⇒ 必记，含 `null → 任意级别`）+
 *    **同级时间节流**（距上次**真正记录** ≥ `throttleMs` 才再记；被节流 ⇒ `none`）；
 * 3. **无论是否记录，都刷新「上次 severity」**（供下一次跃迁判定）；
 * 4. **进度载荷每次采样都产出**（前端实时进度条；`currentTokens`/`contextLimit` 为 0 时显 `?`）。
 *
 * `now` 由调用方注入（便于确定性测试；生产传 `Date.now()`）。
 */
export function createWatermarkReporter(
  sessionId: string,
  throttleMs: number
): { sample: (state: WatermarkState, now: number) => WatermarkSample } {
  let lastWarnAt = 0;
  let lastSeverity: WatermarkState['severity'] | null = null;
  return {
    sample(state, now) {
      const logPayload: WatermarkLogPayload = {
        sessionId,
        currentTokens: state.currentTokens,
        contextLimit: state.contextLimit,
        ratio: Number(state.ratio.toFixed(3)),
        severity: state.severity,
      };
      const isEscalation = state.severity !== lastSeverity;
      let logLevel: WatermarkLogLevel;
      if (state.severity === 'normal') {
        logLevel = 'debug';
      } else if (isEscalation || now - lastWarnAt >= throttleMs) {
        lastWarnAt = now;
        logLevel = 'warn';
      } else {
        logLevel = 'none';
      }
      lastSeverity = state.severity;

      const pct = Math.round(state.ratio * 100);
      const curK =
        state.currentTokens > 0
          ? `${(state.currentTokens / 1000).toFixed(0)}K`
          : '?';
      const maxK =
        state.contextLimit > 0
          ? `${(state.contextLimit / 1000).toFixed(0)}K`
          : '?';
      const progress: WatermarkProgressPayload = {
        stage: 'generating',
        message: `上下文水位: ${pct}% (${curK}/${maxK}) | severity:${state.severity} | ratio:${state.ratio.toFixed(3)} | tokens:${state.currentTokens}/${state.contextLimit}`,
        watermarkState: {
          currentTokens: state.currentTokens,
          contextLimit: state.contextLimit,
          ratio: state.ratio,
          severity: state.severity,
        },
      };
      return { logLevel, logPayload, progress };
    },
  };
}
