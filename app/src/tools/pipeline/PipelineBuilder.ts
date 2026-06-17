/**
 * PipelineBuilder + 中间件适配器
 *
 * 将现有 5 层管理器适配为 ToolMiddleware 接口，按工具标签自动路由。
 * 快速通道（readOnly 工具）：SecurityCheck + Permission → 直接执行
 * 完整通道（write/destructive 工具）：全部中间件
 */

import type { Tool } from '../types/Tool';
import type { ToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { createToolResult } from '../types/ToolResult';
import {
  type ToolMiddleware,
  type PipelineContext,
  type MiddlewareResult,
  type PipelineConfig,
  MiddlewareGroup,
} from './types';
import { preExecutionCheck } from '@modules/security/securityUtils';

// ── 中间件注册表 ─────────────────────────────────────────────────────

/** 全局中间件实例映射 */
const middlewareRegistry = new Map<MiddlewareGroup, ToolMiddleware>();

/**
 * 注册中间件实例
 */
export function registerMiddleware(
  group: MiddlewareGroup,
  middleware: ToolMiddleware
): void {
  middlewareRegistry.set(group, middleware);
}

/**
 * 获取已注册中间件
 */
function getMiddleware(group: MiddlewareGroup): ToolMiddleware | undefined {
  return middlewareRegistry.get(group);
}

/**
 * 检查中间件是否已注册
 */
export function hasMiddleware(group: MiddlewareGroup): boolean {
  return middlewareRegistry.has(group);
}

// ── 内置中间件：安全检查 ──────────────────────────────────────────────

/**
 * 安全检查中间件（路径穿越、注入检测等）
 * 始终必需，不可跳过
 */
const securityMiddleware: ToolMiddleware = {
  name: 'SecurityCheck',
  before: async (ctx: PipelineContext): Promise<MiddlewareResult> => {
    const check = preExecutionCheck(ctx.tool.name, [JSON.stringify(ctx.input)]);
    if (!check.safe) {
      return { continue: false, error: check.warnings.join('; ') };
    }
    return { continue: true };
  },
};

// 注册内置中间件
registerMiddleware(MiddlewareGroup.SECURITY, securityMiddleware);

// ── Pipeline 路由 ─────────────────────────────────────────────────────

/**
 * 根据工具属性自动决定所需中间件组
 *
 * 规则：
 * 1. readOnly + !destructive → 快速通道：SECURITY + PERMISSION + VALIDATION
 * 2. destructive → 完整通道：所有中间件
 * 3. 默认 → 完整通道
 */
function resolveMiddlewareGroups(
  tool: Tool,
  config?: PipelineConfig
): MiddlewareGroup[] {
  // 显式声明优先级最高
  if (config?.middlewares) {
    return config.middlewares.filter((g) => !config.exclude?.includes(g));
  }

  const isReadOnly = tool.isReadOnly() && !tool.isDestructive?.();

  if (isReadOnly) {
    // 快速通道：只读工具跳过沙箱和治理闭环
    const groups: MiddlewareGroup[] = [
      MiddlewareGroup.SECURITY,
      MiddlewareGroup.PERMISSION,
      MiddlewareGroup.VALIDATION,
    ];
    return config?.exclude
      ? groups.filter((g) => !config.exclude!.includes(g))
      : groups;
  }

  // 完整通道：所有中间件按执行顺序
  const groups: MiddlewareGroup[] = [
    MiddlewareGroup.SECURITY,
    MiddlewareGroup.PERMISSION,
    MiddlewareGroup.VALIDATION,
    MiddlewareGroup.PRE_HOOK,
    MiddlewareGroup.GOVERNANCE,
    MiddlewareGroup.SANDBOX,
    MiddlewareGroup.POST_HOOK,
    MiddlewareGroup.AUDIT,
  ];

  return config?.exclude
    ? groups.filter((g) => !config.exclude!.includes(g))
    : groups;
}

// ── Pipeline 执行器 ───────────────────────────────────────────────────

/**
 * 创建 Pipeline 执行函数
 *
 * 注：executeFn 由外部注入（来自 ToolExecutor 的 tool.execute），
 * 因为实际执行逻辑与中间件解耦。
 */
export function createPipelineExecutor(
  executeFn: (
    input: Record<string, unknown>,
    context: ToolUseContext
  ) => Promise<ToolResult>
) {
  /**
   * 通过 Pipeline 执行工具
   * @returns ToolResult
   */
  async function runPipeline(
    tool: Tool,
    input: Record<string, unknown>,
    toolUseContext: ToolUseContext,
    toolUseId: string,
    config?: PipelineConfig
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const groups = resolveMiddlewareGroups(tool, config);
    const isReadOnly = tool.isReadOnly() && !tool.isDestructive?.();

    // 构建上下文
    const ctx: PipelineContext = {
      tool,
      input,
      toolUseContext,
      toolUseId,
      startTime,
      allowed: true,
      metadata: new Map(),
    };

    let result: ToolResult | null = null;

    // ── Before 阶段：依次执行所有中间件的 before 钩子 ──
    for (const group of groups) {
      const mw = getMiddleware(group);
      if (!mw) {
        // 中间件未注册则跳过（允许部分中间件可选）
        continue;
      }

      const mwResult = await mw.before(ctx);
      if (!mwResult.continue) {
        // 中间件阻止执行
        if (mwResult.result) {
          return mwResult.result;
        }
        return createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: mwResult.error || 'Execution blocked by middleware',
            },
          ],
        });
      }
    }

    // ── 执行阶段：快速通道直接执行，完整通道走 Governance ──
    if (isReadOnly && !config?.middlewares) {
      // 快速通道：直接执行
      result = await executeFn(ctx.input, ctx.toolUseContext);
    } else {
      // 完整通道：通过外部注入的 governance 包裹逻辑执行
      // 注：executeFn 此时已被 ToolExecutor 包裹为 governance/sandbox 版本
      result = await executeFn(ctx.input, ctx.toolUseContext);
    }

    // ── After 阶段：依次执行 after 钩子 ──
    for (const group of groups) {
      const mw = getMiddleware(group);
      if (!mw || !mw.after) continue;
      await mw.after(ctx, result!);
    }

    return result!;
  }

  return { runPipeline, resolveMiddlewareGroups };
}

// ── 基准测试工具 ─────────────────────────────────────────────────────

export interface BenchmarkResult {
  /** 工具路径类型 */
  pathType: 'fast' | 'full';
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 中间件数量 */
  middlewareCount: number;
  /** 成功与否 */
  success: boolean;
}

/**
 * 对工具执行进行基准测试（不改任何逻辑，仅测量）
 *
 * @param label 测试标签
 * @param executeFn 执行函数
 * @param iterations 迭代次数
 */
export async function benchmark(
  label: string,
  executeFn: () => Promise<{ durationMs: number; success: boolean }>,
  iterations: number = 10
): Promise<{
  label: string;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  records: { durationMs: number; success: boolean }[];
}> {
  const records: { durationMs: number; success: boolean }[] = [];

  // Warm-up iteration
  await executeFn();

  for (let i = 0; i < iterations; i++) {
    const r = await executeFn();
    records.push(r);
  }

  const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
  const avgMs = durations.reduce((s, v) => s + v, 0) / durations.length;
  const p50Ms = durations[Math.floor(durations.length * 0.5)];
  const p90Ms = durations[Math.floor(durations.length * 0.9)];
  const p99Ms = durations[Math.floor(durations.length * 0.99)];

  return { label, avgMs, p50Ms, p90Ms, p99Ms, records };
}
