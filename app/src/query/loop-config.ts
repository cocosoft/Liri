/**
 * Loop 灰度与可观测性配置
 *
 * Phase 1-4 统一入口。所有检测器阈值和 observeOnly 模式通过此模块管理。
 * 支持通过环境变量热调整，无需发版即可调整参数。
 *
 * 环境变量：
 *   LOOP_OBSERVE_ONLY        — 全局 observeOnly 模式（不阻断，仅记录日志），默认 false
 *   LOOP_UNKNOWN_TOOL_WARNING — unknown_tool_repeat 警告阈值，默认 5
 *   LOOP_UNKNOWN_TOOL_CRITICAL — unknown_tool_repeat 阻断阈值，默认 10
 *   LOOP_GLOBAL_BREAKER_THRESHOLD — 全局断路器阈值，默认 30
 *   LOOP_FILE_IO_WARNING     — 文件 IO 循环警告阈值，默认 3
 *   LOOP_FILE_IO_BLOCK       — 文件 IO 循环阻断阈值，默认 4
 *   LOOP_MIN_TOKEN_DELTA     — 收益递减 minTokenDelta，默认 500
 *   LOOP_DIMINISH_TURNS_THRESHOLD — 收益递减连续轮数阈值，默认 2
 *   LOOP_COMPACT_ROUNDS_KEEP — Compact 保留轮数，默认 20
 *   LOOP_GENERIC_REPEAT_WARNING — generic_repeat 警告阈值，默认 10
 *   LOOP_GENERIC_REPEAT_CRITICAL — generic_repeat 阻断阈值，默认 20
 *   LOOP_PING_PONG_THRESHOLD — ping-pong 交替次数阈值，默认 10
 *   LOOP_NO_TOOL_CALL_WARNING — no_tool_call 警告阈值，默认 3
 *   LOOP_NO_TOOL_CALL_CRITICAL — no_tool_call 阻断阈值，默认 5
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('query:loopConfig');

// ─── 全局 observeOnly 模式 ─────────────────────────────

/** 全局 observeOnly 模式（不阻断，仅记录日志） */
export const LOOP_OBSERVE_ONLY = process.env.LOOP_OBSERVE_ONLY === 'true';

// ─── 阈值环境变量 ──────────────────────────────────────

/** 从环境变量读取整数阈值，fallback 到默认值 */
function envInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultVal;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 0) {
    logger.warn(`环境变量 ${key}=${raw} 无效，使用默认值 ${defaultVal}`);
    return defaultVal;
  }
  return val;
}

/** 从环境变量读取浮点数阈值 */
function envFloat(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultVal;
  const val = parseFloat(raw);
  if (isNaN(val) || val < 0) {
    logger.warn(`环境变量 ${key}=${raw} 无效，使用默认值 ${defaultVal}`);
    return defaultVal;
  }
  return val;
}

// ─── 导出阈值 ──────────────────────────────────────────

/** unknown_tool_repeat 警告阈值 */
export const LOOP_UNKNOWN_TOOL_WARNING = envInt('LOOP_UNKNOWN_TOOL_WARNING', 5);
/** unknown_tool_repeat 阻断阈值 */
export const LOOP_UNKNOWN_TOOL_CRITICAL = envInt(
  'LOOP_UNKNOWN_TOOL_CRITICAL',
  10
);
/** 全局断路器阈值 */
export const LOOP_GLOBAL_BREAKER_THRESHOLD = envInt(
  'LOOP_GLOBAL_BREAKER_THRESHOLD',
  30
);
/** 文件 IO 循环警告阈值 */
export const LOOP_FILE_IO_WARNING = envInt('LOOP_FILE_IO_WARNING', 3);
/** 文件 IO 循环阻断阈值 */
export const LOOP_FILE_IO_BLOCK = envInt('LOOP_FILE_IO_BLOCK', 4);
/** 收益递减 minTokenDelta */
export const LOOP_MIN_TOKEN_DELTA = envInt('LOOP_MIN_TOKEN_DELTA', 500);
/** 收益递减连续轮数阈值 */
export const LOOP_DIMINISH_TURNS_THRESHOLD = envInt(
  'LOOP_DIMINISH_TURNS_THRESHOLD',
  2
);
/** Compact 保留轮数 */
export const LOOP_COMPACT_ROUNDS_KEEP = envInt('LOOP_COMPACT_ROUNDS_KEEP', 20);
/** generic_repeat 警告阈值 */
export const LOOP_GENERIC_REPEAT_WARNING = envInt(
  'LOOP_GENERIC_REPEAT_WARNING',
  10
);
/** generic_repeat 阻断阈值 */
export const LOOP_GENERIC_REPEAT_CRITICAL = envInt(
  'LOOP_GENERIC_REPEAT_CRITICAL',
  20
);
/** ping-pong 交替次数阈值 */
export const LOOP_PING_PONG_THRESHOLD = envInt('LOOP_PING_PONG_THRESHOLD', 10);
/** no_tool_call 警告阈值 */
export const LOOP_NO_TOOL_CALL_WARNING = envInt('LOOP_NO_TOOL_CALL_WARNING', 8);
/** no_tool_call 阻断阈值 */
export const LOOP_NO_TOOL_CALL_CRITICAL = envInt(
  'LOOP_NO_TOOL_CALL_CRITICAL',
  15
);

// ─── observeOnly 辅助函数 ──────────────────────────────

/**
 * 在 observeOnly 模式下，将阻断降级为警告（仅记录日志，不阻断）
 *
 * @param component 组件名称（用于日志）
 * @param message 本应阻断的消息
 * @returns true 表示应阻断（非 observeOnly 模式），false 表示应放行（observeOnly 模式）
 */
export function observeOnlyGuard(component: string, message: string): boolean {
  if (LOOP_OBSERVE_ONLY) {
    logger.warn(`[OBSERVE] ${component} 本应阻断: ${message}`);
    return false;
  }
  return true;
}

// ─── 启动时日志 ────────────────────────────────────────

if (LOOP_OBSERVE_ONLY) {
  logger.warn('Loop observeOnly 模式已启用——所有检测器仅记录日志，不阻断');
}

logger.info('Loop 灰度配置已加载', {
  observeOnly: LOOP_OBSERVE_ONLY,
  thresholds: {
    unknownToolWarning: LOOP_UNKNOWN_TOOL_WARNING,
    unknownToolCritical: LOOP_UNKNOWN_TOOL_CRITICAL,
    globalBreaker: LOOP_GLOBAL_BREAKER_THRESHOLD,
    fileIOWarning: LOOP_FILE_IO_WARNING,
    fileIOBlock: LOOP_FILE_IO_BLOCK,
    minTokenDelta: LOOP_MIN_TOKEN_DELTA,
    diminishingTurns: LOOP_DIMINISH_TURNS_THRESHOLD,
    compactRoundsKeep: LOOP_COMPACT_ROUNDS_KEEP,
    genericRepeatWarning: LOOP_GENERIC_REPEAT_WARNING,
    genericRepeatCritical: LOOP_GENERIC_REPEAT_CRITICAL,
    pingPongThreshold: LOOP_PING_PONG_THRESHOLD,
    noToolCallWarning: LOOP_NO_TOOL_CALL_WARNING,
    noToolCallCritical: LOOP_NO_TOOL_CALL_CRITICAL,
  },
});
