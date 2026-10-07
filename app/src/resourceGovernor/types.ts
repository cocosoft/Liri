// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 跨会话资源治理（A5，2026-10-05）—— 契约与决策结构
 *
 * 范围（用户裁定 D1=A / D4=仅告警不拦截，见 `.trae/specs/cross-session-resource-governor.md`）：
 * 统一**在飞会话只读视图** + 并发上限**观测**；**不做**抢占（抢占=中止/挂起另立专项）。
 */

import type { RequestPriority } from '@modules/types/requestPriority';

/** 在飞请求条目（只读视图元素；CS02：结构化字段） */
export interface InFlightEntry {
  sessionId: string;
  priority: RequestPriority;
  /** 准入时间戳（保留首次准入值，重复准入不刷新） */
  startedAt: number;
  /**
   * 是否已被抢占（P26-1 §9.2 D6=B，2026-10-07）
   *
   * 双重用途：① **幂等** —— 已被抢占者不再作为 victim 候选（避免重复中止/重复告警）；
   * ② **留痕** —— B 案抢占**不落检查点**（用户可见回复被丢弃）⇒ 该标记供 UI/日志
   * 区分"用户中止"与"被抢占"。
   */
  preempted?: boolean;
}

/** 准入请求 */
export interface AdmissionRequest {
  sessionId: string;
  priority: RequestPriority;
}

/** 抢占回调（D6=B；由**组合根**注入 ⇒ 治理器不硬依赖 chat 层，见 §9.2） */
export type PreemptHandler = (
  victimSessionId: string,
  requesterSessionId: string
) => void;

/**
 * 治理事件状态（**前端相位 PC-2**，2026-10-07；CS02：结构化枚举，非文案匹配）
 *
 * - `preempted`：本会话被**更高优先级**的跨会话请求抢占（流已中止、回复丢弃）；
 * - `queued`：本会话超限且无可抢占候选 ⇒ 正在排队等待名额；
 * - `released`：名额已移交 / 排队超时放行 ⇒ 前端**清除**该会话的排队提示。
 */
export type GovernanceState = 'preempted' | 'queued' | 'released';

/** 治理事件（供前端**区分**"被抢占"/"排队中"与"用户中止"） */
export interface GovernanceEvent {
  sessionId: string;
  state: GovernanceState;
  /** 排队位置（1-based；仅 `queued` 携带） */
  queuePosition?: number;
}

/** 治理事件观察者（**组合根**注入 ⇒ 治理器零传输依赖；缺省 ⇒ 仅日志，不下发） */
export type GovernanceObserver = (event: GovernanceEvent) => void;

/**
 * 准入决策。
 *
 * ⚠️ `admitted` **恒为 `true`**（D4 语义未变；抢占**不改变本次请求的准入结果**）。
 */
export interface AdmissionDecision {
  admitted: boolean;
  /** 决策后的在飞数（含本次） */
  inFlightCount: number;
  /** 上限（`>0`；见 `ResourceGovernorOptions.maxInflight`） */
  limit: number;
  /** 是否已超上限（P26-1 前为**仅观测**；启用抢占后见 `preempted`） */
  overLimit: boolean;
  /** 本次准入抢占掉的会话 id（D6=B）；未抢占 / 未注入回调 ⇒ **空数组** */
  preempted: string[];
}

/** 治理器选项 */
export interface ResourceGovernorOptions {
  /** 并发达上限（超出后按 D6/D7 处置） */
  maxInflight?: number;
  /** 抢占回调（见 `PreemptHandler`）；**缺省 ⇒ 不抢占**（超限退回阶段 1 的"仅告警"） */
  onPreempt?: PreemptHandler;
  /** 治理事件观察者（见 `GovernanceObserver`）；**缺省 ⇒ 仅日志，不下发** */
  onEvent?: GovernanceObserver;
}

/** 排队等待选项（D7=b，P26-1 §9.4） */
export interface QueueOptions {
  /**
   * 排队等待名额释放的上限（毫秒）；**超时按裁定 D12「告警 + 放行」**处理（不拒绝）。
   * 缺省见 `DEFAULT_QUEUE_TIMEOUT_MS`。
   */
  timeoutMs?: number;
}
