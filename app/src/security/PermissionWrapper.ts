/**
 * 权限包装器
 * 对标 CC Code QueryEngine 中 wrappedCanUseTool 模式
 *
 * 包装权限检查函数，自动收集非 allow 行为的拒绝记录，
 * 用于审计追踪和 SDK 上报。
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 权限检查行为类型
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  behavior: PermissionBehavior;
  reason?: string;
  requiresApproval?: boolean;
}

/**
 * 权限检查函数签名
 */
export type PermissionCheckFn = (
  toolName: string,
  toolInput: Record<string, unknown>,
  context?: Record<string, unknown>
) => Promise<PermissionCheckResult>;

/**
 * 单条权限拒绝记录（对标 CC Code SDKPermissionDenial）
 */
export interface PermissionDenialRecord {
  /** 工具名称 */
  toolName: string;
  /** 工具调用标识 */
  toolUseId: string;
  /** 工具输入参数 */
  toolInput: Record<string, unknown>;
  /** 拒绝行为类型 */
  behavior: PermissionBehavior;
  /** 拒绝原因 */
  reason: string;
  /** 发生时间戳 */
  timestamp: number;
  /** 关联的会话/请求标识 */
  sessionId?: string;
}

/**
 * 权限拒绝汇总
 */
export interface PermissionDenialSummary {
  totalDenials: number;
  byTool: Record<string, number>;
  byBehavior: Record<string, number>;
  recentDenials: PermissionDenialRecord[];
}

/**
 * 权限包装器
 * 包装权限检查函数，自动收集拒绝记录
 */
export class PermissionWrapper {
  private denials: PermissionDenialRecord[] = [];

  /**
   * 创建包装后的权限检查函数
   * @param originalCheck 原始权限检查函数
   * @param sessionId 当前会话标识
   */
  wrap(
    originalCheck: PermissionCheckFn,
    sessionId?: string
  ): PermissionCheckFn {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      context?: Record<string, unknown>
    ): Promise<PermissionCheckResult> => {
      const result = await originalCheck(toolName, toolInput, context);

      if (result.behavior !== 'allow') {
        const toolUseId =
          ((toolInput as Record<string, unknown>)['tool_use_id'] as string) ||
          `denial_${Date.now()}_${this.denials.length}`;

        const record: PermissionDenialRecord = {
          toolName,
          toolUseId,
          toolInput,
          behavior: result.behavior,
          reason: result.reason || `Permission ${result.behavior}`,
          timestamp: Date.now(),
          sessionId,
        };

        this.denials.push(record);

        logger.debug('Permission denial recorded', {
          toolName,
          behavior: result.behavior,
          totalDenials: this.denials.length,
        });
      }

      return result;
    };
  }

  /**
   * 获取所有拒绝记录
   */
  getAllDenials(): PermissionDenialRecord[] {
    return [...this.denials];
  }

  /**
   * 获取指定工具的拒绝记录
   * @param toolName 工具名称
   */
  getDenialsByTool(toolName: string): PermissionDenialRecord[] {
    return this.denials.filter((d) => d.toolName === toolName);
  }

  /**
   * 获取拒绝记录汇总
   */
  getSummary(): PermissionDenialSummary {
    const byTool: Record<string, number> = {};
    const byBehavior: Record<string, number> = {};

    for (const d of this.denials) {
      byTool[d.toolName] = (byTool[d.toolName] || 0) + 1;
      byBehavior[d.behavior] = (byBehavior[d.behavior] || 0) + 1;
    }

    return {
      totalDenials: this.denials.length,
      byTool,
      byBehavior,
      recentDenials: this.denials.slice(-10),
    };
  }

  /**
   * 获取同步到 SDK 格式的拒绝列表（对标 CC Code SDKPermissionDenial）
   */
  toSDKDenials(): Array<{
    tool_name: string;
    tool_use_id: string;
    tool_input: Record<string, unknown>;
  }> {
    return this.denials.map((d) => ({
      tool_name: d.toolName,
      tool_use_id: d.toolUseId,
      tool_input: d.toolInput,
    }));
  }

  /**
   * 拒绝记录总数
   */
  get count(): number {
    return this.denials.length;
  }

  /**
   * 是否有拒绝记录
   */
  get hasDenials(): boolean {
    return this.denials.length > 0;
  }

  /**
   * 清空所有拒绝记录
   */
  clear(): void {
    this.denials = [];
  }

  /**
   * 生成可集成到 AgentResult 中的结果
   */
  toAgentResult(): {
    permissionDenials: PermissionDenialRecord[];
    denialSummary: PermissionDenialSummary;
  } {
    return {
      permissionDenials: [...this.denials],
      denialSummary: this.getSummary(),
    };
  }
}

export function createPermissionWrapper(): PermissionWrapper {
  return new PermissionWrapper();
}
