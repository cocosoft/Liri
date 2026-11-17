/**
 * Ink REPL：把一轮流式结束后的 `tool_calls` 载荷整形为可展示的工具卡片
 * （2026-11-17，T3 复杂度清理时从 `ReplApp.tsx` 的 `handleSubmit` 原样搬出）。
 *
 * 为什么独立成模块：ink 渲染层在本仓无测试夹具；这段"两个来源合并"的整形逻辑
 * （模型侧 `finalMessage.tool_calls` + 流内 `tool_end` 下发的结果）有多个回退分支，
 * 抽成不依赖 ink 的纯函数即可直接单测（同 `commandDispatch` 的先例）。
 *
 * 契约（与搬出前逐字一致）：
 *  - 模型侧参数优先；参数为空对象时回退到流内已累积的参数；
 *  - 流内结果按 `id` 合并 `status` / `error` / `result`（无则不带该字段）；
 *  - 无 `tool_calls` ⇒ 返回空数组。
 */
import type { ToolCallInfo } from './types';
import type { ToolCallSpec } from '@modules/runtime/api/CoreAPI';

export function buildCompletedToolCalls(
  finalToolCalls: Array<Record<string, unknown>> | undefined,
  executedById: ReadonlyMap<string, ToolCallSpec>
): ToolCallInfo[] {
  return (
    finalToolCalls?.map((tc: Record<string, unknown>) => {
      const fn = (tc.function || {}) as Record<string, unknown>;
      const id = (tc.id as string) || '';
      const name = (fn.name as string) || (tc.name as string) || 'unknown';
      const args = (
        fn.arguments
          ? typeof fn.arguments === 'string'
            ? JSON.parse(fn.arguments as string)
            : fn.arguments
          : tc.arguments || {}
      ) as Record<string, unknown>;
      // 合并流内累积的执行状态/结果（`tool_end` 块）
      const executed = id ? executedById.get(id) : undefined;
      return {
        id,
        name,
        arguments:
          args && Object.keys(args).length > 0
            ? args
            : (executed?.arguments ?? {}),
        ...(executed?.status ? { status: executed.status } : {}),
        ...(executed?.error ? { error: executed.error } : {}),
        ...(executed?.result !== undefined ? { result: executed.result } : {}),
      };
    }) || []
  );
}
