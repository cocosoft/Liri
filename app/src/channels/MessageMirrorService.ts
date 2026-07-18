/**
 * 消息镜像服务
 * 对标 Hermes gateway/mirror.py
 * 将消息从一个平台同步镜像到另一个或多个平台
 */
import type { ChannelId, MessageContext } from './types/IChannel';
import { getDeliveryRouter } from './DeliveryRouter';
import { DeliveryTarget } from './DeliveryTarget';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'channels:MessageMirrorService', level: LogLevel.INFO });

/**
 * 镜像规则
 */
export interface MirrorRule {
  /** 规则名称 */
  name: string;
  /** 源平台 */
  sourcePlatform: ChannelId;
  /** 目标平台 */
  targetPlatforms: ChannelId[];
  /** 镜像条件过滤 */
  filter?: {
    isDirectMessage?: boolean;
    groupIds?: string[];
    senderIds?: string[];
  };
  /** 是否添加来源标记 */
  addSourceTag: boolean;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 镜像记录
 */
export interface MirrorRecord {
  id: string;
  sourcePlatform: ChannelId;
  sourceConversationId: string;
  targetPlatform: ChannelId;
  targetConversationId: string;
  originalContent: string;
  mirroredContent: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

/**
 * 镜像配置
 */
export interface MirrorConfig {
  /** 是否全局启用镜像 */
  enabled: boolean;
  /** 最大历史记录数 */
  maxHistory: number;
  /** 是否镜像入站消息 */
  mirrorInbound: boolean;
  /** 是否镜像出站消息 */
  mirrorOutbound: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_MIRROR_CONFIG: MirrorConfig = {
  enabled: false,
  maxHistory: 1000,
  mirrorInbound: true,
  mirrorOutbound: true,
};

/**
 * 消息镜像服务
 */
export class MessageMirrorService {
  private rules: Map<string, MirrorRule> = new Map();
  private history: MirrorRecord[] = [];
  private config: MirrorConfig;

  /**
   * 构造函数
   * @param config 镜像配置
   */
  constructor(config?: Partial<MirrorConfig>) {
    this.config = { ...DEFAULT_MIRROR_CONFIG, ...config };
  }

  /**
   * 添加镜像规则
   * @param rule 镜像规则
   */
  addRule(rule: MirrorRule): void {
    this.rules.set(rule.name, rule);
  }

  /**
   * 移除镜像规则
   * @param name 规则名称
   */
  removeRule(name: string): void {
    this.rules.delete(name);
  }

  /**
   * 获取所有规则
   */
  getRules(): MirrorRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): MirrorRule[] {
    return this.getRules().filter((r) => r.enabled);
  }

  /**
   * 镜像入站消息
   * @param context 消息上下文
   * @param content 消息内容
   * @returns 镜像记录列表
   */
  async mirrorInboundMessage(
    context: MessageContext,
    content: string
  ): Promise<MirrorRecord[]> {
    if (!this.config.enabled || !this.config.mirrorInbound) {
      return [];
    }

    return this.mirror(
      context.channelId,
      context.conversationId || context.senderId,
      content,
      'inbound'
    );
  }

  /**
   * 镜像出站消息
   * @param sourcePlatform 源平台
   * @param sourceConversationId 源会话 ID
   * @param content 消息内容
   * @returns 镜像记录列表
   */
  async mirrorOutboundMessage(
    sourcePlatform: ChannelId,
    sourceConversationId: string,
    content: string
  ): Promise<MirrorRecord[]> {
    if (!this.config.enabled || !this.config.mirrorOutbound) {
      return [];
    }

    return this.mirror(
      sourcePlatform,
      sourceConversationId,
      content,
      'outbound'
    );
  }

  /**
   * 执行镜像
   * @param sourcePlatform 源平台
   * @param sourceConversationId 源会话 ID
   * @param content 原始内容
   * @param direction 消息方向
   * @returns 镜像记录列表
   */
  private async mirror(
    sourcePlatform: ChannelId,
    sourceConversationId: string,
    content: string,
    direction: 'inbound' | 'outbound'
  ): Promise<MirrorRecord[]> {
    const records: MirrorRecord[] = [];
    const matchingRules = this.getEnabledRules().filter(
      (r) => r.sourcePlatform === sourcePlatform
    );

    if (matchingRules.length === 0) {
      return [];
    }

    const router = getDeliveryRouter();

    for (const rule of matchingRules) {
      let mirroredContent = content;

      if (rule.addSourceTag) {
        const tag =
          direction === 'inbound'
            ? `[来自 ${sourcePlatform}]`
            : `[由 ${sourcePlatform} 发出]`;
        mirroredContent = `${tag}\n${content}`;
      }

      for (const targetPlatform of rule.targetPlatforms) {
        const target = new DeliveryTarget(targetPlatform, sourceConversationId);

        try {
          const result = await router.deliverToTarget(target, mirroredContent);

          const record: MirrorRecord = {
            id: `mirror_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sourcePlatform,
            sourceConversationId,
            targetPlatform,
            targetConversationId: sourceConversationId,
            originalContent: content.slice(0, 500),
            mirroredContent: mirroredContent.slice(0, 500),
            success: result.success,
            error: result.error,
            timestamp: Date.now(),
          };

          records.push(record);
          this.addToHistory(record);
        } catch (err) {
          const record: MirrorRecord = {
            id: `mirror_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sourcePlatform,
            sourceConversationId,
            targetPlatform,
            targetConversationId: sourceConversationId,
            originalContent: content.slice(0, 500),
            mirroredContent: mirroredContent.slice(0, 500),
            success: false,
            error: err instanceof Error ? err.message : '镜像失败',
            timestamp: Date.now(),
          };

          records.push(record);
          this.addToHistory(record);
        }
      }
    }

    return records;
  }

  /**
   * 添加记录到历史
   * @param record 镜像记录
   */
  private addToHistory(record: MirrorRecord): void {
    this.history.push(record);

    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }
  }

  /**
   * 获取镜像历史
   * @param limit 最大条数
   * @returns 镜像记录列表
   */
  getHistory(limit?: number): MirrorRecord[] {
    const sorted = [...this.history].sort((a, b) => b.timestamp - a.timestamp);

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 获取镜像统计
   */
  getStats(): {
    total: number;
    succeeded: number;
    failed: number;
    byPlatform: Record<string, number>;
  } {
    const byPlatform: Record<string, number> = {};

    for (const record of this.history) {
      const key = `${record.sourcePlatform}→${record.targetPlatform}`;
      byPlatform[key] = (byPlatform[key] || 0) + 1;
    }

    return {
      total: this.history.length,
      succeeded: this.history.filter((r) => r.success).length,
      failed: this.history.filter((r) => !r.success).length,
      byPlatform,
    };
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<MirrorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.history = [];
  }
}

/**
 * 全局镜像服务实例
 */
let globalMirrorService: MessageMirrorService | null = null;

/**
 * 获取全局消息镜像服务
 */
export function getMessageMirrorService(): MessageMirrorService {
  if (!globalMirrorService) {
    globalMirrorService = new MessageMirrorService();
  }

  return globalMirrorService;
}

/**
 * 重置全局镜像服务
 */
export function resetMessageMirrorService(): void {
  globalMirrorService = null;
}
