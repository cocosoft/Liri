/**
 * Bash工具
 * 用于执行Bash命令
 */
import { z } from 'zod';
import { Tool } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils, checkPathAccessibility } from '../utils/ToolUtils';
import { exec, execSync, ExecOptions } from 'child_process';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * Bash工具输入模式
 */
const BashInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的Bash命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(30000)
    .describe('执行超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  env: z.record(z.string()).optional().describe('环境变量'),
});

/**
 * Bash工具输出模式
 */
const BashOutputSchema = z.object({
  stdout: z.string().describe('标准输出'),
  stderr: z.string().describe('错误输出'),
  exitCode: z.number().int().describe('退出码'),
});

/**
 * 危险命令列表
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
  'curl',
  'wget',
  'ftp',
  'sftp',
  'ssh',
  'scp',
  'rsync',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'gunzip',
  'bzip2',
  'bunzip2',
  'xz',
  'unxz',
  '7z',
  'rar',
  'unrar',
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
  'ln -sf',
  'mv',
  'cp -f',
  'find . -name',
  'grep -r',
  'sed -i',
  'awk',
  'perl',
  'python',
  'node',
  'ruby',
  'php',
  'java',
  'dotnet',
  'go',
  'rustc',
  'gcc',
  'g++',
  'make',
  'cmake',
  'configure',
  'install',
  'uninstall',
  'apt',
  'apt-get',
  'aptitude',
  'yum',
  'dnf',
  'pacman',
  'zypper',
  'brew',
  'port',
  'npm',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'gem',
  'cargo',
  'composer',
  'docker',
  'docker-compose',
  'kubectl',
  'helm',
  'terraform',
  'ansible',
  'chef',
  'puppet',
  'salt',
  'vagrant',
  'virtualbox',
  'vmware',
  'qemu',
  'kvm',
  'xen',
  'hyper-v',
  'powershell',
  'cmd',
  'bash',
  'sh',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'ash',
  'dash',
  'busybox',
  'systemctl',
  'service',
  'init',
  'sysctl',
  'ulimit',
  'nice',
  'renice',
  'ionice',
  'chrt',
  'taskset',
  'numactl',
  'lsof',
  'netstat',
  'ss',
  'ip',
  'ifconfig',
  'route',
  'arp',
  'iwconfig',
  'iwlist',
  'ethtool',
  'mii-tool',
  'dhclient',
  'dhcpcd',
  'wpa_supplicant',
  'hostapd',
  'dnsmasq',
  'bind',
  'named',
  'apache2',
  'httpd',
  'nginx',
  'lighttpd',
  'tomcat',
  'jetty',
  'glassfish',
  'wildfly',
  'mysql',
  'mariadb',
  'postgres',
  'postgresql',
  'sqlite3',
  'mongodb',
  'redis',
  'memcached',
  'elasticsearch',
  'kafka',
  'zookeeper',
  'rabbitmq',
  'activemq',
  'cassandra',
  'hbase',
  'hadoop',
  'spark',
  'flink',
  'storm',
  'kafka',
  'zookeeper',
  'rabbitmq',
  'activemq',
  'cassandra',
  'hbase',
  'hadoop',
  'spark',
  'flink',
  'storm',
];

/**
 * 危险模式列表（正则表达式）
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//, // 删除根目录
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/, // Fork 炸弹
  />\s*\/dev\/null/, // 重定向到null
  /&\s*;\s*$/, // 后台执行
  /\|\s*sh$/, // 管道到shell
  /\$\([^)]*\)/, // 命令替换
  /`[^`]+`/, // 反引号命令替换
  /;\s*rm\s+/, // 分号执行rm
  /&&\s*rm\s+/, // 逻辑与执行rm
  /\|\|\s*rm\s+/, // 逻辑或执行rm
  /\.\/\.\./, // 路径遍历
  /..\/etc\/passwd/, // 尝试读取密码文件
  /eval\s*\(/, // eval执行
  /exec\s+/, // exec执行
  /source\s+/, // source执行
  /\.\s+\//, // 当前目录执行
];

/**
 * 检查路径是否安全（防止路径遍历攻击）
 */
function isPathSafe(path: string): boolean {
  // 检查路径遍历模式
  const pathTraversalPatterns = [
    /\.\.\//, // 父目录引用
    /^\.\//, // 当前目录引用
    /\/\.\.\//, // 路径中的父目录
    /^\//, // 绝对路径（需要更严格的检查）
  ];

  // 检查危险路径
  const dangerousPaths = [
    /^\/etc\//, // 系统配置目录
    /^\/sys\//, // 系统目录
    /^\/proc\//, // 进程目录
    /^\/boot\//, // 启动目录
    /^\/dev\//, // 设备目录
    /^\/root\//, // root主目录
  ];

  return (
    !pathTraversalPatterns.some((pattern) => pattern.test(path)) &&
    !dangerousPaths.some((pattern) => pattern.test(path))
  );
}

/**
 * Bash工具类
 */
export class BashTool {
  /**
   * 创建Bash工具实例
   * @returns Bash工具实例
   */
  static create(): Tool {
    return {
      name: 'bash',
      description: 'Execute Bash commands',
      params: [
        {
          name: 'command',
          type: 'string',
          description: 'Bash command to execute',
          required: true,
          example: 'ls -la',
        },
        {
          name: 'timeout',
          type: 'number',
          description: 'Execution timeout in milliseconds',
          required: false,
          default: 30000,
        },
        {
          name: 'cwd',
          type: 'string',
          description: 'Working directory',
          required: false,
          default: process.cwd(),
        },
        {
          name: 'env',
          type: 'object',
          description: 'Environment variables',
          required: false,
          default: process.env,
        },
      ],
      aliases: ['sh', 'shell'],
      searchTips: ['execute', 'command', 'shell', 'bash'],
      isEnabled: () => true,
      isReadOnly: (_input?: Record<string, unknown>) => false,
      isDestructive: (_input?: Record<string, unknown>) => false,
      isConcurrencySafe: (_input?: Record<string, unknown>) => false,
      validateInput: (input: Record<string, unknown>) => {
        const result = BashInputSchema.safeParse(input);
        if (!result.success) {
          const errors = result.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
          return { result: false, message: `Bash输入验证失败: ${errors}` };
        }
        return { result: true };
      },
      checkPermissions: async (input: unknown, context: ToolUseContext) => {
        const inputRecord = input as Record<string, unknown>;
        const command = inputRecord.command as string;
        const isSafe = !BashTool.isDangerousCommand(command);
        if (isSafe) {
          return { behavior: 'allow' };
        } else {
          return { behavior: 'deny', message: 'Dangerous command not allowed' };
        }
      },
      execute: async (input: unknown, context: ToolUseContext) => {
        const startTime = Date.now();
        const inputRecord = input as Record<string, unknown>;
        const command = inputRecord.command as string;
        const timeout = (inputRecord.timeout as number) || 30000;
        const cwd = (inputRecord.cwd as string) || process.cwd();
        const env = (inputRecord.env as Record<string, string>) || process.env;

        try {
          const cwdCheck = checkPathAccessibility(cwd, 'Bash工作目录');
          if (!cwdCheck.accessible) {
            return ToolUtils.createFailureResult(
              `${cwdCheck.reason}${cwdCheck.suggestions?.length ? `\n建议: ${cwdCheck.suggestions.join('; ')}` : ''}`,
              {
                executionTime: ToolUtils.calculateExecutionTime(startTime),
                toolName: 'bash',
              }
            );
          }

          // 执行命令
          const result = await BashTool.executeCommand(command, {
            cwd,
            env,
            timeout,
          });
          const executionTime = ToolUtils.calculateExecutionTime(startTime);

          return ToolUtils.createSuccessResult(result.stdout, {
            executionTime,
            output: result.stdout,
            errorOutput: result.stderr,
            toolName: 'bash',
            executionId: ToolUtils.generateExecutionId('bash'),
            timestamp: Date.now(),
          });
        } catch (error) {
          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          return ToolUtils.createFailureResult(
            error instanceof Error ? error.message : 'Unknown error',
            {
              executionTime,
              errorOutput: error instanceof Error ? error.stack || '' : '',
              toolName: 'bash',
              executionId: ToolUtils.generateExecutionId('bash'),
              timestamp: Date.now(),
            }
          );
        }
      },
      getInfo: function () {
        return {
          name: this.name,
          description: this.description,
          params: this.params,
          aliases: this.aliases,
          searchTips: this.searchTips,
          enabled: true,
          readOnly: false,
          destructive: false,
          concurrencySafe: false,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block',
        };
      },
    };
  }

  /**
   * 执行命令
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static executeCommand(
    command: string,
    options: ExecOptions
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, options, (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`Command failed: ${error.message}\nStderr: ${stderr}`)
          );
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      });
    });
  }

  /**
   * 检查命令是否危险
   * @param command 命令
   * @returns 是否危险
   */
  static isDangerousCommand(command: string): boolean {
    const lowerCommand = command.toLowerCase();

    // 检查危险命令列表
    if (
      DANGEROUS_COMMANDS.some((dangerousCommand) =>
        lowerCommand.includes(dangerousCommand.toLowerCase())
      )
    ) {
      return true;
    }

    // 检查危险模式
    if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
      return true;
    }

    // 检查路径安全性
    const pathMatch = command.match(/['"]?(\/[^\s'"]+)['"]?/);
    if (pathMatch) {
      const path = pathMatch[1];
      if (!isPathSafe(path)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 安全执行命令
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static safeExecute(
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
   * 执行同步命令
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static executeCommandSync(
    command: string,
    options: ExecOptions & { encoding: BufferEncoding }
  ): { stdout: string; stderr: string } {
    try {
      const stdout = execSync(command, options).toString();
      return { stdout, stderr: '' };
    } catch (error) {
      throw new AppError(
        `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 安全执行同步命令
   * @param command 命令
   * @param options 选项
   * @returns 执行结果
   */
  static safeExecuteSync(
    command: string,
    options: ExecOptions & { encoding: BufferEncoding }
  ): { stdout: string; stderr: string } {
    if (BashTool.isDangerousCommand(command)) {
      throw new AppError(
        `Dangerous command detected: ${command}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return BashTool.executeCommandSync(command, options);
  }
}
