/**
 * API文档生成器
 *
 * 提供API参考文档自动生成功能
 */

import { Tool } from '../tools/types/Tool';
import { Command } from '../commands/types/index';
import { SkillDefinition } from '../tools/SkillTool/types';

export interface APIDoc {
  title: string;
  description: string;
  version: string;
  endpoints: EndpointDoc[];
  types: TypeDoc[];
  examples: ExampleDoc[];
}

export interface EndpointDoc {
  name: string;
  description: string;
  parameters: ParameterDoc[];
  returns: ReturnDoc;
  examples: string[];
  category: string;
}

export interface ParameterDoc {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: unknown;
  enum?: unknown[];
}

export interface ReturnDoc {
  type: string;
  description: string;
  properties?: Record<
    string,
    {
      type: string;
      description: string;
    }
  >;
}

export interface TypeDoc {
  name: string;
  description: string;
  properties: Record<
    string,
    {
      type: string;
      description: string;
      required?: boolean;
    }
  >;
}

export interface ExampleDoc {
  title: string;
  description: string;
  code: string;
  language: string;
}

export class APIDocumentation {
  private static instance: APIDocumentation | null = null;
  private tools: Tool[] = [];
  private commands: Command[] = [];
  private skills: SkillDefinition[] = [];

  private constructor() {}

  static getInstance(): APIDocumentation {
    if (!APIDocumentation.instance) {
      APIDocumentation.instance = new APIDocumentation();
    }
    return APIDocumentation.instance;
  }

  /**
   * 注册工具
   * @param tool 工具
   */
  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  /**
   * 注册命令
   * @param command 命令
   */
  registerCommand(command: Command): void {
    this.commands.push(command);
  }

  /**
   * 注册技能
   * @param skill 技能
   */
  registerSkill(skill: SkillDefinition): void {
    this.skills.push(skill);
  }

  /**
   * 生成API文档
   */
  generate(): APIDoc {
    const endpoints = [
      ...this.generateToolEndpoints(),
      ...this.generateCommandEndpoints(),
      ...this.generateSkillEndpoints(),
    ];

    return {
      title: 'Liri API Documentation',
      description: 'API reference for Liri tools, commands, and skills',
      version: '1.0.0',
      endpoints,
      types: this.generateTypes(),
      examples: this.generateExamples(),
    };
  }

  /**
   * 生成工具端点
   */
  private generateToolEndpoints(): EndpointDoc[] {
    return this.tools.map((tool) => {
      const info = tool.getInfo();
      const parameters =
        info.params?.map((param) => ({
          name: param.name,
          type: param.type,
          required: param.required,
          description: param.description || '',
          default: param.default,
          enum: param.enum,
        })) || [];

      return {
        name: tool.name,
        description: tool.description || '',
        parameters,
        returns: {
          type: 'ToolResult',
          description: 'Tool execution result',
        },
        examples: this.generateToolExamples(tool),
        category: 'tool',
      };
    });
  }

  /**
   * 生成命令端点
   */
  private generateCommandEndpoints(): EndpointDoc[] {
    return this.commands.map((command) => ({
      name: `/${command.name}`,
      description: command.description || '',
      parameters: [],
      returns: {
        type: 'CommandResult',
        description: 'Command execution result',
      },
      examples: this.generateCommandExamples(command),
      category: 'command',
    }));
  }

  /**
   * 生成技能端点
   */
  private generateSkillEndpoints(): EndpointDoc[] {
    return this.skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description || '',
      parameters: [],
      returns: {
        type: 'SkillResult',
        description: 'Skill execution result',
      },
      examples: this.generateSkillExamples(skill),
      category: 'skill',
    }));
  }

  /**
   * 生成类型文档
   */
  private generateTypes(): TypeDoc[] {
    return [
      {
        name: 'ToolResult',
        description: 'Result of tool execution',
        properties: {
          success: {
            type: 'boolean',
            description: 'Whether the tool execution was successful',
            required: true,
          },
          data: {
            type: 'any',
            description: 'Tool execution result data',
          },
          error: {
            type: 'string',
            description: 'Error message if execution failed',
          },
          output: {
            type: 'string',
            description: 'Human-readable output',
          },
        },
      },
      {
        name: 'CommandResult',
        description: 'Result of command execution',
        properties: {
          success: {
            type: 'boolean',
            description: 'Whether the command execution was successful',
            required: true,
          },
          output: {
            type: 'string',
            description: 'Command output',
          },
          error: {
            type: 'string',
            description: 'Error message if execution failed',
          },
        },
      },
      {
        name: 'SkillResult',
        description: 'Result of skill execution',
        properties: {
          success: {
            type: 'boolean',
            description: 'Whether the skill execution was successful',
            required: true,
          },
          result: {
            type: 'any',
            description: 'Skill execution result',
          },
          error: {
            type: 'string',
            description: 'Error message if execution failed',
          },
        },
      },
    ];
  }

  /**
   * 生成示例
   */
  private generateExamples(): ExampleDoc[] {
    return [
      {
        title: 'FileReadTool Example',
        description: 'Read a file content',
        code: `{
  "toolcall": {
    "thought": "Read the package.json file",
    "name": "FileReadTool",
    "params": {
      "file_path": "package.json"
    }
  }
}`,
        language: 'json',
      },
      {
        title: 'LSPTool Example',
        description: 'Get code completions',
        code: `{
  "toolcall": {
    "thought": "Get code completions for TypeScript",
    "name": "lsp",
    "params": {
      "action": "completions",
      "document": "function hello() {",
      "language": "typescript",
      "position": { "line": 0, "character": 13 }
    }
  }
}`,
        language: 'json',
      },
      {
        title: 'SkillTool Example',
        description: 'Run the summarize skill',
        code: `{
  "toolcall": {
    "thought": "Summarize the current context",
    "name": "Skill",
    "params": {
      "name": "summarize",
      "arguments": {
        "text": "Long text to summarize..."
      }
    }
  }
}`,
        language: 'json',
      },
    ];
  }

  /**
   * 生成工具示例
   * @param tool 工具
   */
  private generateToolExamples(tool: Tool): string[] {
    return [`// Example usage of ${tool.name}`];
  }

  /**
   * 生成命令示例
   * @param command 命令
   */
  private generateCommandExamples(command: Command): string[] {
    return [`// Example: /${command.name}`];
  }

  /**
   * 生成技能示例
   * @param skill 技能
   */
  private generateSkillExamples(skill: SkillDefinition): string[] {
    return [`// Example: skill ${skill.name}`];
  }

  /**
   * 导出为Markdown
   */
  exportToMarkdown(): string {
    const doc = this.generate();
    let markdown = `# ${doc.title}\n\n`;
    markdown += `${doc.description}\n\n`;
    markdown += `Version: ${doc.version}\n\n`;

    // Types
    markdown += `## Types\n\n`;
    for (const type of doc.types) {
      markdown += `### ${type.name}\n\n`;
      markdown += `${type.description}\n\n`;
      markdown += `| Property | Type | Description |\n`;
      markdown += `|----------|------|-------------|\n`;
      for (const [name, prop] of Object.entries(type.properties)) {
        markdown += `| ${name} | ${prop.type} | ${prop.description} |\n`;
      }
      markdown += `\n`;
    }

    // Endpoints
    const categories = new Map<string, EndpointDoc[]>();
    for (const endpoint of doc.endpoints) {
      if (!categories.has(endpoint.category)) {
        categories.set(endpoint.category, []);
      }
      categories.get(endpoint.category)!.push(endpoint);
    }

    for (const [category, endpoints] of categories) {
      markdown += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      for (const endpoint of endpoints) {
        markdown += `### ${endpoint.name}\n\n`;
        markdown += `${endpoint.description}\n\n`;

        if (endpoint.parameters.length > 0) {
          markdown += `#### Parameters\n\n`;
          markdown += `| Name | Type | Required | Description |\n`;
          markdown += `|------|------|----------|-------------|\n`;
          for (const param of endpoint.parameters) {
            markdown += `| ${param.name} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description} |\n`;
          }
          markdown += `\n`;
        }

        markdown += `#### Returns\n\n`;
        markdown += `| Type | Description |\n`;
        markdown += `|------|-------------|\n`;
        markdown += `| ${endpoint.returns.type} | ${endpoint.returns.description} |\n`;
        markdown += `\n`;

        if (endpoint.examples.length > 0) {
          markdown += `#### Examples\n\n`;
          for (const example of endpoint.examples) {
            markdown += `\`\`\`\n${example}\n\`\`\`\n\n`;
          }
        }
      }
    }

    // Examples
    if (doc.examples.length > 0) {
      markdown += `## Examples\n\n`;
      for (const example of doc.examples) {
        markdown += `### ${example.title}\n\n`;
        markdown += `${example.description}\n\n`;
        markdown += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`;
      }
    }

    return markdown;
  }

  /**
   * 导出为JSON
   */
  exportToJSON(): string {
    const doc = this.generate();
    return JSON.stringify(doc, null, 2);
  }
}

export const apiDocumentation = APIDocumentation.getInstance();

export default apiDocumentation;
