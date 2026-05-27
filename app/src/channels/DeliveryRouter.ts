/**
 * DeliveryRouter 消息投递路由器
 * 对标 Hermes gateway/ 的 DeliveryRouter
 * 支持 origin/local/指定平台 三种路由模式
 */
import { DeliveryTarget } from './DeliveryTarget';
import { ChannelRegistry, channelRegistry } from './registry/ChannelRegistry';
import type { ChannelId } from './types/IChannel';

/**
 * 投递模式
 */
export type DeliveryMode = 'origin' | 'local' | 'targeted';

/**
 * 投递任务
 */
export interface DeliveryTask {
  target: DeliveryTarget;
  content: string;
  mode: DeliveryMode;
  priority: number;
}

/**
 * 投递结果
 */
export interface DeliveryResult {
  success: boolean;
  target: DeliveryTarget;
  error?: string;
  latencyMs?: number;
}

/**
 * 批量投递结果
 */
export interface BatchDeliveryResult {
  total: number;
  succeeded: number;
  failed: number;
  results: DeliveryResult[];
}

/**
 * 投递路由器
 */
export class DeliveryRouter {
  private registry: ChannelRegistry;
  private localOutputFn:
    | ((content: string, target?: DeliveryTarget) => void)
    | null;

  /**
   * 构造函数
   * @param registry 通道注册中心
   */
  constructor(registry?: ChannelRegistry) {
    this.registry = registry || channelRegistry;
    this.localOutputFn = null;
  }

  /**
   * 设置本地输出函数（CLI 模式）
   * @param fn 本地输出函数
   */
  setLocalOutput(fn: (content: string, target?: DeliveryTarget) => void): void {
    this.localOutputFn = fn;
  }

  /**
   * 按 origin 模式投递消息（回复到消息来源平台）
   * @param platform 来源平台
   * @param conversationId 会话 ID
   * @param content 消息内容
   * @returns 投递结果
   */
  async deliverToOrigin(
    platform: ChannelId,
    conversationId: string,
    content: string
  ): Promise<DeliveryResult> {
    const target = DeliveryTarget.fromOrigin(platform, conversationId);

    return this.deliverToTarget(target, content);
  }

  /**
   * 按 local 模式投递消息（仅本地输出）
   * @param content 消息内容
   * @returns 投递结果
   */
  async deliverLocal(content: string): Promise<DeliveryResult> {
    const target = new DeliveryTarget('telegram' as ChannelId, 'local');

    if (this.localOutputFn) {
      this.localOutputFn(content, target);
    } else {
      console.log(`[LOCAL] ${content}`);
    }

    return {
      success: true,
      target,
      latencyMs: 0,
    };
  }

  /**
   * 按指定目标投递消息
   * @param target 投递目标
   * @param content 消息内容
   * @returns 投递结果
   */
  async deliverToTarget(
    target: DeliveryTarget,
    content: string
  ): Promise<DeliveryResult> {
    const channel = this.registry.get(target.platform);

    if (!channel) {
      return {
        success: false,
        target,
        error: `通道 ${target.platform} 未注册`,
      };
    }

    if (!channel.enabled) {
      return {
        success: false,
        target,
        error: `通道 ${target.platform} 已禁用`,
      };
    }

    const startTime = Date.now();

    try {
      const success = await channel.sendMessage(target.chatId, content);

      return {
        success,
        target,
        latencyMs: Date.now() - startTime,
        error: success ? undefined : '发送失败',
      };
    } catch (err) {
      return {
        success: false,
        target,
        error: err instanceof Error ? err.message : '未知错误',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 广播消息到所有已启用的通道
   * @param content 消息内容
   * @returns 批量投递结果
   */
  async broadcast(content: string): Promise<BatchDeliveryResult> {
    const enabledChannels = this.registry.getEnabled();
    const tasks: DeliveryTask[] = enabledChannels.map((ch) => ({
      target: new DeliveryTarget(ch.name as ChannelId, 'broadcast'),
      content,
      mode: 'targeted' as DeliveryMode,
      priority: 0,
    }));

    return this.deliverBatch(tasks);
  }

  /**
   * 批量投递消息
   * @param tasks 投递任务列表
   * @returns 批量投递结果
   */
  async deliverBatch(tasks: DeliveryTask[]): Promise<BatchDeliveryResult> {
    const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority);

    const results: DeliveryResult[] = [];

    for (const task of sortedTasks) {
      if (task.mode === 'local') {
        const result = await this.deliverLocal(task.content);
        results.push(result);
      } else {
        const result = await this.deliverToTarget(task.target, task.content);
        results.push(result);
      }
    }

    const succeeded = results.filter((r) => r.success).length;

    return {
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  }

  /**
   * 自动选择投递模式
   * 如果有明确的 target，用 targeted 模式；否则用 origin 模式
   * @param platform 来源平台
   * @param conversationId 会话 ID
   * @param content 消息内容
   * @param explicitTarget 显式目标（可选）
   * @returns 投递结果
   */
  async route(
    platform: ChannelId,
    conversationId: string,
    content: string,
    explicitTarget?: DeliveryTarget
  ): Promise<DeliveryResult> {
    if (explicitTarget) {
      return this.deliverToTarget(explicitTarget, content);
    }

    return this.deliverToOrigin(platform, conversationId, content);
  }

  /**
   * 检查目标平台是否可用
   * @param platform 平台 ID
   * @returns 是否可用
   */
  isPlatformAvailable(platform: ChannelId): boolean {
    const channel = this.registry.get(platform);

    return !!channel && channel.enabled;
  }

  /**
   * 获取所有可用的平台列表
   * @returns 平台 ID 列表
   */
  getAvailablePlatforms(): ChannelId[] {
    return this.registry.getEnabled().map((ch) => ch.name as ChannelId);
  }
}

/**
 * 全局投递路由器实例
 */
let globalDeliveryRouter: DeliveryRouter | null = null;

/**
 * 获取全局投递路由器实例
 * @returns DeliveryRouter 实例
 */
export function getDeliveryRouter(registry?: ChannelRegistry): DeliveryRouter {
  if (!globalDeliveryRouter) {
    globalDeliveryRouter = new DeliveryRouter(registry);
  }

  return globalDeliveryRouter;
}

/**
 * 重置全局投递路由器
 */
export function resetDeliveryRouter(): void {
  globalDeliveryRouter = null;
}
