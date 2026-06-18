/**
 * 状态机专用错误类型
 *
 * 遵循架构规范（R01-002），所有自定义错误必须继承 AppError。
 * 定义 IllegalTransitionError（非法转移）和 InvalidSnapshotError（非法快照）两个专有错误。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 非法状态转换错误
 *
 * 当状态机尝试执行未在 TransitionRules 中定义的转移时抛出。
 * 例如从 IDLE → COMPLETED 直接跳转。
 */
export class IllegalTransitionError extends AppError {
  /**
   * @param from 当前状态
   * @param to 目标状态
   * @param machineType 状态机类型标识（用于日志溯源）
   */
  constructor(
    from: unknown,
    to: unknown,
    machineType?: string
  ) {
    super(
      `非法状态转换: ${String(from)} → ${String(to)}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'STATE_ILLEGAL_TRANSITION',
      { from: String(from), to: String(to), machineType }
    );
    this.name = 'IllegalTransitionError';
  }
}

/**
 * 非法快照错误
 *
 * 当反序列化快照时发现快照中的状态或历史记录与规则表不匹配时抛出。
 * 例如快照中的 currentState 不在规则表中，或历史记录中存在非法转移。
 */
export class InvalidSnapshotError extends AppError {
  /**
   * @param message 错误描述
   * @param details 详细上下文（含快照信息）
   */
  constructor(
    message: string,
    details?: Record<string, unknown>
  ) {
    super(
      message,
      ErrorCategory.DATA,
      ErrorSeverity.HIGH,
      'STATE_INVALID_SNAPSHOT',
      details
    );
    this.name = 'InvalidSnapshotError';
  }
}
