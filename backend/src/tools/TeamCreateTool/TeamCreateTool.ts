/**
 * 团队创建工具
 * 用于创建多Agent swarm团队
 * 参考CC源码 cc_code/backend/tools/TeamCreateTool/TeamCreateTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { getTeammateManager } from '@modules/subagent/TeammateManager';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

/**
 * 团队成员
 */
export interface TeamMember {
  name: string;
  agentType: string;
  model?: string;
  joinedAt: number;
}

/**
 * 团队文件
 */
export interface TeamFile {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId: string;
  members: TeamMember[];
}

/**
 * 团队创建输入
 */
export interface TeamCreateInput {
  /**
   * 团队名称
   */
  team_name: string;

  /**
   * 团队描述/用途
   */
  description?: string;

  /**
   * 团队负责人类型/角色
   */
  agent_type?: string;
}

/**
 * 团队创建输出
 */
export interface TeamCreateOutput {
  team_name: string;
  team_file_path: string;
  lead_agent_id: string;
}

/**
 * 团队创建工具
 */
export class TeamCreateTool extends BaseTool<TeamCreateInput, TeamCreateOutput> {
  /**
   * 工具名称
   */
  name = 'TeamCreate';

  /**
   * 工具描述
   */
  description = '创建一个新的多Agent swarm团队，用于协调多个Agent协作完成任务。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'team_name',
      type: 'string',
      description: '团队名称',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: '团队描述/用途',
      required: false,
    },
    {
      name: 'agent_type',
      type: 'string',
      description: '团队负责人类型/角色（例如：researcher, test-runner）',
      required: false,
    },
  ];

  override searchHint = 'create a multi-agent swarm team';

  override maxResultSizeChars = 100_000;

  override shouldDefer = true;

  private teamDir: string;

  constructor() {
    super();
    this.teamDir = join(process.cwd(), '.teams');
    this.ensureTeamDir();
  }

  private ensureTeamDir(): void {
    if (!existsSync(this.teamDir)) {
      mkdirSync(this.teamDir, { recursive: true });
    }
  }

  override isEnabled(): boolean {
    return process.env.ENABLE_TEAMMATE !== 'false'; // 默认启用
  }

  override isDestructive(): boolean {
    return false;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 生成团队文件路径
   */
  private getTeamFilePath(teamName: string): string {
    return join(this.teamDir, `${teamName}.json`);
  }

  /**
   * 生成唯一的团队名称
   */
  private generateUniqueTeamName(providedName: string): string {
    const filePath = this.getTeamFilePath(providedName);
    if (!existsSync(filePath)) {
      return providedName;
    }

    // 如果名称已存在，添加时间戳
    return `${providedName}_${Date.now()}`;
  }

  /**
   * 格式化Agent ID
   */
  private formatAgentId(name: string, teamName: string): string {
    return `${name}@${teamName}`;
  }

  /**
   * 执行团队创建
   */
  async execute(
    input: TeamCreateInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<TeamCreateOutput>> {
    const { team_name, description, agent_type } = input;

    // 验证输入
    if (!team_name || team_name.trim().length === 0) {
      return createToolResult(
        {
          team_name: '',
          team_file_path: '',
          lead_agent_id: '',
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

    // 生成唯一的团队名称
    const finalTeamName = this.generateUniqueTeamName(team_name);

    // 生成团队负责人ID
    const leadAgentId = this.formatAgentId('team-lead', finalTeamName);
    const leadAgentType = agent_type || 'team-lead';

    // 创建团队文件路径
    const teamFilePath = this.getTeamFilePath(finalTeamName);

    // 创建团队文件
    const teamFile: TeamFile = {
      name: finalTeamName,
      description,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId: `session_${Date.now()}`,
      members: [
        {
          name: 'team-lead',
          agentType: leadAgentType,
          joinedAt: Date.now(),
        },
      ],
    };

    try {
      // 写入团队文件
      writeFileSync(teamFilePath, JSON.stringify(teamFile, null, 2));

      // 初始化 teammate manager
      const manager = getTeammateManager();

      return createToolResult(
        {
          team_name: finalTeamName,
          team_file_path: teamFilePath,
          lead_agent_id: leadAgentId,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `团队 "${finalTeamName}" 创建成功。负责人ID: ${leadAgentId}`,
            },
          ],
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createToolResult(
        {
          team_name: '',
          team_file_path: '',
          lead_agent_id: '',
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `创建团队失败: ${errorMessage}`,
            },
          ],
        }
      );
    }
  }

  override toAutoClassifierInput(input: TeamCreateInput): string {
    return input.team_name;
  }

  override userFacingName(): string {
    return '创建团队';
  }

  override getActivityDescription(input?: Partial<TeamCreateInput>): string | null {
    if (input?.team_name) {
      return `创建团队 ${input.team_name}`;
    }
    return '创建团队';
  }
}

/**
 * 创建团队创建工具实例
 */
export function createTeamCreateTool(): TeamCreateTool {
  return new TeamCreateTool();
}
