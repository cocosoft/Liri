/**
 * Bash 工具
 *
 * 提供安全的 Shell 命令执行功能
 * 对标CC源码 src/tools/BashTool/BashTool.ts 实现
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  PermissionResult,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { createBashProgress } from '../types/ToolProgress';
import { ToolUtils } from '../utils/ToolUtils';
import type { InterruptBehavior } from '../types/Tool';
import { ToolTag } from '../types/Tool';
import { BashSecurityAnalyzer } from '@modules/security';
// eslint-disable-next-line no-restricted-imports
import {
  parseForSecurity,
  isDangerousCommand,
  type ParseForSecurityResult,
} from '@modules/security/bash/BashAST';
import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import { analyzeBashCommandType, isSilentBashCommand } from './BashSemantics';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const execAsync = promisify(exec);

/**
 * BashTool 输入模式 - 对标CC Zod校验
 */
const BashInputSchema = z.object({
  command: z.string().min(1, '命令不能为空').describe('要执行的Bash命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(60000)
    .describe('执行超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  env: z.record(z.string()).optional().describe('环境变量'),
  skipSecurityCheck: z
    .boolean()
    .optional()
    .default(false)
    .describe('跳过安全检查'),
});

/**
 * BashTool 输出模式 - 对标CC
 */
const BashOutputSchema = z.object({
  stdout: z.string().describe('标准输出'),
  stderr: z.string().describe('错误输出'),
  exitCode: z.number().int().describe('退出码'),
});

/**
 * 危险命令列表 - 对标CC源码安全策略
 */
const DANGEROUS_COMMANDS = [
  'rm -rf',
  'sudo',
  'su',
  'chmod',
  'chown',
  'dd',
  'mkfs',
  'fdisk',
  'format',
  'shutdown',
  'reboot',
  'poweroff',
  'kill',
  'killall',
  'pkill',
  'openssl',
  'ssh-keygen',
  'passwd',
  'useradd',
  'userdel',
  'groupadd',
  'groupdel',
  'usermod',
  'groupmod',
  'chroot',
  'mount',
  'umount',
  'systemctl',
  'service',
  'init',
];

/**
 * 危险模式列表（正则表达式）- 对标CC源码
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/,
  />\s*\/dev\/null/,
  /\|\s*sh$/,
  /\$\([^)]*\)/,
  /`[^`]+`/,
  /;\s*rm\s+/,
  /&&\s*rm\s+/,
  /\|\|\s*rm\s+/,
  /eval\s*\(/,
  /exec\s+/,
  /source\s+/,
];

/**
 * 检查路径是否安全 - 对标CC源码，适配 Windows
 */
function isPathSafe(path: string): boolean {
  const isWin = process.platform === 'win32';

  // 路径遍历模式：Unix 用 ..//，Windows 额外支持 ..\
  const pathTraversalPatterns = isWin
    ? [/\.\.\//, /^\.\//, /\/\.\.\//, /\.\.\\/, /^\.\\/, /\\\.\.\\/]
    : [/\.\.\//, /^\.\//, /\/\.\.\//, /^\//];

  // 危险系统目录：按平台区分
  const dangerousPaths = isWin
    ? [
        /^[A-Za-z]:\\windows\\/i,
        /^[A-Za-z]:\\system32\\/i,
        /^[A-Za-z]:\\boot\\/i,
        /^[A-Za-z]:\\program files\\/i,
      ]
    : [
        /^\/etc\//,
        /^\/sys\//,
        /^\/proc\//,
        /^\/boot\//,
        /^\/dev\//,
        /^\/root\//,
      ];

  return (
    !pathTraversalPatterns.some((pattern) => pattern.test(path)) &&
    !dangerousPaths.some((pattern) => pattern.test(path))
  );
}

export class BashTool extends BaseTool {
  name = 'bash';
  description = 'Execute bash commands with security checks';

  override tags = [ToolTag.CODE];

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
      description: 'Timeout in milliseconds (max 300000)',
      required: false,
      default: 60000,
    },
    {
      name: 'cwd',
      type: 'string',
      description: 'Working directory',
      required: false,
      default: undefined,
    },
    {
      name: 'env',
      type: 'object',
      description: 'Environment variables',
      required: false,
      default: undefined,
    },
    {
      name: 'skipSecurityCheck',
      type: 'boolean',
      description: 'Skip security validation (dangerous)',
      required: false,
      default: false,
    },
  ];

  override aliases = ['sh', 'shell'];
  override searchHint = 'Execute shell commands with security checks';
  override maxResultSizeChars = 100000;
  searchTips = ['execute', 'command', 'shell', 'bash'];

  private securityAnalyzer: BashSecurityAnalyzer;

  constructor() {
    super();
    this.securityAnalyzer = new BashSecurityAnalyzer();
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      // 对标CC：Zod输入验证
      const parsedInput = BashInputSchema.safeParse(input);
      if (!parsedInput.success) {
        const errors = parsedInput.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        return createToolResult(`Bash输入验证失败: ${errors}`, {
          newMessages: [
            {
              role: 'system',
              content: `Error: ${errors}`,
            },
          ],
        });
      }

      const { command, timeout, cwd, env, skipSecurityCheck } =
        parsedInput.data;

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', '', undefined, true, false),
      });

      if (!skipSecurityCheck) {
        // 对标CC：路径安全检查（适配 Windows 盘符路径）
        const pathMatch = command.match(
          /['"]?((?:\/[^\s'"]+|[A-Za-z]:\\[^\s'"]*))['"]?/
        );
        if (pathMatch && !isPathSafe(pathMatch[1])) {
          return createToolResult('路径安全检查失败: 禁止访问系统敏感目录', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 路径安全检查失败: 禁止访问系统敏感目录',
              },
            ],
          });
        }

        // 对标CC：危险命令列表检查
        const lowerCommand = command.toLowerCase();
        if (
          DANGEROUS_COMMANDS.some((dangerousCommand) =>
            lowerCommand.includes(dangerousCommand.toLowerCase())
          )
        ) {
          return createToolResult('安全检查: 检测到危险命令', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 安全检查: 检测到危险命令',
              },
            ],
          });
        }

        // 对标CC：危险模式检查
        if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
          return createToolResult('安全检查: 检测到危险命令模式', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: 安全检查: 检测到危险命令模式',
              },
            ],
          });
        }

        // 安全检查器分析
        const securityResult = this.securityAnalyzer.analyze(command);

        // AST级安全分析
        const astResult = parseForSecurity(command);
        if (
          astResult.kind === 'simple' &&
          astResult.commands.some((c) => isDangerousCommand(c.argv))
        ) {
          return createToolResult('AST安全分析: 检测到危险命令', {
            newMessages: [
              {
                role: 'system',
                content: 'Error: AST安全分析阻止了危险命令执行',
              },
            ],
          });
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

      // 对标CC：支持cwd和env参数
      const execOptions: ExecOptions = {
        timeout,
      };

      if (cwd) {
        execOptions.cwd = cwd;
      }
      if (env) {
        execOptions.env = { ...process.env, ...env };
      }

      // 执行命令
      const { stdout: rawStdout, stderr: rawStderr } = await execAsync(
        command,
        execOptions
      );
      const stdout = rawStdout as string;
      const stderr = rawStderr as string;

      const output = stdout + (stderr ? '\n' + stderr : '');
      const executionTime = ToolUtils.calculateExecutionTime(startTime);

      // 报告执行完成
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress(stdout, stderr, 0, false, true),
      });

      // 对标CC：返回元数据丰富的结果
      return ToolUtils.createSuccessResult(output, {
        output,
        errorOutput: stderr,
        executionTime,
        toolName: 'bash',
        executionId: ToolUtils.generateExecutionId('bash'),
        timestamp: Date.now(),
        newMessages: [
          {
            role: 'system',
            content: `Command executed successfully in ${executionTime}ms`,
          },
        ],
      });
    } catch (error: any) {
      const executionTime = ToolUtils.calculateExecutionTime(startTime);

      // 报告执行错误
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', error.message, 1, false, true),
      });

      return ToolUtils.createFailureResult(error.message, {
        executionTime,
        errorOutput: error.stderr || error.message,
        toolName: 'bash',
        executionId: ToolUtils.generateExecutionId('bash'),
        timestamp: Date.now(),
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
   * 静态执行命令方法 - 对标CC源码
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static async executeCommand(
    command: string,
    options: ExecOptions
  ): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execAsync(command, options);
    return { stdout: stdout as string, stderr: stderr as string };
  }

  /**
   * 检查命令是否安全 - 对标CC源码
   * @param command 命令
   * @returns 是否安全
   */
  static isDangerousCommand(command: string): boolean {
    const lowerCommand = command.toLowerCase();

    if (
      DANGEROUS_COMMANDS.some((dangerousCommand) =>
        lowerCommand.includes(dangerousCommand.toLowerCase())
      )
    ) {
      return true;
    }

    if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
      return true;
    }

    const pathMatch = command.match(/['"]?(\/[^\s'"]+)['"]?/);
    if (pathMatch && !isPathSafe(pathMatch[1])) {
      return true;
    }

    return false;
  }

  /**
   * 安全执行命令 - 对标CC源码
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static async safeExecute(
    command: string,
    options: ExecOptions
  ): Promise<{ stdout: string; stderr: string }> {
    if (BashTool.isDangerousCommand(command)) {
      throw new AppError(
        `Dangerous command detected: ${command}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return BashTool.executeCommand(command, options);
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
  override isReadOnly(input?: Record<string, unknown>): boolean {
    const command = input?.command as string;
    return this.securityAnalyzer.isReadOnlyCommand(command);
  }

  /**
   * 检查是否并发安全
   */
  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查是否是搜索或读取命令
   */
  override isSearchOrReadCommand(input: Record<string, unknown>): {
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
  override async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const command = (input?.command as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(command);
    };
  }

  /**
   * 获取用户可见的工具名称
   */
  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const command = (input?.command as string) || '';
    if (command) {
      return `Bash: ${command}`;
    }
    return this.name;
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.command as string) || '';
  }

  /**
   * 获取工具完整信息 - 对标CC源码 getInfo 实现
   */
  override getInfo(): {
    name: string;
    description: string;
    params: ToolParam[];
    aliases?: string[];
    searchTips?: string[];
    enabled: boolean;
    readOnly: boolean;
    destructive: boolean;
    concurrencySafe: boolean;
    deferred: boolean;
    alwaysLoad: boolean;
    interruptBehavior: InterruptBehavior;
    maxResultSizeChars?: number;
  } {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive ? this.isDestructive() : false,
      concurrencySafe: this.isConcurrencySafe(),
      deferred: this.shouldDefer || false,
      alwaysLoad: this.alwaysLoad || false,
      interruptBehavior: 'block' as const,
      maxResultSizeChars: this.maxResultSizeChars,
    };
  }
}
