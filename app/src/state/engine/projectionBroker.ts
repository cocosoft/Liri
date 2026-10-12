/**
 * projectionBroker — 四原语**只读投影**的带外广播 Broker（状态机规范管理方案 阶段 4，2026-10-12）。
 *
 * ## 定位（方案 §3 裁定，逐字遵守）
 * 四原语 `PREPARED / RUNNING / SUSPENDED / SETTLED` 是**严格无状态、只读的带外（out-of-band）广播投影**：
 * - **不是第二事实源**：各域原生枚举（`ExecutionStatus` 8 态等）**保持不变**，仍是唯一事实源；
 * - **不承载任何裁决职责**：仅用于统一**跨域遥测信号**（供遥测 / UI / 已解耦的外部分通道适配器消费）；
 * - **不暴露内部细粒度状态**（§4.3）：载荷**只带原语**，**不带** `RUNNING/WAITING_USER/CANCEL_REQUESTED/…`
 *   等原生取值 —— 原生细节一旦上网就成为对外契约，会被消费者依赖（第二事实源化的第一步）。
 *
 * ## 与 `StateMachineRegistry` 的关系（**方案订正**）
 * 阶段 4 原文称「由 `StateMachineRegistry` **直接挂钩** lifecycle dispatch 管线」——**层禁**：
 * `state`(infra) **不可**引用 `execution`(service) 的 `ExecutionStatus`（R00-001；引用即倒挂），
 * 且 `StateMachineRegistry` 本体只是**实例缓存**（`register/find/gc`，无任何 dispatch 管线）。
 * ⇒ 订正为**两层分工**：
 * - **本文件（infra，跨域中性）**：四原语词汇 + 载荷契约 + **广播 Broker**（零域依赖，只认"原语"）；
 * - **域侧映射**（如 `execution/executionProjection.ts`，service）：原生状态 → 四原语的**纯函数**，
 *   并在该域**唯一 choke point** 调用本 Broker ⇒ 满足 §4.1「**不要求开发者手工逐点调用映射**」。
 *
 * ## 广播通道（§4.3）
 * **复用既有 `globalEventBus`**（`core/events/EventBus`）的 `publish` —— 该接口的语义契约是
 * **fire-and-forget**（同步遍历启动监听器、**不 await**、**单监听器异常各自捕获**，见
 * `.trae/specs/eventbus-semantics.md`）⇒ 天然满足"异步带外、失败不回流主链路"。
 * **无独立总线**。
 *
 * ## 开关（telemetry-gated）
 * 由 `FEATURE_STATE_PROJECTION_BROADCAST`（**默认关**）门控 ⇒ 关时**零行为变更**（不映射、不发布）。
 *
 * ## ⚠️ 未接线（如实，UW）
 * - **无生产消费者**：出站订阅面（通道治理方案 §3 阶段 2.3）已裁定**暂缓** ⇒ 当前只有
 *   `globalEventBus` 上的订阅者（含测试）能收到；**不**伪造"已下发到通道"。
 * - **`SUSPENDED` 无生产者**：预算挂起（`long-task-suspend-resume.md`）**未实现**（方案 §3 ②）
 *   ⇒ 本原语目前**不可达**（阶段 5 接入）；词汇保留以免未来改契约。
 * - 本模块**不是**状态机（§3：严格无状态）⇒ **不**登记进 `stateMachineCatalog` 的 `STATE_MACHINES`
 *   （该目录只收"有状态机语义"的定义；阶段 1.4 的 R09-006 亦不识别 `_PRIMITIVES` 形态）。
 */

import { globalEventBus, SystemEvents } from '../../core/events/EventBus.js';
import { feature } from '../../core/featureFlags.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('state:projectionBroker');

/** 四原语（**唯一事实源**；只读投影词汇，非状态机状态集） */
export const EXECUTION_PRIMITIVES = [
  /** 已就绪、尚未开始（域内"排队/准备"语义） */
  'PREPARED',
  /** 进行中 */
  'RUNNING',
  /** 挂起（**当前不可达**：预算挂起未实现，待方案阶段 5） */
  'SUSPENDED',
  /** 已落定（成功 / 失败 / 取消 / 陈旧，**不区分** —— 原生细节不外露） */
  'SETTLED',
] as const;

/** 四原语取值 */
export type ExecutionPrimitive = (typeof EXECUTION_PRIMITIVES)[number];

/**
 * 投影域标识（当前仅 `execution`）。
 *
 * 其余域（toolCall / session / app / task）**本期未投影**，理由逐一取证：
 * - `toolCall`：结算路径**无单一 choke point**（`settleToolCall` / `endToolCall` / `recordToolCall` 三入口 +
 *   直连 store 的恢复路径）⇒ 逐点接线违背 §4.1「不要求手工逐点调用」；
 * - `session` / `app` / `task`：其"对外统一进度态"**无真实消费者**（CS03：不建无消费者的抽象）。
 */
export type StateProjectionDomain = 'execution';

/**
 * 广播载荷（**只读、无原生细粒度状态** —— §4.3）。
 *
 * 刻意**不含**：原生状态字符串、`executionId`/`generation` 等内部标识（对外定位用 `sessionId` 足够，
 * 且 execution 与 session 是**一对一所有权**关系）。
 */
export interface StateProjectionBroadcast {
  /** 投影域 */
  readonly domain: StateProjectionDomain;
  /** 四原语取值 */
  readonly primitive: ExecutionPrimitive;
  /** 关联会话（对外定位） */
  readonly sessionId: string;
  /** 观测时间（epoch ms） */
  readonly at: number;
}

/** 广播开关名（`FEATURE_STATE_PROJECTION_BROADCAST`，默认关） */
export const STATE_PROJECTION_BROADCAST_FLAG = 'STATE_PROJECTION_BROADCAST';

/** 当前是否开启投影广播（telemetry gate） */
export function isStateProjectionBroadcastEnabled(): boolean {
  return feature(STATE_PROJECTION_BROADCAST_FLAG);
}

/**
 * 发布一条四原语投影广播（**纯观测**：开关关 ⇒ no-op；发布异常只留痕，绝不回流调用方）。
 *
 * 调用方（各域 choke point）**只传原语**，不传原生状态 ⇒ 本模块对领域零依赖（infra 可安全被任意层调用）。
 */
export function publishStateProjection(input: {
  domain: StateProjectionDomain;
  primitive: ExecutionPrimitive;
  sessionId: string;
}): void {
  if (!isStateProjectionBroadcastEnabled()) return;

  const payload: StateProjectionBroadcast = {
    domain: input.domain,
    primitive: input.primitive,
    sessionId: input.sessionId,
    at: Date.now(),
  };

  try {
    // fire-and-forget：`publish` 同步启动监听器即返回、不 await，单监听器异常各自捕获
    globalEventBus.publish(SystemEvents.STATE_PROJECTED, payload);
  } catch (err) {
    // 观测面失败只留痕（CS03：不把观测面失败升级为主链路失败）
    logger.warn('state projection broadcast failed（观测面失败仅留痕）', {
      domain: payload.domain,
      primitive: payload.primitive,
      sessionId: payload.sessionId,
      error: String(err),
    });
  }
}
