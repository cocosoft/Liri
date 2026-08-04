/**
 * Channel-Bridge 集成适配器
 *
 * 核心使命：将 Channel 消息系统与 Bridge 分布式任务系统连接起来。
 *
 * 协同模式：
 *   用户 → 企业微信/飞书/钉钉 (Channel) → Agent 理解意图
 *     → 拆分为子任务 → ChannelBridgeAdapter 通过 Bridge 分发到多台机器
 *     → Bridge 机器执行 → 结果回传 → Agent 汇总 → Channel 回复用户
 *
 * 这是一个"1+1>2"的增值层 — Bridge 和 Channel 各自完整独立，此模块仅提供桥接编排。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { channelRegistry } from '@modules/channels/registry/ChannelRegistry';
import type { ChannelId, MessageContext } from '@modules/channels/types';
import type {
  Coordinator,
  CoordinatorTask,
  CoordinatorConfig,
} from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:bridge' });

/**
 * 通道消息转换为 Bridge 任务后的元数据
 */
export interface ChannelTaskMetadata {
  channelId: ChannelId;
  channelName: string;
  senderId: string;
  senderName?: string;
  conversationId?: string;
  originalMessage: string;
  bridgeTaskId: string;
  createdAt: number;
}

/**
 * 跨通道分发选项（coordinator 为必填，其余可选）
 */
export interface ChannelBridgeOptions {
  /** 协作器实例（必填） */
  coordinator: Coordinator;
  /** 是否自动回复进度 */
  autoProgressReply?: boolean;
  /** 进度回复间隔（毫秒） */
  progressIntervalMs?: number;
  /** 单任务最大超时（毫秒） */
  taskTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Omit<ChannelBridgeOptions, 'coordinator'> = {
  autoProgressReply: true,
  progressIntervalMs: 10000,
  taskTimeoutMs: 600000,
};

/**
 * 创建 ChannelBridgeAdapter 的工厂函数
 *
 * coordinator 为必填参数，缺失时抛出 AppError，避免运行时 NPE。
 * 替代 `new ChannelBridgeAdapter({ coordinator })` 的直接构造。
 */
export function createChannelBridgeAdapter(
  coordinator: Coordinator,
  options?: Omit<ChannelBridgeOptions, 'coordinator'>
): ChannelBridgeAdapter {
  if (!coordinator) {
    throw new AppError(
      'ChannelBridgeAdapter 创建失败：coordinator 为必填参数',
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'BRIDGE_COORDINATOR_REQUIRED',
      {}
    );
  }
  return new ChannelBridgeAdapter({ coordinator, ...options });
}

/**
 * Channel-Bridge 适配器
 *
 * 职责：
 *   1. 将 Channel 接收到的用户消息转发为 Bridge 可执行的任务
 *   2. 将 Bridge 执行结果回送到 Channel
 *   3. 管理跨消息会话的上下文连续性
 */
export class ChannelBridgeAdapter {
  private options: Required<ChannelBridgeOptions>;
  private activeDelegations: Map<string, ChannelTaskMetadata> = new Map();

  /**
   * @param options coordinator 为必填，其余可选
   */
  constructor(options: ChannelBridgeOptions) {
    if (!options.coordinator) {
      throw new AppError(
        'ChannelBridgeAdapter 构造失败：coordinator 为必填参数',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'BRIDGE_COORDINATOR_REQUIRED',
        {}
      );
    }
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    } as Required<ChannelBridgeOptions>;
  }

  /**
   * 将 Channel 消息委托给 Bridge 分发执行
   *
   * @param ctx Channel 消息上下文
   * @param taskDescription 任务描述（Agent 理解的意图）
   * @param taskPrompt 实际给 Agent 的 Prompt
   * @returns 委托 ID（可用于查询结果）
   */
  delegateMessage(
    ctx: MessageContext,
    taskDescription: string,
    taskPrompt: string
  ): string {
    const taskId = this.options.coordinator.addTask({
      description: taskDescription,
      prompt: taskPrompt,
      subagentType: 'general',
      priority: 5,
    });

    const meta: ChannelTaskMetadata = {
      channelId: ctx.channelId,
      channelName: ctx.channelId,
      senderId: ctx.senderId,
      senderName: ctx.senderName,
      conversationId: ctx.conversationId,
      originalMessage: ctx.content,
      bridgeTaskId: taskId,
      createdAt: Date.now(),
    };

    this.activeDelegations.set(taskId, meta);

    logger.info(
      `Channel→Bridge 委托: ${ctx.channelId}/${ctx.senderId} → task ${taskId} — "${taskDescription}"`
    );

    return taskId;
  }

  /**
   * 批量分发 — 将一个复杂请求拆分为多个 Bridge 子任务
   *
   * @param ctx 原始 Channel 消息
   * @param subTasks 子任务列表（由 Agent 拆分）
   * @returns 所有子任务 ID
   */
  delegateBatch(
    ctx: MessageContext,
    subTasks: Array<{ description: string; prompt: string; priority?: number }>
  ): string[] {
    const taskInputs = subTasks.map((st) => ({
      description: st.description,
      prompt: st.prompt,
      priority: st.priority || 3,
    }));

    const taskIds = this.options.coordinator.addTasks(taskInputs);

    for (let i = 0; i < taskIds.length; i++) {
      const meta: ChannelTaskMetadata = {
        channelId: ctx.channelId,
        channelName: ctx.channelId,
        senderId: ctx.senderId,
        senderName: ctx.senderName,
        conversationId: ctx.conversationId,
        originalMessage: ctx.content,
        bridgeTaskId: taskIds[i],
        createdAt: Date.now(),
      };
      this.activeDelegations.set(taskIds[i], meta);
    }

    logger.info(
      `Channel→Bridge 批量委托: ${ctx.channelId}/${ctx.senderId} → ${taskIds.length} 个子任务`
    );

    return taskIds;
  }

  /**
   * 获取委托任务的元数据（供查询进度）
   */
  getDelegationMeta(taskId: string): ChannelTaskMetadata | undefined {
    return this.activeDelegations.get(taskId);
  }

  /**
   * 通过 Channel 回复 Bridge 任务进度
   */
  async reportProgress(
    taskId: string,
    progress: string,
    status: 'running' | 'completed' | 'failed'
  ): Promise<boolean> {
    const meta = this.activeDelegations.get(taskId);
    if (!meta) return false;

    const entry = channelRegistry.get(meta.channelId);
    if (!entry || !entry.connected) {
      logger.warning(`无法回复进度: 通道 ${meta.channelId} 未连接`);
      return false;
    }

    const message = this.formatProgressMessage(meta, progress, status);
    try {
      const result = await entry.plugin!.outbound.sendText(
        meta.senderId,
        message
      );
      if (status === 'completed' || status === 'failed') {
        this.activeDelegations.delete(taskId);
      }
      return result;
    } catch (error) {
      void handleError(error as Error, {
        module: 'bridge:adapter',
        action: 'reportProgress',
      });
      logger.error(`Bridge→Channel 回复失败`, error as Error);
      return false;
    }
  }

  /**
   * 通过 Channel 回复 Bridge 任务最终结果
   */
  async reportResult(taskId: string, result: string): Promise<boolean> {
    const meta = this.activeDelegations.get(taskId);
    if (!meta) return false;

    const entry = channelRegistry.get(meta.channelId);
    if (!entry || !entry.connected) {
      logger.warning(`无法回复结果: 通道 ${meta.channelId} 未连接`);
      return false;
    }

    const message = this.formatResultMessage(meta, result);
    try {
      const ok = await entry.plugin!.outbound.sendText(meta.senderId, message);
      this.activeDelegations.delete(taskId);
      logger.info(
        `Bridge→Channel 结果已回复: ${meta.channelId}/${meta.senderId}`
      );
      return ok;
    } catch (error) {
      void handleError(error as Error, {
        module: 'bridge:adapter',
        action: 'reportResult',
      });
      logger.error(`Bridge→Channel 结果回复失败`, error as Error);
      return false;
    }
  }

  /**
   * 检查并回传已完成任务的进度
   */
  async pollAndReport(): Promise<number> {
    let reported = 0;
    const tasks = this.options.coordinator.getAllTasks();

    for (const task of tasks) {
      const meta = this.activeDelegations.get(task.id);
      if (!meta) continue;

      if (task.status === 'completed' && task.result) {
        await this.reportResult(task.id, task.result);
        reported++;
      } else if (task.status === 'failed') {
        await this.reportProgress(task.id, task.error || '执行失败', 'failed');
        reported++;
      } else if (task.status === 'running') {
        const runningCount = this.options.coordinator.getRunningTasks().length;
        await this.reportProgress(
          task.id,
          `执行中... (共 ${this.activeDelegations.size} 个任务, ${runningCount} 个运行中)`,
          'running'
        );
      }
    }

    return reported;
  }

  /**
   * 获取当前活跃的委托数量
   */
  getActiveDelegationCount(): number {
    return this.activeDelegations.size;
  }

  /**
   * 清理所有委托
   */
  clearAll(): void {
    this.activeDelegations.clear();
  }

  private formatProgressMessage(
    meta: ChannelTaskMetadata,
    progress: string,
    _status: string
  ): string {
    const elapsed = ((Date.now() - meta.createdAt) / 1000).toFixed(1);
    return [
      `📋 任务进度 (${meta.bridgeTaskId.slice(-8)})`,
      `⏱ 已运行 ${elapsed}s`,
      `📝 ${progress}`,
    ].join('\n');
  }

  private formatResultMessage(
    meta: ChannelTaskMetadata,
    result: string
  ): string {
    const elapsed = ((Date.now() - meta.createdAt) / 1000).toFixed(1);
    const truncated =
      result.length > 2000 ? result.slice(0, 1997) + '...' : result;
    return [
      `✅ 任务完成 (${meta.bridgeTaskId.slice(-8)})`,
      `⏱ 总耗时 ${elapsed}s`,
      ``,
      truncated,
    ].join('\n');
  }
}
