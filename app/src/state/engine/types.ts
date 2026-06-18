/**
 * 通用状态引擎类型定义
 *
 * 本文件定义状态机的核心泛型类型，供 StateMachine<S> 及外部使用。
 * 遵循状态机设计文档（dev_docs/20260618/state-machine-design.md）第 3 节。
 */

import type { IllegalTransitionError, InvalidSnapshotError } from '../errors';

export type { IllegalTransitionError, InvalidSnapshotError };

/**
 * 转换规则表
 *
 * 约束为 Record<S, S[]>，S 的每个值对应一个目标状态数组。
 * 当 S extends string 时，Record<S, S[]> 退化为索引签名，
 * 但实际约束仍有效：状态值必须来自 S 的字面量联合。
 */
export type TransitionRules<S extends string> = Record<S, S[]>;

/**
 * 状态转换历史记录条目
 *
 * 记录一次完整的状态转移事件，包含起始状态、目标状态、原因和时间戳。
 */
export interface TransitionRecord<S extends string> {
  /** 转换前状态 */
  from: S;
  /** 转换后状态 */
  to: S;
  /** 转换原因（可选） */
  reason?: string;
  /** 转换发生时间戳 */
  timestamp: number;
  /** 附加元数据（可选，如错误栈信息） */
  metadata?: Record<string, unknown>;
}

/**
 * 状态机快照（用于持久化和恢复）
 *
 * 当规则表跨版本变更（如新增状态）时，旧快照恢复可能失败。
 * 建议在快照中附带 schemaVersion，调用方在反序列化时做版本兼容判断。
 */
export interface StateSnapshot<S extends string> {
  /** 状态机类型标识 */
  machineType: string;
  /** 当前状态 */
  currentState: S;
  /** 转换历史 */
  history: TransitionRecord<S>[];
  /** 快照时间戳 */
  timestamp: number;
  /** 快照 schema 版本（可选，用于跨版本迁移兼容） */
  schemaVersion?: number;
}

/**
 * 状态变更监听器
 *
 * 在每次状态转换成功后触发，参数为（原状态, 新状态, 原因）。
 */
export type StateChangeListener<S extends string> = (
  from: S,
  to: S,
  reason?: string
) => void;

/**
 * 状态机配置参数
 *
 * 控制状态机的初始状态、转移规则、终态判断、活跃判断及历史容量。
 */
export interface StateMachineConfig<S extends string> {
  /** 初始状态 */
  initialState: S;
  /** 转移规则表 */
  rules: TransitionRules<S>;
  /** 自定义终态判断函数（可选，默认使用自动推导） */
  isTerminal?: (state: S) => boolean;
  /** 自定义活跃判断函数（可选） */
  isActive?: (state: S) => boolean;
  /** 历史记录最大条数（可选，默认无限制） */
  maxHistorySize?: number;
  /** 上下文标识，用于日志追踪（可选） */
  contextId?: string;
}
