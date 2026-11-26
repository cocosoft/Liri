// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 阶段链编排器的**端口**（2026-11-27，断开循环依赖）
 *
 * 背景：`settleStageApproval`（批准 ⇒ 续跑阶段链）原先直接 `await import('../StageOrchestrator')`，
 * 而 `StageOrchestrator` 静态 import 了同一文件 ⇒ madge 报 2 节点环
 * （`tasks/StageOrchestrator.ts > tasks/lro/stageApproval.ts`），而 CI `check:circular`
 * 的基线是「at most 0」⇒ 长期红（预存，非本轮权限改动引入）。
 *
 * 处置：本模块**不 import 任何 tasks 实现**（纯注册表）；由入口 `main.ts` 在装配期注册工厂。
 * 依赖方向变为 `StageOrchestrator → stageApproval → 本端口（叶子）` ⇒ 无环。
 * 未注册 ⇒ 批准分支如实记 warn 并跳过续跑（不抛异常、不谎报"已续跑"）。
 */
export interface StageOrchestratorHandle {
  /** 批准后继续推进阶段链（已完成阶段不重跑）；返回值调用方不使用，故只约束为 unknown */
  resumeAfterApproval(): Promise<unknown>;
}

/** `taskId → 编排器`；非阶段链任务返回 `null`（调用方据此记 warn 而非报错） */
export type StageOrchestratorFactory = (
  taskId: string
) => Promise<StageOrchestratorHandle | null>;

let factory: StageOrchestratorFactory | undefined;

export function setStageOrchestratorFactory(
  next: StageOrchestratorFactory
): void {
  factory = next;
}

export function getStageOrchestratorFactory():
  | StageOrchestratorFactory
  | undefined {
  return factory;
}

/** 测试用：清除注册，避免用例间串味 */
export function resetStageOrchestratorFactory(): void {
  factory = undefined;
}
