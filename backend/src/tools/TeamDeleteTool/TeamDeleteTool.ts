// @ts-nocheck
/**
 * 团队删除工具
 * 用于解散swarm团队并清理
 * 参考CC源码 cc_code/backend/tools/TeamDeleteTool/TeamDeleteTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { getTeammateManager } from '../../subagent/TeammateManager';
import { join } from 'path';
import { unlinkSync, existsSync, readFileSync } from 'fs';

/**
 * 团队删除输入
 */
export interface TeamDeleteInput {
  /**
   * 要删除的团队名称
   */
  team_name: string;

  /**
   * 是否强制删除（即使团队中有活跃的teammates）
   */
  force?: boolean;
}

/**
 * 团队删除输出
 */
export interface TeamDeleteOutput {
  success: boolean;
  message: string;
  team_name: string;
  terminated_teammates?: string[];
}

/**
 * 团队删除工具
 */
export class TeamDeleteTool extends BaseTool<TeamDeleteInput, TeamDeleteOutput> {
  /**
   * 工具名称
   */
  name = 'TeamDelete';

  /**
   * 工具描述
   */
  description = '解散一个swarm团队并清理相关资源。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'team_name',
      type: 'string',
      description: '要删除的团队名称',
      required: true,
    },
    {
      name: 'force',
      type: 'boolean',
      description: '是否强制删除（即使团队中有活跃的teammates）',
      required: false,
      default: false,
    },
  ];

  /**
   * 搜索提示
   */
  searchHint = 'delete a swarm team';

  /**
   * 最大结果大小
   */
  maxResultSizeChars = 100_000;

  /**
   * 延迟加载
   */
  shouldDefer = true;

  /**
   * 团队文件目录
   */
  private teamDir: string;

  /**
   * 构造函数
   */
  constructor() {
    super();
    this.teamDir = join(process.cwd(), '.teams');
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return process.env.ENABLE_TEAMMATE !== 'false'; // 默认启用
  }

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive(): boolean {
    return true;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 生成团队文件路径
   */
  private getTeamFilePath(teamName: string): string {
    return join(this.teamDir, `${teamName}.json`);
  }

  /**
   * 执行团队删除
   */
  async execute(
    input: TeamDeleteInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<TeamDeleteOutput>> {
    const { team_name, force = false } = input;

    // 验证输入
    if (!team_name || team_name.trim().length === 0) {
      return createToolResult(
        {
          success: false,
          message: 'team_name is required',
          team_name: '',
        },
        {
          newMessages: [
            {
              role: 'system',
              content: '错误: team_name 是必需的',
            },
          ],
        }
      );
    }

    const teamFilePath = this.getTeamFilePath(team_name);

    // 检查团队是否存在
    if (!existsSync(teamFilePath)) {
      return createToolResult(
        {
          success: false,
          message: `Team "${team_name}" does not exist`,
          team_name,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `团队 "${team_name}" 不存在`,
            },
          ],
        }
      );
    }

    try {
      // 读取团队文件
      const teamFile = JSON.parse(readFileSync(teamFilePath, 'utf8'));
      const terminatedTeammates: string[] = [];

      // 终止所有teammates
      const manager = getTeammateManager();
      const activeTeammates = manager.getActiveTeammates();

      for (const teammate of activeTeammates) {
        try {
          await manager.killTeammate(teammate.id);
          terminatedTeammates.push(teammate.name);
        } catch (error) {
          console.error(`Failed to terminate teammate ${teammate.name}:`, error);
        }
      }

      // 删除团队文件
      unlinkSync(teamFilePath);

      return createToolResult(
        {
          success: true,
          message: `Team "${team_name}" has been deleted`,
          team_name,
          terminated_teammates: terminatedTeammates,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `团队 "${team_name}" 已删除。终止了 ${terminatedTeammates.length} 个 teammate(s)`,
            },
          ],
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createToolResult(
        {
          success: false,
          message: `Failed to delete team: ${errorMessage}`,
          team_name,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `删除团队失败: ${errorMessage}`,
            },
          ],
        }
      );
    }
  }

  /**
   * 获取用户可见的名称
   */
  userFacingName(): string {
    return '删除团队';
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<TeamDeleteInput>): string | null {
    if (input?.team_name) {
      return `删除团队 ${input.team_name}`;
    }
    return '删除团队';
  }
}

/**
 * 创建团队删除工具实例
 */
export function createTeamDeleteTool(): TeamDeleteTool {
  return new TeamDeleteTool();
}
