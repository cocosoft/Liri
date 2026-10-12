/**
 * executionProjection — 执行域「原生状态 → 四原语」**纯映射** + 出口（状态机规范管理方案 阶段 4，2026-10-12）。
 *
 * ## 职责边界
 * - **本文件（service）**：只做**本域**的映射（需要 `ExecutionStatus`，故不能下沉到 infra —— 见
 *   `state/engine/projectionBroker.ts` 头注的「方案订正」）；
 * - **Broker（infra）**：只认"原语"，负责门控 + 经 `globalEventBus` 广播。
 *
 * ## 投影的**单向、只读**约束（方案 §3 / §4.1）
 * - **单向**：原生 → 原语；**反向不存在**（原语**不是**第二事实源，**不**驱动任何域内状态）；
 * - **原生枚举不变**：`EXECUTION_STATUSES` 8 态仍是唯一事实源，本文件**不**改动它、**不**读它以外的状态；
 * - **不要求逐点手工调用**：唯一调用点 = `ExecutionManager.emitStatus`（本域**唯一 choke point**，
 *   7 处状态转移全部经它，取证见 `ExecutionManager.ts` 的 `emitStatus` 调用点清单）。
 *
 * ## 映射表（`Record<ExecutionStatus, …>` ⇒ **编译期穷尽**：新增原生状态必须显式决定投影）
 * | 原生 | 原语 | 依据 |
 * |---|---|---|
 * | `QUEUED` | `PREPARED` | 已就绪未启动（唯一"非活跃且非终态"态） |
 * | `RUNNING` / `WAITING_USER` / `CANCEL_REQUESTED` | `RUNNING` | 与 `isActiveStatus()` **同界**（持有 session 所有权的在飞态） |
 * | `CANCELLED` / `COMPLETED` / `FAILED` / `STALE` | `SETTLED` | 与 `isTerminalStatus()` **同界**（落定，**不再区分**成败 —— 原生细节不外露） |
 *
 * ⚠️ `WAITING_USER` **不**投成 `SUSPENDED`：`SUSPENDED` 语义是**预算挂起**（方案 §3 ②，尚未实现），
 * 而 `WAITING_USER` 是**在飞**执行（轮次继续、所有权未释放）⇒ 投 `RUNNING`（与 `isActiveStatus` 一致）。
 */

import type { ExecutionStatus } from './types';
import {
  publishStateProjection,
  type ExecutionPrimitive,
} from '../state/engine/projectionBroker.js';

/**
 * 执行域投影表（**唯一映射事实源**；`Record` 保证 8 态全覆盖，缺一即编译失败）。
 */
const EXECUTION_STATUS_PROJECTION: Record<ExecutionStatus, ExecutionPrimitive> =
  {
    QUEUED: 'PREPARED',
    RUNNING: 'RUNNING',
    WAITING_USER: 'RUNNING',
    CANCEL_REQUESTED: 'RUNNING',
    CANCELLED: 'SETTLED',
    COMPLETED: 'SETTLED',
    FAILED: 'SETTLED',
    STALE: 'SETTLED',
  };

/**
 * 执行域**纯函数**投影：原生状态 → 四原语（只读、无副作用、可单测穷尽）。
 */
export function projectExecutionStatus(
  status: ExecutionStatus
): ExecutionPrimitive {
  return EXECUTION_STATUS_PROJECTION[status];
}

/**
 * 广播一条执行域投影（携带 `sessionId` 作对外定位；**不含**任何原生细粒度状态）。
 *
 * 门控在 Broker 内（`FEATURE_STATE_PROJECTION_BROADCAST`）；关闭 ⇒ 不发布。
 */
export function publishExecutionProjection(input: {
  sessionId: string;
  status: ExecutionStatus;
}): void {
  publishStateProjection({
    domain: 'execution',
    primitive: projectExecutionStatus(input.status),
    sessionId: input.sessionId,
  });
}
