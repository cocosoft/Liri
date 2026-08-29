/**
 * PowerShell 工具（Windows专用）
 *
 * 提供安全的 PowerShell 命令执行功能
 * 参考 BashTool 实现，适配 Windows 环境
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult, ErrorLevel } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import {
  ToolParam,
  InterruptBehavior,
  ValidationResult,
  ToolTag,
  ToolCallProgress,
} from '../types/Tool';
import {
  createSuccessResult,
  createFailureResult,
  checkPathAccessibility,
} from '../utils/ToolUtils';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { realpathSync, existsSync } from 'fs';
import { DELETION_RULES } from '../../security/patterns/dangerousCommands';
import { SandboxSecurityChecker } from '@modules/sandbox';
import { completeSecuritySystem } from '@modules/security';
import { configManager } from '@modules/config';
import type { PermissionConfig } from '@modules/config/types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:PowerShellTool:PowerShellTool');

/** PowerShell 删除命令别名（来源：dangerousCommands.ts DELETION_RULES） */
const POWERSHELL_DELETION_ALIASES = [
  'remove-item',
  'ri',
  'rm',
  'del',
  'erase',
  'rd',
  'rrmdir',
];

/**
 * PowerShell 安全命令白名单（F3 修复）
 * 仅允许以这些 PowerShell 动词/命令开头的命令执行
 */
const ALLOWED_POWERSHELL_COMMANDS = new Set([
  // 查询类（只读）
  'get-',
  'test-',
  'resolve-',
  'measure-',
  'compare-',
  'select-',
  'where-',
  'group-',
  'sort-',
  'format-',
  'out-',
  'export-',
  'write-',
  'read-',
  'convertto-',
  'convertfrom-',
  // 诊断类
  'debug-',
  'trace-',
  // 安全辅助
  'checkpoint-',
  'diff-',
  // 允许的文件操作
  'new-item',
  'mkdir',
  'md',
  'copy-item',
  'copy',
  'cpi',
  'move-item',
  'move',
  'mi',
  'mv',
  'rename-item',
  'rename',
  'ren',
  'rni',
  // 解压类（zip/tar，低危文件操作；用于 skill/插件包安装解压）
  'expand-archive',
  'tar',
  // 环境变量
  'get-variable',
  'set-variable',
  // 进程信息（只读）
  'get-process',
  'get-service',
  // 帮助
  'get-help',
  'help',
  'man',
  // 构建工具相关
  'npm',
  'node',
  'bun',
  'yarn',
  'pnpm',
  'git',
  'python',
  'python3',
  'pip',
  'cargo',
  'rustc',
  // 基本命令
  'echo',
  'write-host',
  'write-output',
  // 方案八 8b：只读文本搜索放行（findstr 是 cmd.exe 只读工具）
  'findstr',
]);

/** 沙箱安全检查器实例（F2 修复：二次校验） */
const psSandboxChecker = new SandboxSecurityChecker();

/**
 * 检查 PowerShell 命令是否在白名单中
 * @param command PowerShell 命令
 * @returns 是否允许
 */
function isPowerShellCommandAllowed(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) return false;

  // 直接匹配完整命令前缀
  for (const allowed of ALLOWED_POWERSHELL_COMMANDS) {
    if (trimmed.startsWith(allowed)) return true;
  }

  return false;
}

/**
 * 方案三（P0-3）：判断是否为「项目沙箱内的安全删除」。
 * 放行条件（3b 安全约束）：
 *  - 命令为删除类（del / Remove-Item / ri / rm / erase）
 *  - 目标解析后真实路径（realpath）仍在工作目录（项目沙箱）内，阻断符号链接逃逸
 *  - 目标文件名以 `_` 或 `~$` 前缀（临时脚本/Office 锁文件）
 *  - 拒绝通配符 / `.` / `..`（不允许整目录删除）
 */
function isSandboxSafeDelete(
  command: string,
  workingDirectory: string
): boolean {
  const lower = command.toLowerCase();
  const isDelete =
    /(^|[\s;|&])del(\s|\/)/.test(lower) ||
    /(^|[\s;|&])remove-item(\s|-)/.test(lower) ||
    /(^|[\s;|&])ri(\s|-)/.test(lower) ||
    /(^|[\s;|&])rm(\s|-)/.test(lower) ||
    /(^|[\s;|&])erase(\s)/.test(lower);
  if (!isDelete) return false;

  // 提取目标路径（优先引号路径，其次命令最后一个 token）
  const quoted = command.match(/["']([^"']+)["']/);
  const tokens = command.split(/\s+/).filter(Boolean);
  const target = (quoted?.[1] ?? tokens[tokens.length - 1]).trim();
  if (!target || target.includes('*') || target === '.' || target === '..') {
    return false;
  }

  try {
    const abs = path.resolve(workingDirectory, target);
    if (!existsSync(abs)) return false;
    const realAbs = realpathSync(abs);
    const realCwd = realpathSync(workingDirectory);
    const inside =
      realAbs.startsWith(realCwd + '\\') || realAbs.startsWith(realCwd + '/');
    if (!inside) return false;
    const name = path.basename(realAbs);
    return name.startsWith('_') || name.startsWith('~$');
  } catch {
    return false;
  }
}

/**
 * PowerShell 输入模式
 * 安全审计修复：移除 skipSecurityCheck 参数，安全检查强制运行
 */
const PowerShellInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的PowerShell命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(60000)
    .describe('超时时间（毫秒）'),
  workingDirectory: z.string().optional().describe('命令工作目录'),
  executionPolicy: z
    .string()
    .optional()
    .default('Bypass')
    .describe('PowerShell执行策略'),
  depth: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('输出深度限制：限制返回的对象数量，避免输出过于冗长'),
  exclude: z
    .string()
    .optional()
    .describe('排除模式：从输出中排除包含此文本的行（简单文本匹配，非正则）'),
});

/**
 * PowerShell 输出模式
 */
const PowerShellOutputSchema = z.object({
  output: z.string().describe('命令输出'),
  executionTime: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
  exitCode: z.number().int().optional().describe('退出码'),
});

const execAsync = promisify(exec);

/**
 * PowerShell 命令执行工具类
 * 专用于 Windows 环境的命令执行
 */
export class PowerShellTool extends BaseTool {
  name = 'powershell';
  description =
    'Execute PowerShell commands on Windows systems. Use for Windows-specific administration, registry operations, and system management.';

  override tags = [ToolTag.CODE];

  params: ToolParam[] = [
    {
      name: 'command',
      type: 'string',
      description: 'The PowerShell command to execute',
      required: true,
      example: 'Get-Process | Select-Object -First 10',
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds',
      required: false,
      default: 60000,
    },
    {
      name: 'workingDirectory',
      type: 'string',
      description: 'Working directory for the command',
      required: false,
    },
    {
      name: 'executionPolicy',
      type: 'string',
      description: 'PowerShell execution policy (Bypass, RemoteSigned, etc.)',
      required: false,
      default: 'Bypass',
    },
    {
      name: 'depth',
      type: 'number',
      description: 'Limit output to N objects to avoid overly verbose results',
      required: false,
    },
    {
      name: 'exclude',
      type: 'string',
      description:
        'Exclude output lines containing this text (simple text match)',
      required: false,
    },
  ];

  override aliases = ['ps', 'pwsh', 'ps1'];
  searchTips = ['powershell', 'windows', 'admin', 'registry', 'wmi'];
  override searchHint = 'windows administration powershell';

  private securityAnalyzer: PowerShellSecurityAnalyzer;

  constructor() {
    super();
    this.securityAnalyzer = new PowerShellSecurityAnalyzer();
  }

  override validateInput(input: any): ValidationResult {
    const result = PowerShellInputSchema.safeParse(input);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return { result: false, message: `PowerShell输入验证失败: ${errors}` };
    }
    return { result: true };
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    const command = (input?.command as string)?.toLowerCase() || '';
    const readOnlyPatterns = [
      /^get-/,
      /^test-/,
      /^resolve-/,
      /^get-.*-readonly/i,
      /^out-/i,
    ];
    return readOnlyPatterns.some((pattern) => pattern.test(command));
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return this.isReadOnly(input);
  }

  override interruptBehavior(): InterruptBehavior {
    return 'cancel';
  }

  override getPath(input: Record<string, unknown>): string {
    const command = (input?.command as string) || '';
    const pathPatterns = [
      /(?:[-\\/]path(?:Name)?\s+)?['"]?([^'"}\s]+)['"]?/gi,
      /(?:[-\\/]literalPath\s+)?['"]?([^'"}\s]+)['"]?/gi,
      /(?:[-\\/]File\s+)?['"]?([^'"}\s]+\.\w+)['"]?/gi,
    ];

    for (const pattern of pathPatterns) {
      const match = pattern.exec(command);
      if (match) {
        return match[1];
      }
    }
    return '';
  }

  /**
   * 准备权限匹配器
   * 支持通配符权限规则的模糊匹配
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

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    const toolUseId = context.toolUseId || this.name;

    try {
      const command = input.command as string;
      const timeout = (input.timeout as number) || 60000;
      const workingDirectory =
        (input.workingDirectory as string) ||
        context.options.cwd ||
        process.cwd();
      const executionPolicy = (input.executionPolicy as string) || 'Bypass';

      const workingDirCheck = checkPathAccessibility(
        workingDirectory,
        'PowerShell 工作目录'
      );
      if (!workingDirCheck.accessible) {
        return createFailureResult(
          `${workingDirCheck.reason}${workingDirCheck.suggestions?.length ? `\n建议: ${workingDirCheck.suggestions.join('; ')}` : ''}`,
          {
            executionTime: Date.now() - startTime,
            errorLevel: ErrorLevel.RECOVERABLE,
            metadata: {
              errorCategory: 'filesystem',
              errorCode: 'WORKING_DIR_NOT_ACCESSIBLE',
            },
          }
        );
      }

      if (!command) {
        return createFailureResult('command is required', {
          executionTime: Date.now() - startTime,
          errorLevel: ErrorLevel.RECOVERABLE,
          metadata: {
            errorCategory: 'validation',
            errorCode: 'COMMAND_REQUIRED',
          },
        });
      }

      // 安全审计修复：安全检查强制运行，不可绕过
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 10,
          message: '正在执行安全检查...',
          stage: 'security_check',
        },
      });

      // 方案三（P0-3）：项目沙箱内的临时文件安全删除直接放行，
      // 其余命令继续走完整安全检查链（安全分析器 → 白名单 → 沙箱危险命令）
      const isSandboxSafeDeleteCommand = isSandboxSafeDelete(
        command,
        workingDirectory
      );
      if (!isSandboxSafeDeleteCommand) {
        // PowerShell 安全分析器检查
        const securityResult = this.securityAnalyzer.analyze(command);

        if (securityResult.behavior === 'deny') {
          return createFailureResult(
            `安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
            {
              executionTime: Date.now() - startTime,
              errorLevel: ErrorLevel.FATAL,
              metadata: {
                errorCategory: 'security',
                errorCode: 'SECURITY_DENIED',
                securityIntercepted: true,
              },
            }
          );
        }

        if (securityResult.behavior === 'ask') {
          return createFailureResult(
            `需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
            {
              executionTime: Date.now() - startTime,
              errorLevel: ErrorLevel.RECOVERABLE,
              metadata: {
                errorCategory: 'permission',
                errorCode: 'USER_CONFIRMATION_REQUIRED',
                securityIntercepted: true,
              },
            }
          );
        }

        // F3 修复：PowerShell 命令白名单检查
        if (!isPowerShellCommandAllowed(command)) {
          return createFailureResult(
            `安全检查: PowerShell 命令 "${command.split(/\s+/)[0]}" 不在允许列表中`,
            {
              executionTime: Date.now() - startTime,
              errorLevel: ErrorLevel.FATAL,
              metadata: {
                errorCategory: 'security',
                errorCode: 'COMMAND_NOT_ALLOWED',
                securityIntercepted: true,
              },
            }
          );
        }

        // F2 修复：沙箱安全检查器二次校验
        const sandboxCheckResult =
          psSandboxChecker.checkDangerousCommands(command);
        if (!sandboxCheckResult.allowed) {
          return createFailureResult(
            `沙箱安全检查: ${sandboxCheckResult.reason}`,
            {
              executionTime: Date.now() - startTime,
              errorLevel: ErrorLevel.FATAL,
              metadata: {
                errorCategory: 'security',
                errorCode: 'SANDBOX_SECURITY_DENIED',
                securityIntercepted: true,
              },
            }
          );
        }
      }

      // F5 修复：操作审计日志
      completeSecuritySystem.auditAction({
        sessionId: context.toolUseId || 'unknown',
        action: 'powershell_execute',
        actor: 'system',
        target: command.substring(0, 200),
        result: 'allowed',
        level: 1,
        details: `PowerShellTool execute: ${command.substring(0, 100)}`,
      });

      const depth = input.depth as number | undefined;
      const exclude = input.exclude as string | undefined;
      const pwshCommand = this.buildPowerShellCommand(
        command,
        executionPolicy,
        depth,
        exclude
      );

      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 30,
          message: `正在执行: ${command.substring(0, 80)}`,
          stage: 'executing',
        },
      });

      const { stdout, stderr } = await execAsync(pwshCommand, {
        cwd: workingDirectory,
        timeout,
        env: { ...process.env, POWERSHELL_TEAPOT: '1' },
      });

      const output = stdout + (stderr ? '\n[stderr]:\n' + stderr : '');

      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 100,
          message: 'PowerShell 命令执行完成',
          stage: 'completed',
        },
      });

      return createSuccessResult(output, {
        executionTime: Date.now() - startTime,
        output,
      });
    } catch (error: unknown) {
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 100,
          message: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
          stage: 'error',
        },
      });

      const psMsg = error instanceof Error ? error.message : String(error);
      const executionTime = Date.now() - startTime;

      // 排查锚点：powershell 失败时必须记录命令、超时配置、错误分类与耗时，
      // 否则日志只有"权限通过"，circuit_breaker 触发时无法定位是超时/命令错误/输出过大。
      // 输出截断 200 字符避免日志膨胀；命令保留前 200 字符便于复现。
      // command/timeout 在 try 块内定义，catch 中从 input 重新读取。
      const commandPreview = String(input.command ?? '').slice(0, 200);
      const timeoutConfig = Number(input.timeout) || 60000;
      const isTimeout =
        psMsg.includes('ETIMEDOUT') || psMsg.includes('timeout');
      logger.warn('powershell:execution_failed', {
        toolCallId: toolUseId,
        sessionId: context.sessionId,
        commandPreview,
        timeout: timeoutConfig,
        executionTimeMs: executionTime,
        isTimeout,
        errorPreview: psMsg.slice(0, 200),
      });

      if (isTimeout) {
        return createFailureResult('Command timed out', {
          executionTime,
          errorLevel: ErrorLevel.RETRYABLE,
          metadata: { errorCategory: 'execution', errorCode: 'TIMEOUT' },
        });
      }

      return createFailureResult(psMsg, {
        executionTime,
        errorLevel: ErrorLevel.RETRYABLE,
        metadata: { errorCategory: 'execution', errorCode: 'EXECUTION_FAILED' },
      });
    }
  }

  /**
   * 构建 PowerShell 命令
   * @param command 原始命令
   * @param executionPolicy 执行策略
   * @param depth 可选的输出深度限制
   * @param exclude 可选的排除文本模式
   */
  private buildPowerShellCommand(
    command: string,
    executionPolicy: string,
    depth?: number,
    exclude?: string
  ): string {
    let finalCommand = command;

    // 追加 depth 限制：通过 Select-Object -First 限制输出对象数
    if (depth !== undefined && depth > 0) {
      finalCommand += ` | Select-Object -First ${depth}`;
    }

    // 追加 exclude 过滤：通过 Select-String 排除匹配行
    if (exclude) {
      // 转义单引号防止命令注入
      const escapedExclude = exclude.replace(/'/g, "''");
      finalCommand += ` | Select-String -NotMatch -SimpleMatch '${escapedExclude}'`;
    }

    // 使用 EncodedCommand 避免双层引号转义问题：
    // child_process.exec 在 Windows 上通过 cmd.exe /d /s /c 执行，
    // cmd.exe 对引号的处理（^" 或 ""）与 PowerShell（`" 或 ""）不同，
    // 导致含双引号的命令（如 LLM 用引号包裹含中文符号的文件路径）被错误解析。
    // Base64 编码完全绕过 cmd.exe → pwsh 的引号转义层，支持任意 Unicode 字符。
    const encoded = Buffer.from(finalCommand, 'utf16le').toString('base64');
    return `pwsh -NoProfile -ExecutionPolicy ${executionPolicy} -EncodedCommand ${encoded}`;
  }

  /**
   * 检查命令安全性
   */
  checkSecurity(command: string) {
    return this.securityAnalyzer.analyze(command);
  }
}

/**
 * PowerShell 安全分析器
 *
 * 提供多层次的 PowerShell 命令安全检查
 */
export class PowerShellSecurityAnalyzer {
  private dangerousPatterns: Array<{
    pattern: RegExp;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    behavior: 'allow' | 'ask' | 'deny';
    message: string;
    name: string;
  }>;

  constructor() {
    // 从用户配置加载自定义黑名单，合并到危险模式列表
    const customBlacklistPatterns = this.loadCustomBlacklistPatterns();

    this.dangerousPatterns = [
      // P0 紧急新增：Remove-Item 别名全覆盖
      {
        name: 'recursive_deletion',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+.*(?:-recurse|/s|-r|recurse)`,
          'i'
        ),
        riskLevel: 'high',
        behavior: 'ask',
        message: '检测到递归删除操作，请确认目标和范围',
      },
      {
        name: 'bulk_deletion',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+.*(?:-recurse|/s|-r|/f|-force|force|recurse)`,
          'i'
        ),
        riskLevel: 'high',
        behavior: 'ask',
        message: '检测到批量删除操作，请确认目标和范围',
      },
      {
        name: 'remove_item_generic',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+`,
          'i'
        ),
        riskLevel: 'medium',
        behavior: 'ask',
        message: '检测到文件删除操作，请确认目标和范围',
      },
      {
        name: 'registry_deletion',
        pattern: /remove-item\s+[-/]?(?:path|literalpath)\s+['"]?hklm:/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止删除注册表项',
      },
      {
        name: 'system_file_deletion',
        pattern:
          /remove-item\s+[-/]?([cC]:\\windows|[cC]:\\program\s*files|\/var|\/usr)/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止删除系统文件',
      },
      {
        name: 'format_command',
        pattern: /format-(?:volume|drive)\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止格式化操作',
      },
      {
        name: 'stop_critical_service',
        pattern:
          /stop-service\s+[-/]?(?:name|displayname)\s+['"]?(?:windows\s*update|bits|event\s*log|wuauserv)/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止停止关键服务',
      },
      {
        name: 'firewall_modification',
        pattern: /(?:set|remove)-netfirewall(?:rule|profile)/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '防火墙修改需要确认',
      },
      {
        name: 'user_creation',
        pattern: /new-localuser|net\s+user\s+\/add/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '创建用户账户需要确认',
      },
      {
        name: 'password_reset',
        pattern: /net\s+user\s+.*\s+\/setpassword/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '密码重置需要确认',
      },
      {
        name: 'scheduled_task_creation',
        pattern: /register-scheduledtask|schtasks\s+\/create/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '创建计划任务需要确认',
      },
      {
        name: 'service_creation',
        pattern: /new-service\s+[-/]?name/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '创建服务需要确认',
      },
      {
        name: 'remote_connection',
        pattern:
          /(?:new-pssession|enter-pssession|invoke-command).*-(?:computername|sessionname)/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '远程连接需要确认',
      },
      {
        name: 'download_execution',
        pattern:
          /(?:invoke-webrequest|invoke-restmethod|curl|wget).*[-/]?(?:outfile|saveas)/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '下载并执行需要确认',
      },
      {
        name: 'registry_modification',
        pattern: /set-itemproperty\s+[-/]?path\s+['"]?hklm:/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '注册表修改需要确认',
      },
      {
        name: 'process_kill',
        pattern:
          /stop-process\s+[-/]?(?:name|id)\s+['"]?(?:system|csrss|lsass|smss|winlogon)/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止终止系统关键进程',
      },
      {
        name: 'disk_partition',
        pattern: /(?:clear|rescan|update|repair)-disk/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '磁盘操作需要确认',
      },
      {
        name: 'boot_modification',
        pattern: /bcdedit|bootrec/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '启动配置修改需要确认',
      },
      // V7 修复：补充 PowerShell 危险命令（安全审计发现）
      {
        name: 'invoke_expression',
        pattern: /invoke-expression\s+|iex\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Invoke-Expression（iex），可执行任意代码',
      },
      {
        name: 'invoke_command',
        pattern: /invoke-command\s+|icm\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Invoke-Command（icm），可远程执行任意代码',
      },
      {
        name: 'start_process',
        pattern: /start-process\s+|saps\s+/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止 Start-Process，可启动任意进程',
      },
      {
        name: 'wmi_manipulation',
        pattern:
          /(?:get-wmiobject|set-wmiinstance|invoke-wmimethod|get-ciminstance|set-ciminstance|invoke-cimmethod)\s+/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止 WMI/CIM 操作，可修改系统配置',
      },
      {
        name: 'add_type',
        pattern: /add-type\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Add-Type，可加载任意 .NET 程序集',
      },
      {
        name: 'net_assembly_load',
        pattern: /\[system\.reflection\.assembly\]::load/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止反射加载 .NET 程序集',
      },
      // 用户自定义黑名单规则
      ...customBlacklistPatterns,
    ];
  }

  /**
   * 从用户配置加载自定义命令黑名单，转换为危险模式列表
   * @returns 自定义黑名单模式列表
   */
  private loadCustomBlacklistPatterns(): Array<{
    pattern: RegExp;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    behavior: 'allow' | 'ask' | 'deny';
    message: string;
    name: string;
  }> {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const blacklist = permission?.customRules?.commandRules?.blacklist;
      if (!blacklist || blacklist.length === 0) return [];

      return blacklist.map((rule, idx) => ({
        name: `custom_blacklist_${idx}`,
        pattern: new RegExp(
          rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        ),
        riskLevel: 'high' as const,
        behavior: 'deny' as const,
        message: `用户自定义黑名单拦截: ${rule.pattern}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 白名单前置检查：当配置了 whitelist 模式时，只放行匹配白名单的指令
   * @param command 命令字符串
   * @returns 非 null 表示白名单检查结果（null 表示未启用白名单模式）
   */
  private checkWhitelistPreCheck(command: string): {
    safe: boolean;
    behavior: 'allow' | 'ask' | 'deny';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    message?: string;
    matchedPatterns: string[];
  } | null {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const rules = permission?.customRules?.commandRules;
      if (!rules || rules.mode !== 'whitelist') return null;

      const whitelistPatterns = rules.whitelist || [];
      const matched = whitelistPatterns.some((r) =>
        command.toLowerCase().includes(r.pattern.toLowerCase())
      );

      if (matched) {
        return {
          safe: true,
          behavior: 'allow',
          riskLevel: 'low',
          matchedPatterns: [],
        };
      }

      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: [`未匹配白名单规则: ${command}`],
      };
    } catch {
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: ['白名单检查异常，已熔断拒绝'],
      };
    }
  }

  /**
   * 分析命令安全性
   */
  analyze(command: string): {
    safe: boolean;
    behavior: 'allow' | 'ask' | 'deny';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    message?: string;
    matchedPatterns: string[];
  } {
    if (!command) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    // 前置检查：白名单模式 — 配置了 whitelist 时，只放行匹配的指令
    {
      const preCheck = this.checkWhitelistPreCheck(trimmedCommand);
      if (preCheck) return preCheck;
    }

    const matchedPatterns: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let finalBehavior: 'allow' | 'ask' | 'deny' = 'allow';
    const messages: string[] = [];

    for (const danger of this.dangerousPatterns) {
      if (danger.pattern.test(trimmedCommand)) {
        matchedPatterns.push(danger.name);

        if (this.isHigherRisk(danger.riskLevel, highestRiskLevel)) {
          highestRiskLevel = danger.riskLevel;
        }

        if (danger.behavior === 'deny') {
          finalBehavior = 'deny';
        } else if (danger.behavior === 'ask' && finalBehavior !== 'deny') {
          finalBehavior = 'ask';
        }

        if (danger.message) {
          messages.push(danger.message);
        }
      }
    }

    const safe = finalBehavior === 'allow';

    return {
      safe,
      behavior: finalBehavior,
      riskLevel: highestRiskLevel,
      message: messages.length > 0 ? messages.join('; ') : undefined,
      matchedPatterns,
    };
  }

  /**
   * 比较风险等级
   */
  private isHigherRisk(a: string, b: string): boolean {
    const order = ['low', 'medium', 'high', 'critical'];
    return order.indexOf(a) > order.indexOf(b);
  }
}

/**
 * 创建PowerShell工具实例
 * @returns PowerShell工具实例
 */
export function createPowerShellTool(): PowerShellTool {
  return new PowerShellTool();
}
