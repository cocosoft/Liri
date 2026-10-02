/**
 * 工具进度数据
 * 定义工具执行的进度数据，包括进度百分比、状态消息等
 */

/**
 * 工具进度数据
 */
export interface ToolProgressData {
  /** 进度百分比（0-100） */
  percentage: number;
  /** 状态消息 */
  message: string;
  /** 进度阶段 */
  stage: string;
  /** 已完成的任务数 */
  completedTasks?: number;
  /** 总任务数 */
  totalTasks?: number;
  /** 估计剩余时间（毫秒） */
  estimatedTimeRemaining?: number;
  /** 进度时间戳 */
  timestamp: number;
  /** 进度数据 */
  data?: Record<string, unknown>;
}

/**
 * 创建工具进度数据
 * @param options 进度选项
 * @returns 工具进度数据
 */
export function createToolProgressData(
  options: Partial<ToolProgressData>
): ToolProgressData {
  return {
    percentage: 0,
    message: '',
    stage: 'initializing',
    timestamp: Date.now(),
    ...options,
  };
}

/**
 * 创建开始进度数据
 * @param stage 进度阶段
 * @returns 工具进度数据
 */
export function createStartProgress(stage: string): ToolProgressData {
  return createToolProgressData({
    percentage: 0,
    message: `Starting ${stage}`,
    stage,
  });
}

/**
 * 创建完成进度数据
 * @param stage 进度阶段
 * @returns 工具进度数据
 */
export function createCompleteProgress(stage: string): ToolProgressData {
  return createToolProgressData({
    percentage: 100,
    message: `Completed ${stage}`,
    stage,
  });
}

/**
 * 创建中间进度数据
 * @param stage 进度阶段
 * @param percentage 进度百分比
 * @param message 状态消息
 * @returns 工具进度数据
 */
export function createProgress(
  stage: string,
  percentage: number,
  message: string
): ToolProgressData {
  return createToolProgressData({
    percentage,
    message,
    stage,
  });
}
