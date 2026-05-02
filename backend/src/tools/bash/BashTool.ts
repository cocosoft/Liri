/**
 * Bash 工具
 *
 * 提供安全的 Shell 命令执行功能
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { createBashProgress } from '../types/ToolProgress';
import { BashSecurityAnalyzer } from '../../security';
import { parseForSecurity, isDangerousCommand, type ParseForSecurityResult } from '../../security/bash/BashAST';
import { exec } from 'child_process';
import { promisify } from 'util';
import { analyzeBashCommandType, isSilentBashCommand } from './BashSemantics';

const execAsync = promisify(exec);

export class BashTool extends BaseTool {
  name = 'bash';
  description = 'Execute bash commands with security checks';

  params: ToolParam[] = [
    {
      name: 'command',
      type: 'string',
      description: 'The command to execute',
      required: true,
      default: '',
      example: 'ls -la',
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds',
      required: false,
      default: 60000,
    },
    {
      name: 'skipSecurityCheck',
      type: 'boolean',
      description: 'Skip security validation (dangerous)',
      required: false,
      default: false,
    },
  ];

  aliases = ['sh', 'shell'];
  searchHint = 'Execute shell commands with security checks';
  maxResultSizeChars = 100000;

  private securityAnalyzer: BashSecurityAnalyzer;

  constructor() {
    super();
    this.securityAnalyzer = new BashSecurityAnalyzer();
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    try {
      const command = input.command as string;
      const timeout = (input.timeout as number) || 60000;
      const skipSecurityCheck = (input.skipSecurityCheck as boolean) || false;

      if (!command) {
        return createToolResult('command is required', {
          newMessages: [
            {
              role: 'system',
              content: 'Error: command is required',
            },
          ],
        });
      }

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', '', undefined, true, false),
      });

      if (!skipSecurityCheck) {
        const securityResult = this.securityAnalyzer.analyze(command);

        // 辅助：AST级安全分析（基于CC源码 FAIL-CLOSED模式）
        const astResult = parseForSecurity(command);
        if (astResult.kind === 'simple' && astResult.commands.some(c => isDangerousCommand(c.argv))) {
          return createToolResult(
            `AST安全分析: 检测到危险命令`,
            {
              newMessages: [{
                role: 'system',
                content: `Error: AST安全分析阻止了危险命令执行`,
              }],
            }
          );
        }

        if (securityResult.behavior === 'deny') {
          return createToolResult(
            `安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
                },
              ],
            }
          );
        }

        if (securityResult.behavior === 'ask') {
          return createToolResult(
            `需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: 需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
                },
              ],
            }
          );
        }
      }

      // 执行命令
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.options?.cwd || process.cwd(),
        timeout,
      });

      const output = stdout + (stderr ? '\n' + stderr : '');

      // 报告执行完成
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress(stdout, stderr, 0, false, true),
      });

      return createToolResult(output, {
        newMessages: [
          {
            role: 'system',
            content: `Command executed successfully in ${Date.now() - startTime}ms`,
          },
        ],
      });
    } catch (error: any) {
      // 报告执行错误
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', error.message, 1, false, true),
      });

      return createToolResult(error.message, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${error.message}`,
          },
        ],
      });
    }
  }

  /**
   * 检查命令是否安全
   */
  checkSecurity(command: string) {
    return this.securityAnalyzer.analyze(command);
  }

  /**
   * 检查是否为只读命令
   */
  isReadOnly(input?: Record<string, unknown>): boolean {
    const command = input?.command as string;
    return this.securityAnalyzer.isReadOnlyCommand(command);
  }

  /**
   * 检查是否并发安全
   */
  isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查是否是搜索或读取命令
   */
  isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    const command = input?.command as string;
    if (!command) {
      return { isSearch: false, isRead: false };
    }

    const classification = analyzeBashCommandType(command);
    return {
      isSearch: classification.isSearch,
      isRead: classification.isRead,
      isList: classification.isList,
    };
  }

  /**
   * 准备权限匹配器
   */
  async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const command = (input?.command as string) || '';
    return (pattern: string) => {
      // 简单的模式匹配，支持通配符
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(command);
    };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<Record<string, unknown>>): string {
    const command = (input?.command as string) || '';
    if (command) {
      return `Bash: ${command}`;
    }
    return this.name;
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.command as string) || '';
  }
}
