import type { MCPProvider } from './MCPProvider.js';
import type { SkillProvider } from './SkillProvider.js';
import type { LocalCommandExecutor } from './CommandExecutor.js';
import type { CommandMatch, CommandAction } from './types.js';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  toolName?: string;
}

export class ToolDispatcher {
  constructor(
    private mcpProvider?: MCPProvider,
    private skillProvider?: SkillProvider,
    private commandExecutor?: LocalCommandExecutor
  ) {}

  async dispatch(input: string): Promise<ToolResult | null> {
    const lowerInput = input.toLowerCase().trim();

    const mcpResult = await this.tryMCP(lowerInput);
    if (mcpResult) return mcpResult;

    const skillResult = await this.trySkill(lowerInput);
    if (skillResult) return skillResult;

    const cmdResult = await this.tryCommand(lowerInput);
    if (cmdResult) return cmdResult;

    return null;
  }

  async dispatchByToolName(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult | null> {
    if (this.mcpProvider?.isEnabled()) {
      const tools = await this.mcpProvider.listTools();
      if (tools.some((t) => t.toLowerCase() === toolName.toLowerCase())) {
        const result = await this.mcpProvider.callTool(toolName, args);
        return {
          success: result.success,
          output: result.output,
          error: result.error,
          toolName,
        };
      }
    }

    if (this.skillProvider?.isEnabled()) {
      const available = this.skillProvider.getAvailableSkills();
      if (available.some((s) => s.toLowerCase() === toolName.toLowerCase())) {
        const result = await this.skillProvider.executeSkill(toolName, {
          input: '',
          messages: [],
        });
        return {
          success: result.success,
          output: result.output,
          error: result.error,
          toolName,
        };
      }
    }

    if (this.commandExecutor) {
      const cmdMatch: CommandMatch = {
        action: toolName as CommandAction,
        args: args as Record<string, string>,
      };
      const output = await this.commandExecutor.execute(cmdMatch);
      return { success: true, output, toolName };
    }

    return null;
  }

  private async tryMCP(input: string): Promise<ToolResult | null> {
    if (!this.mcpProvider?.isEnabled()) return null;

    const tools = await this.mcpProvider.listTools();
    for (const toolName of tools) {
      if (input.includes(toolName.toLowerCase())) {
        const result = await this.mcpProvider.callTool(toolName, { input });
        if (result.success) {
          return { success: true, output: result.output, toolName };
        }
      }
    }

    return null;
  }

  private async trySkill(input: string): Promise<ToolResult | null> {
    if (!this.skillProvider?.isEnabled()) return null;

    const skillMatch = await this.skillProvider.matchSkill(input);
    if (!skillMatch) return null;

    return {
      success: true,
      output: `Matched skill: ${skillMatch.skillName}`,
      toolName: skillMatch.skillName,
    };
  }

  private async tryCommand(input: string): Promise<ToolResult | null> {
    if (!this.commandExecutor) return null;

    const cmd = this.parseCommand(input);
    if (!cmd) return null;

    const output = await this.commandExecutor.execute(cmd);
    return { success: true, output, toolName: cmd.action };
  }

  private parseCommand(input: string): CommandMatch | null {
    const actionKeywords: Record<string, RegExp> = {
      create: /^(创建|新建|make|create|mkdir)\b/i,
      delete: /^(删除|移除|delete|remove|rm)\b/i,
      read: /^(读取|查看|显示|read|show|cat|type)\b/i,
      write: /^(写入|保存|write|save|echo)\b/i,
      execute: /^(执行|运行|run|execute)\b/i,
    };

    for (const [action, pattern] of Object.entries(actionKeywords)) {
      if (pattern.test(input)) {
        const path = input.replace(pattern, '').trim().replace(/['"]/g, '');
        return {
          action: action as CommandAction,
          args: { path, original: input },
        };
      }
    }

    return null;
  }
}
