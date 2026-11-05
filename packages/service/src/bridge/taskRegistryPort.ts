/**
 * bridge 的 TaskRegistry 端口（P34，2026-11-05）
 *
 * 迁包前 `ModuleBridgeSetup` 用 `await import('../tasks/TaskRegistry.js')` 探测 app 层的任务注册表。
 * 迁入 `packages/service` 后该相对路径会落到包内**不存在**的 `tasks/`（探测恒失败 ⇒ 能力静默消失），
 * 改指 `@modules/tasks` 又会被 R8 判为「包依赖 app 层」（倒挂）⇒ 与 P32
 * （`setMcpToolScopePortLoader`）同口径反转：包内只留端口，实现由 `bootstrap/preflight.ts` 注入。
 *
 * 未注入 ⇒ 与迁包前的 `catch` 分支**同义**：Logger 记「暂未就绪」并跳过（不抛错，ACP 桥照常启动）。
 */

import type { ModuleBridgeDependencies } from './ModuleBridgeRuntime';

/** 复用 `ModuleBridgeDependencies` 已声明的形状（CS01：不重复定义契约） */
export type BridgeTaskRegistryPort = NonNullable<
  ModuleBridgeDependencies['taskRegistry']
>;

let loader: (() => Promise<BridgeTaskRegistryPort | null>) | null = null;

/** 注入任务注册表来源（启动期调用一次；延迟取值） */
export function setBridgeTaskRegistryLoader(
  fn: (() => Promise<BridgeTaskRegistryPort | null>) | null
): void {
  loader = fn;
}

/** 取任务注册表端口；未注入或加载失败 ⇒ `null`（调用方如实记录并跳过） */
export async function loadBridgeTaskRegistry(): Promise<BridgeTaskRegistryPort | null> {
  if (!loader) return null;
  return loader();
}
