/**
 * StateMachine — 泛型状态机引擎
 *
 * 提供状态转换校验、监听器通知、历史记录、快照序列化等核心能力。
 * 支持自动终态推导（computeDefaultTerminal）和反序列化校验（fromSnapshot）。
 *
 * @typeParam S 状态枚举的字面量联合类型（如 'idle' | 'running' | 'completed'）
 */

import { getLogger, getOTelTracing } from '@modules/monitoring';
import { IllegalTransitionError, InvalidSnapshotError } from '../errors';
import type {
  TransitionRules,
  TransitionRecord,
  StateSnapshot,
  StateChangeListener,
  StateMachineConfig,
} from './types';

const logger = getLogger('state:machine');

/**
 * 提取当前活跃 span 的 traceId/spanId（链路追踪埋点用）。
 * 无活跃 span（如非 HTTP 上下文/OTel 未初始化）时返回空对象，不抛错。
 */
function getTraceContext(): { traceId?: string; spanId?: string } {
  try {
    const span = getOTelTracing().getActiveSpan();
    if (!span) return {};
    const { traceId, spanId } = span.spanContext();
    return { traceId, spanId };
  } catch {
    return {};
  }
}

/**
 * 从规则表自动推导终态集合
 *
 * 终态定义为规则表中出度为 0 的状态（没有任何可转移的目标）。
 * 例如规则表 `{ idle: ['running'], running: ['completed'], completed: [] }`
 * 则 `completed` 出度为 0，被识别为终态。
 *
 * @param rules 转移规则表
 * @returns 终态判定函数
 */
export function computeDefaultTerminal<S extends string>(
  rules: TransitionRules<S>
): (state: S) => boolean {
  const terminalSet = new Set<S>();

  for (const [state, targets] of Object.entries(rules)) {
    if ((targets as S[]).length === 0) {
      terminalSet.add(state as S);
    }
  }

  return (state: S): boolean => terminalSet.has(state);
}

export class StateMachine<S extends string> {
  private currentState: S;
  private readonly rules: TransitionRules<S>;
  private readonly isTerminalFn: (state: S) => boolean;
  private readonly isActiveFn?: (state: S) => boolean;
  private readonly maxHistorySize?: number;
  private readonly contextId: string;
  private readonly criticalStates: Set<S>;
  private readonly onTransition?: (record: TransitionRecord<S>) => void;

  protected history: TransitionRecord<S>[] = [];
  private listeners: Set<StateChangeListener<S>> = new Set();

  /**
   * @param config 状态机构造配置
   */
  constructor(config: StateMachineConfig<S>) {
    this.currentState = config.initialState;
    this.rules = config.rules;
    this.isTerminalFn =
      config.isTerminal ?? computeDefaultTerminal(config.rules);
    this.isActiveFn = config.isActive;
    this.maxHistorySize = config.maxHistorySize;
    this.contextId = config.contextId ?? 'unknown';
    this.criticalStates = new Set(config.criticalStates ?? []);
    this.onTransition = config.onTransition;

    // 校验初始状态是否在规则表中
    if (!(this.currentState in this.rules)) {
      throw new InvalidSnapshotError(
        `初始状态 ${String(this.currentState)} 未在规则表中定义`,
        { initialState: this.currentState, contextId: this.contextId }
      );
    }
  }

  // ============================================================
  // 查询方法
  // ============================================================

  /**
   * 获取当前状态
   */
  getState(): S {
    return this.currentState;
  }

  /**
   * 获取上下文标识
   */
  getContextId(): string {
    return this.contextId;
  }

  /**
   * 获取转换历史（不可变快照）
   */
  getHistory(): readonly TransitionRecord<S>[] {
    return [...this.history];
  }

  /**
   * 检查当前状态是否为终态
   */
  isTerminal(): boolean {
    return this.isTerminalFn(this.currentState);
  }

  /**
   * 检查当前状态是否活跃
   */
  isActive(): boolean {
    return this.isActiveFn ? this.isActiveFn(this.currentState) : false;
  }

  /**
   * 检查指定状态是否为终态
   */
  isStateTerminal(state: S): boolean {
    return this.isTerminalFn(state);
  }

  /**
   * 获取指定状态的可达目标状态列表
   */
  getAllowedTransitions(state?: S): readonly S[] {
    const s = state ?? this.currentState;
    return this.rules[s] ?? [];
  }

  /**
   * 检查指定转移是否合法
   */
  canTransition(to: S): boolean {
    const allowed = this.rules[this.currentState];
    return allowed !== undefined && allowed.includes(to);
  }

  // ============================================================
  // 状态转换
  // ============================================================

  /**
   * 执行状态转换
   *
   * @param to 目标状态
   * @param reason 转换原因（可选，用于日志和历史记录）
   * @param metadata 附加元数据（可选，如错误栈信息）
   * @returns 转换成功返回 true
   * @throws IllegalTransitionError 当转移不被规则表允许时抛出
   */
  transition(
    to: S,
    reason?: string,
    metadata?: Record<string, unknown>
  ): boolean {
    const from = this.currentState;

    // 链路追踪埋点：转移前捕获当前活跃 span 的 traceId/spanId（断网场景排查用）
    const trace = getTraceContext();
    logger.debug('状态转移开始', {
      contextId: this.contextId,
      from,
      to,
      reason,
      ...trace,
    });

    if (from === to) {
      logger.debug(`状态未变: ${from}`, {
        contextId: this.contextId,
        ...trace,
      });
      return true;
    }

    const allowed = this.rules[from];
    if (!allowed || !allowed.includes(to)) {
      throw new IllegalTransitionError(from, to, this.contextId);
    }

    const prevState = this.currentState;
    this.currentState = to;

    const record: TransitionRecord<S> = {
      from: prevState,
      to,
      reason,
      metadata: metadata ?? trace,
      timestamp: Date.now(),
    };
    this.history.push(record);

    // 限制历史记录容量（P2-32 修复：splice 批量移除替代 slice 全量复制）
    if (
      this.maxHistorySize !== undefined &&
      this.history.length > this.maxHistorySize
    ) {
      this.history.splice(0, this.history.length - this.maxHistorySize);
    }

    // §十 阶段 B 日志分级：进入关键状态（ERROR/PAUSED）至少 warn，常规转移 debug
    const isCritical = this.criticalStates.has(to);
    if (isCritical) {
      logger.warn(`状态转换(关键): ${from} → ${to}`, {
        contextId: this.contextId,
        reason,
        ...trace,
      });
    } else {
      logger.debug(`状态转换: ${from} → ${to}`, {
        contextId: this.contextId,
        reason,
        ...trace,
      });
    }

    // §十 阶段 B：转移事件发布钩子（引擎级，与 listener 机制并存）
    try {
      this.onTransition?.(record);
    } catch (err) {
      logger.error('状态转换发布钩子执行异常', {
        contextId: this.contextId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.notifyListeners(prevState, to, reason);
    return true;
  }

  // ============================================================
  // 监听器管理
  // ============================================================

  /**
   * 注册状态变更监听器
   *
   * @returns 取消注册的函数
   */
  onStateChange(listener: StateChangeListener<S>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 移除指定监听器
   */
  offStateChange(listener: StateChangeListener<S>): void {
    this.listeners.delete(listener);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  // ============================================================
  // 快照与恢复
  // ============================================================

  /**
   * 创建当前状态机的快照
   *
   * 可用于持久化（存入数据库）或传输到其他进程恢复。
   */
  snapshot(machineType: string, schemaVersion?: number): StateSnapshot<S> {
    return {
      machineType,
      currentState: this.currentState,
      history: [...this.history],
      timestamp: Date.now(),
      schemaVersion,
    };
  }

  /**
   * 从快照恢复状态机
   *
   * 恢复时会校验：
   * 1. currentState 必须在规则表中定义
   * 2. 历史记录中每条转移都必须合法
   *
   * @param snapshot 快照对象
   * @param config 状态机配置（与构造函数相同）
   * @returns 恢复后的状态机实例
   * @throws InvalidSnapshotError 当快照数据与规则表不匹配时抛出
   */
  static fromSnapshot<S extends string>(
    snapshot: StateSnapshot<S>,
    config: StateMachineConfig<S>
  ): StateMachine<S> {
    // 校验 currentState 是否在规则表中
    if (!(snapshot.currentState in config.rules)) {
      throw new InvalidSnapshotError(
        `快照中的当前状态 ${String(snapshot.currentState)} 未在规则表中定义`,
        {
          currentState: snapshot.currentState,
          validStates: Object.keys(config.rules),
          machineType: snapshot.machineType,
        }
      );
    }

    // 校验每条历史记录是否合法
    for (let i = 0; i < snapshot.history.length; i++) {
      const record = snapshot.history[i];
      const allowed = config.rules[record.from];
      if (!allowed || !allowed.includes(record.to)) {
        throw new InvalidSnapshotError(
          `快照中的历史记录 #${i} 包含非法转移: ${String(record.from)} → ${String(record.to)}`,
          {
            index: i,
            from: record.from,
            to: record.to,
            machineType: snapshot.machineType,
          }
        );
      }
    }

    const machine = new StateMachine<S>({
      ...config,
      initialState: snapshot.currentState,
    });

    machine.history = [...snapshot.history];

    return machine;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 通知所有已注册的监听器
   */
  private notifyListeners(from: S, to: S, reason?: string): void {
    for (const listener of this.listeners) {
      try {
        listener(from, to, reason);
      } catch (err) {
        logger.error('状态变更监听器执行异常', {
          contextId: this.contextId,
          from,
          to,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
