/**
 * 分析元数据服务
 * 提供事件元数据增强和PII保护功能
 * 参考CC源码: cc_code/backend/services/analytics/metadata.ts
 */

import { hostname, platform, type } from 'os';
import { env } from 'process';

/**
 * 分析元数据类型标记
 * 用于验证元数据不包含敏感信息
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never;

/**
 * 环境元数据
 */
export interface EnvironmentMetadata {
  platform: NodeJS.Platform;
  hostname: string;
  nodeVersion: string;
  appVersion?: string;
  environment?: string;
}

/**
 * 会话元数据
 */
export interface SessionMetadata {
  sessionId: string;
  parentSessionId?: string;
  clientType: string;
  isInteractive: boolean;
  startTime: number;
}

/**
 * 用户元数据
 */
export interface UserMetadata {
  userId?: string;
  organizationId?: string;
  accountId?: string;
  userType?: string;
  subscriptionType?: string;
  email?: string;
}

/**
 * 事件上下文
 */
export interface EventContext {
  environment?: EnvironmentMetadata;
  session?: SessionMetadata;
  user?: UserMetadata;
  agentId?: string;
  model?: string;
  toolName?: string;
  commandName?: string;
}

/**
 * 分析元数据服务类
 */
export class AnalyticsMetadataService {
  private static instance: AnalyticsMetadataService;
  private environmentMetadata: EnvironmentMetadata;
  private sessionMetadata: SessionMetadata | null = null;
  private userMetadata: UserMetadata | null = null;

  private constructor() {
    this.environmentMetadata = this.collectEnvironmentMetadata();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AnalyticsMetadataService {
    if (!AnalyticsMetadataService.instance) {
      AnalyticsMetadataService.instance = new AnalyticsMetadataService();
    }
    return AnalyticsMetadataService.instance;
  }

  /**
   * 收集环境元数据
   */
  private collectEnvironmentMetadata(): EnvironmentMetadata {
    return {
      platform: platform(),
      hostname: hostname(),
      nodeVersion: process.version,
      appVersion: env.npm_package_version,
      environment: env.NODE_ENV,
    };
  }

  /**
   * 设置会话元数据
   */
  setSessionMetadata(metadata: Partial<SessionMetadata>): void {
    if (!this.sessionMetadata) {
      this.sessionMetadata = {
        sessionId: '',
        clientType: 'unknown',
        isInteractive: true,
        startTime: Date.now(),
      };
    }
    this.sessionMetadata = { ...this.sessionMetadata, ...metadata };
  }

  /**
   * 设置用户元数据
   */
  setUserMetadata(metadata: Partial<UserMetadata>): void {
    if (!this.userMetadata) {
      this.userMetadata = {};
    }
    this.userMetadata = { ...this.userMetadata, ...metadata };
  }

  /**
   * 获取环境元数据
   */
  getEnvironmentMetadata(): EnvironmentMetadata {
    return { ...this.environmentMetadata };
  }

  /**
   * 获取会话元数据
   */
  getSessionMetadata(): SessionMetadata | null {
    return this.sessionMetadata ? { ...this.sessionMetadata } : null;
  }

  /**
   * 获取用户元数据
   */
  getUserMetadata(): UserMetadata | null {
    return this.userMetadata ? { ...this.userMetadata } : null;
  }

  /**
   * 构建事件上下文
   */
  buildEventContext(additionalContext?: Partial<EventContext>): EventContext {
    const context: EventContext = {
      environment: this.getEnvironmentMetadata(),
      session: this.getSessionMetadata() || undefined,
      user: this.getUserMetadata() || undefined,
      ...additionalContext,
    };

    return context;
  }

  /**
   * 脱敏工具名称
   * MCP工具名称可能包含用户特定的配置信息
   */
  sanitizeToolName(
    toolName: string
  ): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
    if (toolName.startsWith('mcp__')) {
      return 'mcp_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
    return toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
  }

  /**
   * 检查是否启用详细工具名称日志
   */
  isToolDetailsLoggingEnabled(): boolean {
    return (
      env.OTEL_LOG_TOOL_DETAILS === '1' || env.OTEL_LOG_TOOL_DETAILS === 'true'
    );
  }

  /**
   * 脱敏文件路径
   * 移除用户特定的路径信息
   */
  sanitizeFilePath(filePath: string): string {
    const homeDir = env.HOME || env.USERPROFILE || '';
    if (homeDir && filePath.startsWith(homeDir)) {
      return filePath.replace(homeDir, '~');
    }
    return filePath;
  }

  /**
   * 脱敏URL
   * 移除URL中的敏感信息
   */
  sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * 脱敏错误消息
   * 移除错误消息中的敏感信息
   */
  sanitizeErrorMessage(message: string): string {
    let sanitized = message;

    const homeDir = env.HOME || env.USERPROFILE || '';
    if (homeDir) {
      sanitized = sanitized.replace(new RegExp(homeDir, 'g'), '~');
    }

    const tokenPattern = /sk-[a-zA-Z0-9]{20,}/g;
    sanitized = sanitized.replace(tokenPattern, 'sk-***');

    return sanitized;
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.sessionMetadata = null;
    this.userMetadata = null;
  }
}

/**
 * 导出单例
 */
export const analyticsMetadataService = AnalyticsMetadataService.getInstance();
