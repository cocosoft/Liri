/**
 * 压缩服务工具函数
 * * 使用Rust原生库进行精确的token估算（编译时零依赖C FFI）
 * 当原生库不可用时自动降级为启发式估算
 */

// P1-3-b（2026-09-28）：窗口解析改用与 unified / `createStreamBudget` **同一事实源**
// 2026-10-01 D-213（子批 E，`services -> ai` 倒挂收口）：原 `import { modelManager } from '@modules/ai'`
// 已是**死导入**（P1-3-b 改走 `resolveContextWindow` 后无任何调用点，仅本文件 L66 注释提及）⇒ 删除。
import { resolveContextWindow } from '@modules/context';
// P1-3-c（2026-09-28）：阈值口径统一为**比例**，引用全仓**唯一**阈值常量源
import { UNIFIED_THRESHOLDS } from '@modules/tokenBudget/TokenBudgetController.js';

let nativeEstimateTokens: ((text: string, model?: string) => number) | null =
  null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) =>
          native.estimateTokens(text, model);
      } else {
        nativeEstimateTokens = null;
      }
    } catch {
      nativeEstimateTokens = null;
    }
  }
  return nativeEstimateTokens;
}

/**
 * P1-3-c（2026-09-28，用户裁定）：**阈值口径统一为比例**（引用 `UNIFIED_THRESHOLDS`）。
 *
 * 改前这里是 4 个**绝对 buffer** 常量（`AUTO_COMPACT=13000` / `WARNING=20000` / `ERROR=20000` /
 * `MANUAL=3000`），阈值 = `有效窗口 − buffer`；而 `context/compaction` 与 unified 用**比例**
 * ⇒ **同一仓两套口径**（本 spec P1-3 取证 ②c）。
 *
 * 现改为**以有效窗口为基准的比例**（保留"基准 = 有效窗口"，只把减法换乘法）：
 * | 用途 | 映射 |
 * |---|---|
 * | 自动压缩触发 | `COMPACT_DEEP`（0.85） |
 * | 警告 | `WARNING`（0.75） |
 * | 错误 | `CRITICAL`（0.92） |
 *
 * ⚠️ **行为变化（如实；以 200k 窗口 / 输出预留 20k ⇒ 有效窗口 180k 为例）**：
 * 自动压缩 167000 → **153000**（**早 14000**）、警告 160000 → **135000**（早 25000）、
 * 错误 160000 → **165600**（晚 5600，且**不再与警告同级** —— 顺带修掉 D-6-d 的反向算式）。
 *
 * **未纳入统一的一项（附理由）**：`getBlockingLimit` 仍是"有效窗口 − `MANUAL_COMPACT_BUFFER_TOKENS`"。
 * 它是**手动压缩的硬上限**，语义是**为操作预留绝对空间**、不属 `UNIFIED_THRESHOLDS` 的"压缩档"
 * 范畴 ⇒ 强行比例化反而失真。
 */
export const DEFAULT_MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20000;
/** 手动压缩硬上限的绝对余量（**有意**不比例化，理由见上） */
export const DEFAULT_MANUAL_COMPACT_BUFFER_TOKENS = 3000;
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

const MAX_OUTPUT_TOKENS_MAP: Record<string, number> = {};

/**
 * P1-3-b（2026-09-28）：模型上下文窗口 —— **与 unified / `createStreamBudget` 同一事实源**。
 *
 * 改前：`CONTEXT_WINDOW_MAP[model]`（**恒空的死表**；且"按模型名建表"违反 `model-usage.md`）
 *   → `modelManager.getModelContextWindow(model)` → **`100000`**（硬编码兜底）
 * ⇒ 同一个"未注册模型"在本模块得 **100000**、而 `resolveContextWindow` 得 **200_000**（**1 倍分歧**）。
 *
 * 现统一为 `resolveContextWindow`：DB `model_registry.context_window`（**唯一事实来源**）
 *   → 1M 启发式 → `200_000`。
 *
 * ⚠️ **行为变化（如实）**：**未注册模型**的兜底窗口 100000 → 200000 ⇒
 * `getAutoCompactThreshold`（= 有效窗口 − 13000）随之抬高 ⇒ 这类模型上自动压缩**触发更晚**。
 */
export function getContextWindowForModel(model: string): number {
  return resolveContextWindow(model).tokens;
}

export function getMaxOutputTokensForModel(model: string): number {
  return MAX_OUTPUT_TOKENS_MAP[model] || 4096;
}

export function getEffectiveContextWindowFromModel(model: string): number {
  const maxOutputTokens = Math.min(
    getMaxOutputTokensForModel(model),
    DEFAULT_MAX_OUTPUT_TOKENS_FOR_SUMMARY
  );
  return getContextWindowForModel(model) - maxOutputTokens;
}

export function getAutoCompactThreshold(model: string): number {
  return (
    getEffectiveContextWindowFromModel(model) * UNIFIED_THRESHOLDS.COMPACT_DEEP
  );
}

/**
 * 警告阈值 = `有效窗口 × WARNING`。
 *
 * P1-3-c：**签名由 `autoCompactThreshold` 改为 `effectiveContextWindow`** —— 原算式为
 * `autoCompactThreshold - (13000 - 20000)` = `autoCompact + 7000`，**方向反了**
 * （warning 反而**晚于** autoCompact，见台账 D-6-d）；改为比例后顺带消除该错误。
 */
export function getWarningThreshold(effectiveContextWindow: number): number {
  return effectiveContextWindow * UNIFIED_THRESHOLDS.WARNING;
}

/** 错误阈值 = `有效窗口 × CRITICAL`（同上改签名；原与 warning 同级，现为最晚一道） */
export function getErrorThreshold(effectiveContextWindow: number): number {
  return effectiveContextWindow * UNIFIED_THRESHOLDS.CRITICAL;
}

export function getBlockingLimit(effectiveContextWindow: number): number {
  return effectiveContextWindow - DEFAULT_MANUAL_COMPACT_BUFFER_TOKENS;
}

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarningThreshold: boolean;
  isAboveErrorThreshold: boolean;
  isAboveAutoCompactThreshold: boolean;
  isAtBlockingLimit: boolean;
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  effectiveContextWindow: number
): TokenWarningState {
  const autoCompactThreshold = getAutoCompactThreshold(model);
  const threshold = effectiveContextWindow;

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100)
  );

  // P1-3-c：复用上面的**比例**函数（原为内联的绝对 buffer 减法 ⇒ 与 unified 两套口径）
  const warningThreshold = getWarningThreshold(threshold);
  const errorThreshold = getErrorThreshold(threshold);

  const isAboveWarningThreshold = tokenUsage >= warningThreshold;
  const isAboveErrorThreshold = tokenUsage >= errorThreshold;
  const isAboveAutoCompactThreshold = tokenUsage >= autoCompactThreshold;
  const isAtBlockingLimit = tokenUsage >= getBlockingLimit(threshold);

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  };
}

export function roughTokenCountEstimation(text: string): number {
  const native = lazyInitNative();
  if (native) {
    return native(text);
  }
  return Math.ceil(text.length / 4);
}

export function roughTokenCountEstimationForMessages(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += roughTokenCountEstimation(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          total += roughTokenCountEstimation(block.text);
        }
      }
    }
  }
  return total;
}
