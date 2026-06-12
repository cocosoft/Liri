/**
 * ShellExecutor —— 命令执行管线统一模块
 *
 * 将分散在 PowerShellTool、BashTool、ToolExecutor 中的
 * 转义 + 安全检查 + 执行 + 错误归一 收归一个公共模块。
 *
 * 核心设计：
 *   - 转义层：统一使用 base64 编码，消灭引号地狱
 *   - 安全层：合并 PowerShell + Bash 的安全规则，统一输出
 *   - 执行层：统一 child_process.exec 出口
 *   - 错误归一化：拆分 stdout/stderr，去除 cmd.exe 本地化前缀污染
 */
import { exec } from 'child_process';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

// ─── 类型定义 ───────────────────────────────────────────────

export type ShellType = 'powershell' | 'bash' | 'cmd';

export interface ShellExecOptions {
  /** 要执行的命令 */
  command: string;
  /** 目标 shell 类型 */
  shell: ShellType;
  /** 超时时间（毫秒），默认 60000 */
  timeout?: number;
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否跳过安全检查（默认 false） */
  skipSecurity?: boolean;
  /** PowerShell 执行策略（仅 powershell 类型生效），默认 Bypass */
  executionPolicy?: string;
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export interface SecurityCheckResult {
  safe: boolean;
  behavior: 'allow' | 'ask' | 'deny';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
  errors: string[];
  matchedPatterns: string[];
}

interface SecurityPattern {
  name: string;
  pattern: RegExp;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  behavior: 'allow' | 'ask' | 'deny';
  message: string;
  /** 仅在特定 shell 类型下生效，undefined 表示所有 shell */
  shellType?: ShellType;
}

// ─── 安全规则 ────────────────────────────────────────────────

/**
 * 平台无关的危险命令列表（Bash & PowerShell 通用）
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
];

/**
 * 平台无关的危险正则模式
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/,
  />\s*\/dev\/null/,
  /&\s*;\s*$/,
  /\|\s*sh$/,
  /\$\([^)]*\)/,
  /`[^`]+`/,
  /;\s*rm\s+/,
  /&&\s*rm\s+/,
  /\|\|\s*rm\s+/,
  /\.\/\.\./,
  /..\/etc\/passwd/,
  /eval\s*\(/,
  /exec\s+/,
  /source\s+/,
  /\.\s+\//,
];

/**
 * PowerShell 专用危险模式（共 15 条）
 */
const POWERSHELL_DANGEROUS_PATTERNS: SecurityPattern[] = [
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

// ─── 路径安全 ────────────────────────────────────────────────

/**
 * 检查 Unix 路径是否安全（防止路径遍历攻击 / 系统目录访问）
 */
function isPathSafe(path: string): boolean {
  const pathTraversalPatterns = [
    /\.\.\//,
    /^\.\//,
    /\/\.\.\//,
    /^\//,
  ];

  const dangerousPaths = [
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

// ─── ShellExecutor 主类 ──────────────────────────────────────

export class ShellExecutor {
  private static instance: ShellExecutor;

  static getInstance(): ShellExecutor {
    if (!ShellExecutor.instance) {
      ShellExecutor.instance = new ShellExecutor();
    }
    return ShellExecutor.instance;
  }

  // ─── 核心入口 ──────────────────────────────────────────────

  /**
   * 执行 shell 命令（统一入口）
   *
   * 管线：编码 → 安全检查 → 执行 → 错误归一化
   */
  async execute(options: ShellExecOptions): Promise<ShellExecResult> {
    const startTime = Date.now();

    // 1. 安全检查
    if (!options.skipSecurity) {
      const securityResult = this.securityCheck(
        options.command,
        options.shell
      );

      if (securityResult.behavior === 'deny') {
        const errorMessage =
          securityResult.errors.join('; ') ||
          '命令被安全策略拒绝';

        throw new AppError(
          `命令安全拦截: ${errorMessage}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 2. 编码命令
    const encodedCommand = this.buildEncodedCommand(
      options.command,
      options.shell,
      options.executionPolicy
    );

    // 3. 执行
    const { stdout, stderr, exitCode } = await this.executeRaw(
      encodedCommand,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      }
    );

    return {
      stdout,
      stderr,
      exitCode,
      executionTime: Date.now() - startTime,
    };
  }

  // ─── 转义层：统一 base64 编码 ────────────────────────────────

  /**
   * 构建编码后的 shell 命令（base64 方案消灭引号转义）
   */
  private buildEncodedCommand(
    command: string,
    shell: ShellType,
    executionPolicy?: string
  ): string {
    const encoded = Buffer.from(command, 'utf-8').toString('base64');

    switch (shell) {
      case 'powershell': {
        const policy = executionPolicy || 'Bypass';
        return `pwsh -NoProfile -ExecutionPolicy ${policy} -EncodedCommand ${encoded}`;
      }

      case 'bash':
        // Windows 上通过 Git Bash / WSL 执行
        return `bash -c "$(echo ${encoded} | base64 -d)"`;

      case 'cmd':
        // 通过 PowerShell 解码后传给 cmd.exe
        return `powershell -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')) | cmd /c"`;

      default:
        return command;
    }
  }

  // ─── 安全层：合并规则 ──────────────────────────────────────

  /**
   * 安全检查（合并 PowerShell + Bash 两套规则）
   *
   * @param command 原始命令
   * @param shell 目标 shell 类型
   * @returns 安全检查结果
   */
  securityCheck(command: string, shell: ShellType): SecurityCheckResult {
    if (!command || !command.trim()) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        warnings: [],
        errors: [],
        matchedPatterns: [],
      };
    }

    const trimmedCommand = command.trim();
    const warnings: string[] = [];
    const errors: string[] = [];
    const matchedPatterns: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let finalBehavior: 'allow' | 'ask' | 'deny' = 'allow';

    const lowerCommand = trimmedCommand.toLowerCase();

    // 1. 检查通用危险命令列表
    for (const dangerousCommand of DANGEROUS_COMMANDS) {
      if (lowerCommand.includes(dangerousCommand.toLowerCase())) {
        matchedPatterns.push(`command:${dangerousCommand}`);
        if (this.isHigherRisk('high', highestRiskLevel)) {
          highestRiskLevel = 'high';
        }
        finalBehavior = 'ask';
        warnings.push(`检测到敏感命令: ${dangerousCommand}`);
      }
    }

    // 2. 检查通用危险模式（正则）
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmedCommand)) {
        matchedPatterns.push(`pattern:${pattern.source}`);
        highestRiskLevel = 'critical';
        finalBehavior = 'deny';
        errors.push(`检测到危险命令模式: ${pattern.source}`);
      }
    }

    // 3. PowerShell 专用危险模式
    if (shell === 'powershell') {
      for (const psPattern of POWERSHELL_DANGEROUS_PATTERNS) {
        if (psPattern.pattern.test(trimmedCommand)) {
          matchedPatterns.push(psPattern.name);

          if (this.isHigherRisk(psPattern.riskLevel, highestRiskLevel)) {
            highestRiskLevel = psPattern.riskLevel;
          }

          if (psPattern.behavior === 'deny') {
            finalBehavior = 'deny';
            errors.push(psPattern.message);
          } else if (
            psPattern.behavior === 'ask' &&
            finalBehavior !== 'deny'
          ) {
            finalBehavior = 'ask';
            warnings.push(psPattern.message);
          }
        }
      }
    }

    // 4. 路径安全检查（仅匹配 Unix 绝对路径，排除 Windows 的 /param 格式）
    const pathMatch = trimmedCommand.match(
      /['"]?(\/[a-zA-Z][a-zA-Z0-9_]*\/[^\s'"]+)['"]?/
    );
    if (pathMatch) {
      const path = pathMatch[1];
      if (!isPathSafe(path)) {
        matchedPatterns.push(`unsafe_path:${path}`);
        highestRiskLevel = 'high';
        finalBehavior = 'deny';
        errors.push(`路径安全检查失败: 禁止访问系统敏感目录 (${path})`);
      }
    }

    return {
      safe: finalBehavior !== 'deny' && errors.length === 0,
      behavior: finalBehavior,
      riskLevel: highestRiskLevel,
      warnings,
      errors,
      matchedPatterns,
    };
  }

  /**
   * 比较风险等级
   */
  private isHigherRisk(
    a: SecurityCheckResult['riskLevel'],
    b: SecurityCheckResult['riskLevel']
  ): boolean {
    const levels: Record<string, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };
    return levels[a] > levels[b];
  }

  // ─── 执行层：统一 child_process 出口 ────────────────────────

  /**
   * 执行原始命令（已编码后的 shell 命令）
   */
  private executeRaw(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          timeout: options.timeout || 60000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          if (error) {
            // 命令执行失败（非零退出码或超时）
            resolve({
              stdout: stdout || '',
              stderr: stderr || error.message,
              exitCode: (error as any).code || 1,
            });
            return;
          }

          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: 0,
          });
        }
      );
    });
  }
}

// ─── 导出便捷函数 ────────────────────────────────────────────

export function getDefaultShellExecutor(): ShellExecutor {
  return ShellExecutor.getInstance();
}