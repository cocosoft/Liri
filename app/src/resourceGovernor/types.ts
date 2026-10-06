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
}

/** 准入请求 */
export interface AdmissionRequest {
  sessionId: string;
  priority: RequestPriority;
}

/**
 * 准入决策。
 *
 * ⚠️ 当前策略（D4=仅告警不拦截）⇒ `admitted` **恒为 `true`**；字段保留以便后续切换为
 * 排队/拒绝（属独立裁定，本批不做）。
 */
export interface AdmissionDecision {
  admitted: boolean;
  /** 决策后的在飞数（含本次） */
  inFlightCount: number;
  /** 上限（`>0`；见 `ResourceGovernorOptions.maxInflight`） */
  limit: number;
  /** 是否已超上限（**仅观测**：调用方据此告警，不因它改变行为） */
  overLimit: boolean;
}

/** 治理器选项 */
export interface ResourceGovernorOptions {
  /** 并发达上限（仅观测） */
  maxInflight?: number;
}
