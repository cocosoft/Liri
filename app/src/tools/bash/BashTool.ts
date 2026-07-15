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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { SandboxSecurityChecker } from '@modules/sandbox/SandboxSecurityChecker';
import { completeSecuritySystem } from '@modules/security';

const execAsync = promisify(exec);

/**
 * BashTool 输入模式 - 对标CC Zod校验
 * 安全审计修复：移除 skipSecurityCheck 参数，安全检查强制运行，不可绕过
 */
const BashInputSchema = z.strictObject({
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
 * 安全命令白名单（F3 修复）
 * 仅允许以这些基命令开头的命令执行，防止任意命令注入
 * 注意：路径类命令（如 ./node_modules/.bin/xxx）也需处理
 */
const ALLOWED_COMMANDS = new Set([
  // 开发工具
  'npm',
  'npx',
  'node',
  'bun',
  'yarn',
  'pnpm',
  // 版本控制
  'git',
  // 文件查看（只读）
  'dir',
  'ls',
  'type',
  'cat',
  'echo',
  'findstr',
  'grep',
  'find',
  // 目录操作
  'cd',
  'mkdir',
  'md',
  // 文件操作
  'copy',
  'move',
  'ren',
  'rename',
  // 网络诊断
  'ping',
  'nslookup',
  'tracert',
  'ipconfig',
  // 系统信息
  'ver',
  'set',
  'whoami',
  'hostname',
  'where',
  // 构建工具
  'make',
  'cargo',
  'rustc',
  'tsc',
  'npx',
  // PowerShell（安全参数）
  'pwsh',
  'powershell',
  // 环境变量查看
  'printenv',
  'env',
  // Python
  'python',
  'python3',
  'pip',
]);

/**
 * 检查命令的基命令是否在白名单中
 * @param command 完整命令字符串
 * @returns 是否允许
 */
function isBaseCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // 提取第一个词（基命令）
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  // 去除路径前缀（如 ./node_modules/.bin/xxx → xxx）
  const baseName = firstWord.replace(/^.*[/\\]/, '');

  // 去除 .cmd / .exe / .ps1 等扩展名
  const cleanName = baseName.replace(/\.(exe|cmd|bat|ps1|com)$/i, '');

  return ALLOWED_COMMANDS.has(cleanName);
}

/** 沙箱安全检查器实例（F2 修复：二次校验） */
const sandboxSecurityChecker = new SandboxSecurityChecker();

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

  /** 是否为 Windows 平台 */
  private isWindows = process.platform === 'win32';

  /** 动态描述：根据平台告知 LLM 实际的执行环境（getter 避免抽象属性构造函数赋值限制） */
  override get description(): string {
    if (this.isWindows) {
      return [
        'Execute commands via Windows Command Prompt (cmd.exe).',
        'IMPORTANT: This runs cmd.exe, NOT bash. Use Windows commands only.',
        '- Use \\ for path separators (e.g. C:\\Users\\...), NOT /',
        '- Use %TEMP% or %USERPROFILE% for temp/user directories, NOT /tmp',
        '- Use dir instead of ls, type instead of cat, findstr instead of grep',
        '- Use del instead of rm, copy instead of cp, move instead of mv',
        '- Use git, npm, node, python etc. as they are available on Windows',
        '- For complex scripts, prefix with powershell -Command "..."',
      ].join('\n');
    }
    return 'Execute shell commands with security checks';
  }

  override tags = [ToolTag.CODE];

  params: ToolParam[];

  override aliases = ['sh', 'shell'];
  override searchHint = 'Execute shell commands with security checks';
  override maxResultSizeChars = 100000;
  searchTips = ['execute', 'command', 'shell', 'bash'];

  private securityAnalyzer: BashSecurityAnalyzer;

  constructor() {
    super();

    // 动态参数描述
    const commandParamDesc = this.isWindows
      ? 'The command to execute. Must be a Windows cmd.exe command (NOT Unix/bash). Use \\ for paths, %VAR% for env vars.'
      : 'The command to execute';
    const commandParamExample = this.isWindows ? 'dir C:\\Users' : 'ls -la';

    this.params = [
      {
        name: 'command',
        type: 'string',
        description: commandParamDesc,
        required: true,
        default: '',
        example: commandParamExample,
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
    ];

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

      let { command, timeout, cwd, env } = parsedInput.data;

      // Windows 平台：预处理命令，翻译常见 Unix 路径
      if (this.isWindows) {
        const preprocessed = this.preprocessWindowsCommand(command);
        if (preprocessed.warnings.length > 0) {
          const warningMsg = `BashTool 命令预处理警告:\n${preprocessed.warnings.join('\n')}`;
          if (preprocessed.warnings.some((w) => w.includes('禁止'))) {
            return createToolResult(warningMsg, {
              newMessages: [
                {
                  role: 'system',
                  content: `Error: ${warningMsg}`,
                },
              ],
            });
          }
        }
        command = preprocessed.command;
        // 自动修正 cwd 中的 Unix 路径
        if (cwd && this.isWindows) {
          cwd = this.translateWindowsPath(cwd);
        }
      }

      // 报告开始执行
      onProgress?.({
        toolUseID: context.toolUseId || 'bash-tool',
        data: createBashProgress('', '', undefined, true, false),
      });

      // 安全审计修复：安全检查强制运行，不可绕过
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
          metadata: { securityIntercepted: true, reason: 'path_safety' },
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
          metadata: { securityIntercepted: true, reason: 'dangerous_command' },
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
          metadata: { securityIntercepted: true, reason: 'dangerous_pattern' },
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
          metadata: { securityIntercepted: true, reason: 'ast_analysis' },
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
            metadata: {
              securityIntercepted: true,
              reason: 'security_analyzer_deny',
            },
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
            metadata: {
              securityIntercepted: true,
              reason: 'security_analyzer_ask',
            },
          }
        );
      }

      // F3 修复：命令白名单检查 — 仅允许安全的基命令
      if (!isBaseCommandAllowed(command)) {
        return createToolResult(
          `安全检查: 命令 "${command.split(/\s+/)[0]}" 不在允许列表中`,
          {
            newMessages: [
              {
                role: 'system',
                content: `Error: 安全检查: 命令 "${command.split(/\s+/)[0]}" 不在允许列表中`,
              },
            ],
            metadata: {
              securityIntercepted: true,
              reason: 'command_whitelist',
            },
          }
        );
      }

      // F2 修复：沙箱安全检查器二次校验（独立于工具层安全检查）
      const sandboxCheckResult =
        sandboxSecurityChecker.checkDangerousCommands(command);
      if (!sandboxCheckResult.allowed) {
        return createToolResult(`沙箱安全检查: ${sandboxCheckResult.reason}`, {
          newMessages: [
            {
              role: 'system',
              content: `Error: 沙箱安全检查: ${sandboxCheckResult.reason}`,
            },
          ],
          metadata: { securityIntercepted: true, reason: 'sandbox_checker' },
        });
      }

      // F5 修复：操作审计日志
      completeSecuritySystem.auditAction({
        sessionId: context.toolUseId || 'unknown',
        action: 'bash_execute',
        actor: 'system',
        target: command.substring(0, 200),
        result: 'allowed',
        level: 1,
        details: `BashTool execute: ${command.substring(0, 100)}`,
      });

      // 对标CC：支持cwd和env参数
      const execOptions: ExecOptions = {
        timeout,
      };

      if (cwd) {
        execOptions.cwd = cwd;
      }

      // 构建环境变量：Windows 上设置 git SSL 后端为 schannel
      const mergedEnv = { ...process.env, ...(env || {}) };
      if (this.isWindows) {
        mergedEnv['GIT_SSL_BACKEND'] = 'schannel';
      }
      execOptions.env = mergedEnv;

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

  /**
   * Windows 命令预处理：翻译常见 Unix 路径和命令
   * @param command 原始命令
   * @returns 预处理后的命令和警告列表
   */
  private preprocessWindowsCommand(command: string): {
    command: string;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let processed = command;

    // 检测 Unix 专用命令（Windows cmd.exe 中不存在）
    const unixOnlyCommands = ['head', 'tail', 'sed', 'awk', 'xargs', 'tee'];
    const cmdWords = processed.split(/\s+/);
    for (const cmd of unixOnlyCommands) {
      if (cmdWords.some((w) => w === cmd || w === `${cmd}.exe`)) {
        warnings.push(
          `${cmd} 是 Unix/Linux 命令，Windows cmd.exe 中不可用。请使用 PowerShell: pwsh -Command "..." 或改用 Windows 等价命令。`
        );
      }
    }

    // 自动翻译常见 Unix 路径为 Windows 路径
    if (processed.includes('/tmp')) {
      processed = processed.replace(/\/tmp\b/g, '%TEMP%');
      warnings.push('已自动将 /tmp 替换为 %TEMP%');
    }
    if (processed.includes('/dev/null')) {
      processed = processed.replace(/\/dev\/null\b/g, 'NUL');
      warnings.push('已自动将 /dev/null 替换为 NUL');
    }

    // 检测 2>&1 重定向（Windows cmd.exe 也支持，但确保格式正确）
    // 无需修改，cmd.exe 支持 2>&1

    // 检测 && 链式命令（cmd.exe 支持）
    // 无需修改，cmd.exe 支持 &&

    // 检测仅包含 Unix 路径的命令（禁止执行）
    if (/\bcd\s+\/[a-z]/.test(processed)) {
      warnings.push(
        '禁止: cd 到 Unix 根路径（如 /tmp、/usr）。请使用 Windows 路径或 %TEMP%。'
      );
    }

    return { command: processed, warnings };
  }

  /**
   * 翻译 Unix 绝对路径为 Windows 路径
   */
  private translateWindowsPath(unixPath: string): string {
    let result = unixPath;
    if (result.startsWith('/tmp')) {
      result = result.replace(
        /^\/tmp/,
        process.env['TEMP'] || 'C:\\Windows\\Temp'
      );
    } else if (result.startsWith('/home/') || result.startsWith('/Users/')) {
      result = result.replace(
        /^\/(home|Users)\/[^/]+/,
        process.env['USERPROFILE'] || 'C:\\Users\\Default'
      );
    }
    return result;
  }
}
