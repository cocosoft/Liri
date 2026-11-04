// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * taskSessionPolicyPort —— 长程任务**策略快照**的会话侧端口（P2，2026-11-04）
 *
 * 为什么是**模块级端口**而不是构造入参：`getOrCreateOrchestrator(taskId)` 有 6 个入口
 * （会话内升级、`POST /v1/pdca/start`、CLI `/goal`、阶段链子任务、启动恢复、HTTP 快照），
 * 逐个注入必然漏 —— 与 `setStepLoopFactory`（2026-10-08 长程「执行不了」根因）同款教训。
 * 因此由 chat 层在装配时**注册一次**，tasks 层按需取用；未注册 ⇒ 捕获/重放均为 no-op
 *（不影响任务执行，只是没有策略固定）。
 *
 * 实现方（`chat/manager/facadeWiring`）：
 * - `capture`：读会话 metadata 的 `permission_mode` / `approvalMode` + 工作区根；
 * - `applyReplay`：把重放补丁写回**内存会话**（不落库 —— 用户当前设置不被任务篡改）。
 */

import type {
  PolicyReplayPatch,
  PolicySnapshotInput,
} from './policySnapshot.js';

/** 会话侧策略访问面（由 chat 层实现） */
export interface TaskSessionPolicyPort {
  /** 采样会话当前的策略输入（无会话 ⇒ `undefined`） */
  capture: (sessionId: string) => PolicySnapshotInput | undefined;
  /** 应用重放补丁（仅内存；缺字段 = 不改动） */
  applyReplay: (sessionId: string, patch: PolicyReplayPatch) => void;
}

let port: TaskSessionPolicyPort | undefined;

/** 注册/注销端口（装配期调用一次；`undefined` = 注销，供测试隔离） */
export function setTaskSessionPolicyPort(
  next: TaskSessionPolicyPort | undefined
): void {
  port = next;
}

/** 取当前端口（未注册 ⇒ `undefined`，调用方按 no-op 处理） */
export function getTaskSessionPolicyPort(): TaskSessionPolicyPort | undefined {
  return port;
}
