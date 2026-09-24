/**
 * Anthropic 提示缓存配置
 * 对标 Hermes agent/prompt_caching.py 的 system_and_3 策略
 * 为系统提示、消息和工具定义添加 cache_control 断点
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** Anthropic 对单次请求 `cache_control` 断点数的**硬上限**（超限请求会被拒绝） */
export const MAX_BREAKPOINTS_HARD_LIMIT = 4;

/** 固定断点占用额度：`system` 恒占 1；除 `system_only` 外 `tools` 也恒占 1（O2-3） */
export const RESERVED_BREAKPOINTS = 2;

/**
 * 缓存断点位置
 */
export interface CacheBreakpoint {
  type: 'system' | 'message' | 'tools';
  index: number;
}

/**
 * 缓存策略类型
 */
export type CacheStrategy =
  | 'system_and_3'
  | 'system_and_6'
  | 'system_only'
  | 'none';

/**
 * 缓存配置
 */
export interface PromptCacheConfig {
  strategy: CacheStrategy;
  breakpointInterval: number;
  maxBreakpoints: number;
}

/**
 * 默认缓存配置 - system_and_3 策略
 * 系统提示末尾 + 每 3 条消息 + 工具定义末尾
 */
export const DEFAULT_CACHE_CONFIG: PromptCacheConfig = {
  strategy: 'system_and_3',
  breakpointInterval: 3,
  maxBreakpoints: 4,
};

/**
 * 配置合法性校验（O2-3 要点 2）：非法配置**直接抛错**，不再静默走默认分支。
 *
 * 对标 deepseek-harness `validateToolOrder` 的"白名单 + 抛错"手法。
 */
export function assertValidCacheConfig(config: PromptCacheConfig): void {
  const { maxBreakpoints, breakpointInterval } = config;
  if (
    !Number.isInteger(maxBreakpoints) ||
    maxBreakpoints < RESERVED_BREAKPOINTS ||
    maxBreakpoints > MAX_BREAKPOINTS_HARD_LIMIT
  ) {
    throw new AppError(
      `缓存配置非法：maxBreakpoints=${String(maxBreakpoints)}（需为 ${RESERVED_BREAKPOINTS}~${MAX_BREAKPOINTS_HARD_LIMIT} 的整数——` +
        `system/tools 两个固定断点必须放得下，且不得超出 Anthropic 硬上限 ${MAX_BREAKPOINTS_HARD_LIMIT}）`,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.HIGH,
      'PROMPT_CACHE_MAX_BREAKPOINTS_INVALID'
    );
  }
  if (!Number.isInteger(breakpointInterval) || breakpointInterval < 1) {
    throw new AppError(
      `缓存配置非法：breakpointInterval=${String(breakpointInterval)}（需为 ≥1 的整数）`,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.HIGH,
      'PROMPT_CACHE_INTERVAL_INVALID'
    );
  }
}

/**
 * 断点列表**不变量校验**（O2-3 要点 5）：把"总数不超预算 / 固定断点唯一 / 消息断点递增"
 * 从注释与约定变成**运行时断言**。
 *
 * 为什么需要：原实现把 `tools` 断点无条件 push 在预算之外，最多产出 `maxBreakpoints + 1`
 * 个断点（超出 Anthropic 硬上限）——这类"结构不变量"缺失时只能靠人读代码发现。
 */
export function assertBreakpointInvariants(
  breakpoints: CacheBreakpoint[],
  maxBreakpoints: number
): void {
  if (breakpoints.length > maxBreakpoints) {
    throw new AppError(
      `缓存断点数超预算：实际 ${breakpoints.length} > maxBreakpoints ${maxBreakpoints}`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'PROMPT_CACHE_BREAKPOINT_OVERFLOW'
    );
  }
  const countOf = (type: CacheBreakpoint['type']): number =>
    breakpoints.filter((bp) => bp.type === type).length;
  if (countOf('system') > 1 || countOf('tools') > 1) {
    throw new AppError(
      '缓存断点不变量破坏：system / tools 固定断点各至多 1 个',
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'PROMPT_CACHE_BREAKPOINT_DUPLICATE'
    );
  }
  const messageIndexes = breakpoints
    .filter((bp) => bp.type === 'message')
    .map((bp) => bp.index);
  for (let i = 0; i < messageIndexes.length; i++) {
    if (!Number.isInteger(messageIndexes[i]) || messageIndexes[i] < 0) {
      throw new AppError(
        `缓存断点不变量破坏：message 断点下标非法（${String(messageIndexes[i])}）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'PROMPT_CACHE_BREAKPOINT_INDEX_INVALID'
      );
    }
    if (i > 0 && messageIndexes[i] <= messageIndexes[i - 1]) {
      throw new AppError(
        '缓存断点不变量破坏：message 断点下标必须严格递增',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'PROMPT_CACHE_BREAKPOINT_ORDER_INVALID'
      );
    }
  }
}

/**
 * 根据策略计算缓存断点位置
 *
 * O2-3（2026-09-24「会话暴露问题分析与优化方案」§五）三处修正：
 *  1. **固定断点先占预算**：`system` / `tools` 先登记，消息断点只使用**剩余额度**
 *     ⇒ 返回数组长度**恒 ≤ `maxBreakpoints`**。原实现把 `tools` 无条件 push 在循环之后、
 *     预算之外，数组最长可达 `maxBreakpoints + 1`（> Anthropic 硬上限 4）。
 *  2. **`system_and_6` 是死逻辑**：原分支条件 `(i+1)%3===0 || (i+1)%6===0` 的后一项是前一项
 *     的子集 ⇒ 与 `system_and_3` 行为完全等价。现按名字给出真正的 6 间隔语义
 *     （策略名即间隔；`breakpointInterval` 仅作用于 `system_and_3`）。
 *  3. **配置校验 + 不变量断言**：非法配置抛错；返回前自检结构不变量。
 *
 * @param messageCount 消息总数
 * @param config 缓存配置
 * @returns 缓存断点位置数组（长度 ≤ `maxBreakpoints`）
 */
export function calculateBreakpoints(
  messageCount: number,
  config: PromptCacheConfig = DEFAULT_CACHE_CONFIG
): CacheBreakpoint[] {
  if (config.strategy === 'none' || messageCount === 0) {
    return [];
  }

  assertValidCacheConfig(config);

  const breakpoints: CacheBreakpoint[] = [{ type: 'system', index: 0 }];

  if (config.strategy === 'system_only') {
    return breakpoints;
  }

  // 固定断点先占位（O2-3 要点 1）：tools 也计入预算
  breakpoints.push({ type: 'tools', index: 0 });

  let remaining = config.maxBreakpoints - breakpoints.length;
  // `system_and_6` 的间隔即其名字（6）；`system_and_3` 用配置项（默认 3）
  const interval =
    config.strategy === 'system_and_6' ? 6 : config.breakpointInterval;

  for (let i = 0; i < messageCount && remaining > 0; i++) {
    if ((i + 1) % interval === 0) {
      breakpoints.push({ type: 'message', index: i });
      remaining--;
    }
  }

  assertBreakpointInvariants(breakpoints, config.maxBreakpoints);
  return breakpoints;
}

/**
 * 判断指定消息索引是否应放置缓存断点
 * @param messageIndex 消息索引（从 0 开始）
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置断点
 */
export function shouldPlaceBreakpoint(
  messageIndex: number,
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some(
    (bp) => bp.type === 'message' && bp.index === messageIndex
  );
}

/**
 * 判断是否应放置系统断点
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置
 */
export function shouldPlaceSystemBreakpoint(
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some((bp) => bp.type === 'system');
}

/**
 * 判断是否应放置工具断点
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置
 */
export function shouldPlaceToolsBreakpoint(
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some((bp) => bp.type === 'tools');
}

/**
 * 创建 Anthropic cache_control 对象
 * @returns cache_control 对象
 */
export function createCacheControl(): { type: 'ephemeral' } {
  return { type: 'ephemeral' };
}
