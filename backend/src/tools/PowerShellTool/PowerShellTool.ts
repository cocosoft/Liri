/**
 * PowerShell 工具（Windows专用）
 *
 * 提供安全的 PowerShell 命令执行功能
 * 参考 BashTool 实现，适配 Windows 环境
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import {
  ToolParam,
  InterruptBehavior,
  ValidationResult,
  ToolTag,
} from '../types/Tool';
import { createSuccessResult, createFailureResult } from '../utils/ToolUtils';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

/**
 * PowerShell 输入模式
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
  skipSecurityCheck: z
    .boolean()
    .optional()
    .default(false)
    .describe('跳过安全检查（危险）'),
  workingDirectory: z.string().optional().describe('命令工作目录'),
  executionPolicy: z
    .string()
    .optional()
    .default('Bypass')
    .describe('PowerShell执行策略'),
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

  tags = [ToolTag.CODE];

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
      name: 'skipSecurityCheck',
      type: 'boolean',
      description: 'Skip security validation (dangerous)',
      required: false,
      default: false,
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

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      const command = input.command as string;
      const timeout = (input.timeout as number) || 60000;
      const skipSecurityCheck = (input.skipSecurityCheck as boolean) || false;
      const workingDirectory =
        (input.workingDirectory as string) || context.options.cwd;
      const executionPolicy = (input.executionPolicy as string) || 'Bypass';

      if (!command) {
        return createFailureResult('command is required', {
          executionTime: Date.now() - startTime,
        });
      }

      if (!command) {
        return createFailureResult('command is required', {
          executionTime: Date.now() - startTime,
        });
      }

      if (!skipSecurityCheck) {
        const securityResult = this.securityAnalyzer.analyze(command);

        if (securityResult.behavior === 'deny') {
          return createFailureResult(
            `安全检查失败: ${securityResult.message || '命令被阻止执行'}`,
            {
              executionTime: Date.now() - startTime,
            }
          );
        }

        if (securityResult.behavior === 'ask') {
          return createFailureResult(
            `需要用户确认: ${securityResult.message || '此命令需要确认后执行'}`,
            {
              executionTime: Date.now() - startTime,
            }
          );
        }
      }

      const pwshCommand = this.buildPowerShellCommand(command, executionPolicy);

      const { stdout, stderr } = await execAsync(pwshCommand, {
        cwd: workingDirectory,
        timeout,
        env: { ...process.env, POWERSHELL_TEAPOT: '1' },
      });

      const output = stdout + (stderr ? '\n[stderr]:\n' + stderr : '');

      return createSuccessResult(output, {
        executionTime: Date.now() - startTime,
        output,
      });
    } catch (error: any) {
      if (
        error.message?.includes('ETIMEDOUT') ||
        error.message?.includes('timeout')
      ) {
        return createFailureResult('Command timed out', {
          executionTime: Date.now() - startTime,
        });
      }

      return createFailureResult(error.message, {
        executionTime: Date.now() - startTime,
      });
    }
  }

  /**
   * 构建 PowerShell 命令
   */
  private buildPowerShellCommand(
    command: string,
    executionPolicy: string
  ): string {
    const escapedCommand = command.replace(/"/g, '\\"');
    return `pwsh -NoProfile -ExecutionPolicy ${executionPolicy} -Command "${escapedCommand}"`;
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
    this.dangerousPatterns = [
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
    ];
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
