//
/**
 * 支持完整的Frontmatter解析、参数替换、Shell执行等功能
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SkillSource, SkillLoadMethod } from '../types';
import type { Skill } from '../types';
// Re-export for downstream consumers
export { SkillSource, SkillLoadMethod };
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'skills:utils:skillParser',
  level: LogLevel.INFO,
});

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
  hooks?: Record<string, unknown>;
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
 * 技能定义接口
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

export class SkillParser {
  private static readonly FRONTMATTER_REGEX =
    /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  private static readonly YAML_REGEX = /^([^:]+):\s*(.*)$/;

  /**
   * 解析技能文件
   */
  async parseSkillFile(
    filePath: string,
    source: SkillSource
  ): Promise<SkillDefinition> {
    try {
      if (!existsSync(filePath)) {
        throw new AppError(
          `Skill file not found: ${filePath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);

      const { frontmatter, skillContent } = this.extractFrontmatter(content);

      // 验证必需字段
      if (!frontmatter.name) {
        throw new AppError(
          `Skill name is required in ${filePath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      if (!frontmatter.description) {
        throw new AppError(
          `Skill description is required in ${filePath}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
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
      throw new AppError(
        `Failed to parse skill file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 提取Frontmatter
   */
  private extractFrontmatter(content: string): {
    frontmatter: SkillFrontmatter;
    skillContent: string;
  } {
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
   * 解析YAML Frontmatter
   */
  private parseYamlFrontmatter(yamlText: string): SkillFrontmatter {
    const frontmatter: SkillFrontmatter = {};
    const lines = yamlText.split('\n').filter((line) => line.trim());

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
   * 解析数组值
   */
  private parseArrayValue(value: string): string[] {
    if (value.startsWith('[') && value.endsWith(']')) {
      // JSON数组格式
      try {
        return JSON.parse(value);
      } catch (err) {
        // 如果JSON解析失败，回退到简单分割

        logger.warn('Operation skipped', {
          context: '如果JSON解析失败，回退到简单分割',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 简单分割格式
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  /**
   * 解析布尔值
   */
  private parseBooleanValue(value: string): boolean {
    const lowerValue = value.toLowerCase();
    return lowerValue === 'true' || lowerValue === 'yes' || lowerValue === '1';
  }

  /**
   * 解析数值
   */
  private parseNumberValue(value: string): number {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 验证技能定义
   */
  validateSkillDefinition(skill: SkillDefinition): {
    valid: boolean;
    errors: string[];
  } {
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
   * 参数替换
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

    // 替换 ${SKILL_DIR}
    if (baseDir) {
      const skillDir =
        process.platform === 'win32' ? baseDir.replace(/\\/g, '/') : baseDir;
      result = result.replace(/\$\{SKILL_DIR\}/g, skillDir);
    }

    // 替换 ${SESSION_ID}
    result = result.replace(/\$\{SESSION_ID\}/g, this.getSessionId());

    // 替换命名参数 {{argName}}
    if (argumentNames && args) {
      const argValues = args.split(' ').filter((arg) => arg.trim().length > 0);

      for (let i = 0; i < argumentNames.length && i < argValues.length; i++) {
        const argName = argumentNames[i];
        const argValue = argValues[i];
        result = result.replace(
          new RegExp(`\\{\\{${argName}\\}\\}`, 'g'),
          argValue
        );
      }
    }

    return result;
  }

  /**
   * 提取Shell命令
   */
  extractShellCommands(content: string): string[] {
    const commands: string[] = [];

    // 匹配 !command 格式
    const inlineCommands = content.match(/!\s*([^\n]+)/g) || [];
    commands.push(...inlineCommands.map((cmd) => cmd.replace(/^!\s*/, '')));

    // 匹配 ```! 代码块格式
    const codeBlockRegex = /```!\s*\n([\s\S]*?)\n```/g;
    const codeBlockMatches = content.matchAll(codeBlockRegex);

    for (const match of codeBlockMatches) {
      const commandsInBlock = match[1]
        .split('\n')
        .filter((cmd) => cmd.trim().length > 0);
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
   * 生成技能摘要
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
      skill.frontmatter['allowed-tools'].forEach((tool) => {
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
export function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  content: string;
} {
  const parser = new SkillParser();
  const { frontmatter, skillContent } = (
    parser as unknown as {
      extractFrontmatter: (content: string) => {
        frontmatter: Record<string, unknown>;
        skillContent: string;
      };
    }
  ).extractFrontmatter(content);
  return { frontmatter, content: skillContent };
}

export function createSkillCommand(options: CreateSkillCommandOptions): Skill {
  const { skillName, frontmatter: fm, content, source, loadedFrom } = options;
  const fm_ = fm as Record<string, unknown>;
  const skill: Skill = {
    name: skillName,
    description: (fm_.description as string) || '',
    source,
    loadMethod: SkillLoadMethod.FILE_SYSTEM,
    loadedFrom,
    aliases: (fm_.arguments as string[]) || [],
    argumentHint: fm_['argument-hint'] as string | undefined,
    whenToUse: fm_.when_to_use as string | undefined,
    version: fm_.version as string | undefined,
    model: fm_.model as string | undefined,
    disableModelInvocation: !!(fm_['disable-model-invocation'] as
      | boolean
      | undefined),
    userInvocable: !!(fm_['user-invocable'] as boolean | undefined),
    context: fm_.context as 'fork' | undefined,
    agent: fm_.agent as string | undefined,
    effort: fm_.effort as string | undefined,
    paths: fm_.paths as string[] | undefined,
    contentLength: content.length,
    isHidden: false,
    progressMessage: `Running ${skillName}...`,
    impl: {
      kind: 'prompt',
      getPromptForCommand: async () => [{ type: 'text', text: content }],
    },
  };
  return skill;
}
