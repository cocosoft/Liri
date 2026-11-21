// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * runtimeToolMeta — **运行期注册工具**的元数据登记（C3，2026-11-21；治理方案 v3 §14.3）
 *
 * ## 为什么需要
 * 内置工具的类别 / 风险在编译期表里（`TOOL_CATEGORY_ENTRIES` / `TOOL_EFFECTS`），
 * 而 SDK 插件（进程内 + 子进程宿主）与模块运行期注册的工具**不在**这些表内 ⇒
 * 注册进 `ToolRegistry` 后：
 * - `getToolCategory()` 落 `misc` ⇒ **不在任何任务白名单 ⇒ 被静默裁剪**（模型永远看不见）；
 * - `deriveToolRiskClass()` 落 `undeclared` ⇒ 每次调用都询问（可用但体验差）。
 *
 * 本模块提供**运行期**的类别登记，消费方共三处（缺一即为"注册了但模型看不见/设置改不了"）：
 * 1. `getToolCategory()`（`toolCategories.ts`）；
 * 2. 可见性覆写的"已知工具名"判定（`toolVisibilityOverrides.ts`）；
 * 3. 可见性报表的遍历域（`toolVisibilityReport.ts`）。
 *
 * ## 边界
 * - **只读元数据**：不参与注册、授权、执行；类别只影响"可见面"，不影响审批（可见 ≠ 放行）。
 * - **生命周期与工具注册同源**：登记返回 `disposer`；注销时一并撤销（卸载即撤销，无残留）。
 * - 重名登记 ⇒ 后者覆盖；`disposer` 只在"自己仍是当前登记"时删除（防误删后登记者）。
 */

import type { ToolRiskClass } from '@openliri/infra/utils/toolContract/Tool';
// 仅类型引用（`import type` 运行期擦除）⇒ 与 `toolCategories` 无运行时环。
import type { ToolCategory } from './toolCategories';

/** 运行期工具的元数据（插件工具缺省：类别 `plugin` / 包 = 插件 id / 风险未声明） */
export interface RuntimeToolMeta {
  /** 工具类别（决定任务面可见性；缺省 `plugin`） */
  category: ToolCategory;
  /** 归属包（插件工具 = 插件 id；模块工具可自定） */
  pack: string;
  /** 风险类别（`undeclared` ⇒ 每次询问，安全默认） */
  riskClass?: ToolRiskClass;
  /** 是否只读（供并发 / 沙箱豁免判定；缺省 `undefined` = 未声明） */
  readOnly?: boolean;
}

/** 登记表（进程级；工具注册 / 注销驱动其生命周期） */
const registry = new Map<string, RuntimeToolMeta>();

/**
 * 登记运行期工具元数据；返回**撤销函数**（只撤销本次登记）。
 *
 * @param name 工具真名（与 `ToolRegistry` 注册名一致）
 * @param meta 元数据（内部拷贝，调用方后续改动不影响登记）
 */
export function registerRuntimeToolMeta(
  name: string,
  meta: RuntimeToolMeta
): () => void {
  const stored: RuntimeToolMeta = { ...meta };
  registry.set(name, stored);
  return () => {
    // 只删"自己仍是当前登记"的项：后登记者覆盖后，前一个 disposer 不得误删
    if (registry.get(name) === stored) registry.delete(name);
  };
}

/** 注销运行期工具元数据（工具注销路径用）；返回是否确有登记 */
export function unregisterRuntimeToolMeta(name: string): boolean {
  return registry.delete(name);
}

/** 查运行期工具元数据（未登记 ⇒ `undefined`） */
export function getRuntimeToolMeta(name: string): RuntimeToolMeta | undefined {
  return registry.get(name);
}

/** 全部运行期工具名（升序；报表遍历用） */
export function listRuntimeToolNames(): readonly string[] {
  return [...registry.keys()].sort();
}

/** 仅供测试：清空登记表（避免跨文件污染） */
export function resetRuntimeToolMetaForTest(): void {
  registry.clear();
}
