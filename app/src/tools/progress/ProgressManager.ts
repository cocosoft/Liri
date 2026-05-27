/**
 * 进度跟踪管理器
 * 处理工具执行的进度跟踪和事件传递
 */
import type {
  ToolCallProgress,
  ToolProgressData,
  ToolProgress,
  ToolUseContext,
} from '../types';

/**
 * 进度跟踪管理器类
 */
export class ProgressManager {
  private toolUseId: string;
  private onProgress?: ToolCallProgress<any>;
  private context: ToolUseContext;
  private progressHistory: ToolProgress<any>[] = [];

  /**
   * 构造函数
   * @param toolUseId 工具使用ID
   * @param context 工具使用上下文
   * @param onProgress 进度回调
   */
  constructor(
    toolUseId: string,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ) {
    this.toolUseId = toolUseId;
    this.context = context;
    this.onProgress = onProgress;
  }

  /**
   * 报告进度
   * @param data 进度数据
   */
  reportProgress<P extends ToolProgressData>(data: P): void {
    const progress: ToolProgress<P> = {
      toolUseID: this.toolUseId,
      data,
    };

    // 保存进度历史
    this.progressHistory.push(progress as ToolProgress<any>);

    // 调用进度回调
    if (this.onProgress) {
      this.onProgress(progress);
    }

    // 触发紧凑进度事件（如果需要）
    this.triggerCompactProgressEvent(progress);
  }

  /**
   * 触发紧凑进度事件
   * @param progress 进度数据
   */
  private triggerCompactProgressEvent(progress: ToolProgress<any>): void {
    if (this.context.onCompactProgress) {
      // 这里可以根据进度类型触发不同的紧凑进度事件
      // 例如，当工具开始执行时触发 'compact_start'，结束时触发 'compact_end'
      if (progress.data.isComplete) {
        this.context.onCompactProgress({ type: 'compact_end' });
      } else if (this.progressHistory.length === 1) {
        this.context.onCompactProgress({ type: 'compact_start' });
      }
    }
  }

  /**
   * 获取进度历史
   * @returns 进度历史
   */
  getProgressHistory(): ToolProgress<any>[] {
    return this.progressHistory;
  }

  /**
   * 清除进度历史
   */
  clearProgressHistory(): void {
    this.progressHistory = [];
  }

  /**
   * 设置进度回调
   * @param onProgress 进度回调
   */
  setOnProgress(onProgress?: ToolCallProgress<any>): void {
    this.onProgress = onProgress;
  }
}

/**
 * 创建进度管理器
 * @param toolUseId 工具使用ID
 * @param context 工具使用上下文
 * @param onProgress 进度回调
 * @returns 进度管理器实例
 */
export function createProgressManager(
  toolUseId: string,
  context: ToolUseContext,
  onProgress?: ToolCallProgress<any>
): ProgressManager {
  return new ProgressManager(toolUseId, context, onProgress);
}
