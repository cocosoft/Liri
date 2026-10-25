/**
 * 插件工具声明 → 宿主 `Tool` 的**唯一适配实现**（CS01：两个消费方共用一条路径）。
 *
 * 消费方：
 * - 进程内 SDK 路径（`plugins/core/SdkPluginAdapter.ts`，PY-0）：handler 在同一进程；
 * - 子进程宿主路径（`plugins/host/PluginHostSupervisor.ts`，T25-08 P1）：
 *   handler 在子进程，宿主只持有**代理**，`run` 走 RPC。
 *
 * 声明形状 = SDK `ToolRegistration` 的**可序列化子集**（去掉 `execute`）——
 * 子进程把声明经 `notify` 帧送上来时，字段名与 SDK 完全一致，避免第二套词汇。
 */
import { buildTool } from '@modules/tools/types/Tool';
import type { Tool, ToolParam } from '@modules/tools/types/Tool';
import { createToolResult } from '@modules/tools/types/ToolResult';

/** 插件工具声明（可序列化；不含 handler） */
export interface PluginToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema properties 风格（与 SDK `ToolRegistration.parameters` 同形） */
  parameters?: Record<string, unknown>;
}

/**
 * 单个参数条目 → `ToolParam`（缺字段给默认值，**不猜语义**）。
 */
export function toToolParam(name: string, schema: unknown): ToolParam {
  const s = (schema ?? {}) as Record<string, unknown>;
  return {
    name,
    type: typeof s.type === 'string' ? s.type : 'string',
    description: typeof s.description === 'string' ? s.description : '',
    required: s.required === true,
    default: s.default,
    enum: Array.isArray(s.enum) ? (s.enum as string[]) : undefined,
  };
}

/** 声明 → `ToolParam[]`（保持声明里的键顺序） */
export function toToolParams(decl: PluginToolDeclaration): ToolParam[] {
  return Object.entries(decl.parameters ?? {}).map(([name, prop]) =>
    toToolParam(name, prop)
  );
}

/**
 * 用**外部执行器**装配工具。
 *
 * @param decl 可序列化声明
 * @param run 实际执行（进程内 = plugin 的 handler；宿主 = RPC 代理）
 */
export function buildRegisteredTool(
  decl: PluginToolDeclaration,
  run: (input: Record<string, unknown>) => Promise<unknown>
): Tool {
  return buildTool({
    name: decl.name,
    description: decl.description,
    params: toToolParams(decl),
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    execute: async (input: Record<string, unknown>) =>
      createToolResult(await run(input)),
  });
}
