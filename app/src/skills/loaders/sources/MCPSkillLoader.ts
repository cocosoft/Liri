import { Skill, SkillSource } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import { createSkillCommand } from '@modules/skills/utils/skillParser';
import { getMCPServerManager } from '@modules/services/mcp/MCPServerManager.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * MCP技能加载器
 * 从MCP服务器加载技能
 */
export class MCPSkillLoader extends SkillLoader {
  private mcpserverManager = getMCPServerManager();

  constructor() {
    super();
  }

  /**
   * 加载MCP技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const servers = this.mcpserverManager.listServers();

      for (const serverName of servers) {
        const server = this.mcpserverManager.getServer(serverName);
        if (!server) {
          continue;
        }

        const tools = server.getTools();
        if (!tools || tools.length === 0) {
          continue;
        }

        for (const tool of tools) {
          const skill = this.createMCPSkill(tool, serverName);
          skills.push(skill);
        }
      }
    } catch (error) {
      logger.error('Error loading MCP skills:', { error });
    }

    return skills;
  }

  /**
   * 创建MCP技能
   * @param tool MCP工具定义
   * @param serverId 服务器名称
   * @returns 技能对象
   */
  private createMCPSkill(tool: any, serverId: string): Skill {
    const skillName = `${serverId}:${tool.name}`;
    const description = tool.description || `MCP tool: ${tool.name}`;
    const params = tool.inputSchema?.properties
      ? Object.keys(tool.inputSchema.properties)
      : [];

    return createSkillCommand({
      skillName,
      frontmatter: {
        name: tool.name,
        description,
        arguments: params,
        'user-invocable': true,
      },
      content: `# ${tool.name}\n\n${description}\n\n## Parameters\n${
        params.length > 0
          ? params
              .map((name: string) => {
                const prop = tool.inputSchema?.properties?.[name];
                return `- ${name}: ${prop?.description || 'No description'}`;
              })
              .join('\n')
          : 'None'
      }\n`,
      source: SkillSource.THIRD_PARTY,
      loadedFrom: `mcp:${serverId}`,
    });
  }

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  getSource(): SkillSource {
    return SkillSource.THIRD_PARTY;
  }
}
