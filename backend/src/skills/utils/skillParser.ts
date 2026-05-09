//
/**
 * 技能解析器（基于CC源码增强）
 * 支持完整的Frontmatter解析、参数替换、Shell执行等功能
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Skill } from '../types';

/**
 * 技能Frontmatter接口（基于CC源码完整实现）
 */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'allowed-tools'?: string[];
  arguments?: string | string[];
  'argument-hint'?: string;
  'when-to-use'?: string;
  version?: string;
  model?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  hooks?: Record<string, any>;
  context?: 'inline' | 'fork';
  agent?: string;
  effort?: string | number;
  shell?: boolean | string;
  paths?: string | string[];
  'skill-dir'?: string;
  'skill-id'?: string;
  'skill-type'?: string;
  'skill-source'?: string;
  'skill-priority'?: number;
}

/**
 * 技能定义接口（基于CC源码）
 */
export interface SkillDefinition {
  /**
   * 技能名称
   */
  name: string;
  
  /**
   * 技能描述
   */
  description: string;
  
  /**
   * 技能内容
   */
  content: string;
  
  /**
   * 技能文件路径
   */
  filePath: string;
  
  /**
   * Frontmatter配置
   */
  frontmatter: SkillFrontmatter;
  
  /**
   * 技能来源
   */
  source: SkillSource;
  
  /**
   * 是否启用
   */
  enabled: boolean;
  
  /**
   * 最后修改时间
   */
  lastModified: Date;
  
  /**
   * 文件大小
   */
  fileSize: number;
}

/**
 * 技能来源枚举（基于CC源码）
 */
export enum SkillSource {
  BUILTIN = 'builtin',
  BUNDLED = 'bundled',
  USER = 'user',
  PROJECT = 'project',
  PLUGIN = 'plugin',
  MCP = 'mcp',
}

/**
 * 技能解析器类（基于CC源码实现）
 */
export class SkillParser {
  private static readonly FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  private static readonly YAML_REGEX = /^([^:]+):\s*(.*)$/;

  /**
   * 解析技能文件（基于CC源码）
   */
  async parseSkillFile(filePath: string, source: SkillSource): Promise<SkillDefinition> {
    try {
      if (!existsSync(filePath)) {
        throw new Error(`Skill file not found: ${filePath}`);
      }

      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);

      const { frontmatter, skillContent } = this.extractFrontmatter(content);

      // 验证必需字段
      if (!frontmatter.name) {
        throw new Error(`Skill name is required in ${filePath}`);
      }

      if (!frontmatter.description) {
        throw new Error(`Skill description is required in ${filePath}`);
      }

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        content: skillContent,
        filePath,
        frontmatter,
        source,
        enabled: true,
        lastModified: stats.mtime,
        fileSize: stats.size,
      };
    } catch (error) {
      throw new Error(`Failed to parse skill file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 提取Frontmatter（基于CC源码）
   */
  private extractFrontmatter(content: string): { frontmatter: SkillFrontmatter; skillContent: string } {
    const match = content.match(SkillParser.FRONTMATTER_REGEX);
    
    if (!match) {
      // 没有Frontmatter，返回默认配置
      return {
        frontmatter: {},
        skillContent: content,
      };
    }

    const frontmatterText = match[1];
    const skillContent = match[2];

    const frontmatter = this.parseYamlFrontmatter(frontmatterText);

    return { frontmatter, skillContent };
  }

  /**
   * 解析YAML Frontmatter（基于CC源码）
   */
  private parseYamlFrontmatter(yamlText: string): SkillFrontmatter {
    const frontmatter: SkillFrontmatter = {};
    const lines = yamlText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const match = line.match(SkillParser.YAML_REGEX);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();

        // 处理不同类型的值
        switch (key) {
          case 'allowed-tools':
          case 'arguments':
          case 'paths':
            frontmatter[key] = this.parseArrayValue(value);
            break;
          
          case 'disable-model-invocation':
          case 'user-invocable':
          case 'shell':
            frontmatter[key] = this.parseBooleanValue(value);
            break;
          
          case 'effort':
            frontmatter[key] = this.parseNumberValue(value);
            break;
          
          default:
            (frontmatter as any)[key] = value;
        }
      }
    }

    return frontmatter;
  }

  /**
   * 解析数组值（基于CC源码）
   */
  private parseArrayValue(value: string): string[] {
    if (value.startsWith('[') && value.endsWith(']')) {
      // JSON数组格式
      try {
        return JSON.parse(value);
      } catch {
        // 如果JSON解析失败，回退到简单分割
      }
    }

    // 简单分割格式
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  /**
   * 解析布尔值（基于CC源码）
   */
  private parseBooleanValue(value: string): boolean {
    const lowerValue = value.toLowerCase();
    return lowerValue === 'true' || lowerValue === 'yes' || lowerValue === '1';
  }

  /**
   * 解析数值（基于CC源码）
   */
  private parseNumberValue(value: string): number {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 验证技能定义（基于CC源码）
   */
  validateSkillDefinition(skill: SkillDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证必需字段
    if (!skill.name || skill.name.trim().length === 0) {
      errors.push('Skill name is required');
    }

    if (!skill.description || skill.description.trim().length === 0) {
      errors.push('Skill description is required');
    }

    if (!skill.content || skill.content.trim().length === 0) {
      errors.push('Skill content is required');
    }

    // 验证Frontmatter字段
    if (skill.frontmatter.arguments) {
      const args = Array.isArray(skill.frontmatter.arguments) 
        ? skill.frontmatter.arguments 
        : [skill.frontmatter.arguments];
      
      for (const arg of args) {
        if (typeof arg !== 'string' || arg.trim().length === 0) {
          errors.push(`Invalid argument: ${arg}`);
        }
      }
    }

    // 验证路径过滤
    if (skill.frontmatter.paths) {
      const paths = Array.isArray(skill.frontmatter.paths)
        ? skill.frontmatter.paths
        : [skill.frontmatter.paths];
      
      for (const path of paths) {
        if (typeof path !== 'string' || path.trim().length === 0) {
          errors.push(`Invalid path: ${path}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 参数替换（基于CC源码）
   */
  substituteArguments(
    content: string,
    args: string,
    argumentNames?: string[],
    baseDir?: string
  ): string {
    let result = content;

    // 替换 $ARGUMENTS
    result = result.replace(/\$ARGUMENTS/g, args);

    // 替换 ${CLAUDE_SKILL_DIR}
    if (baseDir) {
      const skillDir = process.platform === 'win32' 
        ? baseDir.replace(/\\/g, '/') 
        : baseDir;
      result = result.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
    }

    // 替换 ${CLAUDE_SESSION_ID}
    result = result.replace(/\$\{CLAUDE_SESSION_ID\}/g, this.getSessionId());

    // 替换命名参数 {{argName}}
    if (argumentNames && args) {
      const argValues = args.split(' ').filter(arg => arg.trim().length > 0);
      
      for (let i = 0; i < argumentNames.length && i < argValues.length; i++) {
        const argName = argumentNames[i];
        const argValue = argValues[i];
        result = result.replace(new RegExp(`\\{\\{${argName}\\}\\}`, 'g'), argValue);
      }
    }

    return result;
  }

  /**
   * 提取Shell命令（基于CC源码）
   */
  extractShellCommands(content: string): string[] {
    const commands: string[] = [];

    // 匹配 !command 格式
    const inlineCommands = content.match(/!\s*([^\n]+)/g) || [];
    commands.push(...inlineCommands.map(cmd => cmd.replace(/^!\s*/, '')));

    // 匹配 ```! 代码块格式
    const codeBlockRegex = /```!\s*\n([\s\S]*?)\n```/g;
    const codeBlockMatches = content.matchAll(codeBlockRegex);
    
    for (const match of codeBlockMatches) {
      const commandsInBlock = match[1].split('\n').filter(cmd => cmd.trim().length > 0);
      commands.push(...commandsInBlock);
    }

    return commands;
  }

  /**
   * 获取会话ID（简化实现）
   */
  private getSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成技能摘要（基于CC源码）
   */
  generateSkillSummary(skill: SkillDefinition): string {
    const summary: string[] = [];

    summary.push(`# ${skill.name}`);
    summary.push('');
    summary.push(skill.description);
    summary.push('');

    if (skill.frontmatter['when-to-use']) {
      summary.push('## 使用时机');
      summary.push(skill.frontmatter['when-to-use']);
      summary.push('');
    }

    if (skill.frontmatter.arguments) {
      summary.push('## 参数');
      const args = Array.isArray(skill.frontmatter.arguments)
        ? skill.frontmatter.arguments
        : [skill.frontmatter.arguments];
      
      args.forEach((arg, index) => {
        summary.push(`${index + 1}. ${arg}`);
      });
      summary.push('');
    }

    if (skill.frontmatter['allowed-tools']) {
      summary.push('## 允许的工具');
      skill.frontmatter['allowed-tools'].forEach(tool => {
        summary.push(`- ${tool}`);
      });
      summary.push('');
    }

    return summary.join('\n');
  }
}

export interface CreateSkillCommandOptions {
  skillName: string;
  frontmatter: SkillFrontmatter;
  content: string;
  source: SkillSource;
  loadedFrom: string;
}

/**
 * 解析技能Frontmatter（为兼容旧API而导出）
 */
export function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter; content: string } {
  const parser = new SkillParser();
  const { frontmatter, skillContent } = (parser as any).extractFrontmatter(content);
  return { frontmatter, content: skillContent };
}

export function createSkillCommand(options: CreateSkillCommandOptions): Skill {
  const { skillName, frontmatter: fm, content, source, loadedFrom } = options;
  const skill: Skill = {
    type: 'prompt',
    name: skillName,
    description: (fm as any).description || '',
    hasUserSpecifiedDescription: !!fm.description,
    allowedTools: (fm as any)['allowed-tools'] || [],
    argNames: (fm as any).arguments || [],
    argumentHint: (fm as any)['argument-hint'],
    whenToUse: (fm as any).when_to_use,
    version: (fm as any).version,
    model: (fm as any).model,
    disableModelInvocation: !!(fm as any)['disable-model-invocation'],
    userInvocable: !!(fm as any)['user-invocable'],
    context: (fm as any).context,
    agent: (fm as any).agent,
    effort: (fm as any).effort,
    paths: (fm as any).paths,
    contentLength: content.length,
    isHidden: false,
    progressMessage: `Running ${skillName}...`,
    userFacingName: () => skillName,
    source,
    loadedFrom,
    getPromptForCommand: async () => [{ type: 'text', text: content }],
  };
  return skill;
}