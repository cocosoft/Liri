/**
 * 沙箱安全检查器
 * 提供命令安全检查、路径安全验证、危险操作检测等功能
 */

import { SandboxExecuteOptions, SandboxConfig } from './SandboxTypes';
import { DELETION_RULES } from '../security/patterns/dangerousCommands';

/**
 * 沙箱安全检查器安全检查结果
 */
export interface SecurityCheckResult {
  /** 是否通过检查 */
  allowed: boolean;
  /** 检查原因 */
  reason: string;
  /** 匹配的危险模式（如果有） */
  matchedPattern?: string;
  /** 建议的操作 */
  suggestion?: string;
}

/**
 * 安全检查器配置
 */
export interface SecurityCheckerConfig {
  /** 启用危险命令检测 */
  enableDangerousCommandDetection: boolean;
  /** 启用路径遍历检测 */
  enablePathTraversalDetection: boolean;
  /** 启用环境变量污染检测 */
  enableEnvPollutionDetection: boolean;
  /** 启用敏感路径检测 */
  enableSensitivePathDetection: boolean;
  /** 启用命令注入检测 */
  enableCommandInjectionDetection: boolean;
  /** 启用零宽字符检测 */
  enableZeroWidthDetection: boolean;
  /** 启用空字节注入检测 */
  enableNullByteDetection: boolean;
  /** 启用Zsh equals expansion检测 */
  enableZshEqualsExpansionDetection: boolean;
}

/**
 * 沙箱安全检查器
 */
export class SandboxSecurityChecker {
  private config: SecurityCheckerConfig;

  /**
   * 危险命令模式列表
   */
  private readonly dangerousCommands = new Set([
    // P1 统一来源：DELETION_RULES（dangerousCommands.ts）PowerShell 删除别名
    'remove-item',
    'ri',
    'rm',
    'del',
    'erase',
    'rd',
    'rrmdir',
    // 文件系统破坏命令
    'rm -rf',
    'rm -fr',
    'rm -rf /',
    'rm -rf *',
    'rm -rf /*',
    'del /s /q',
    'erase /f /s',
    'rd /s /q',
    'format',
    'mkfs',
    'mkfs.ext',
    'mkfs.xfs',
    'dd if=',
    'dd of=/dev/',
    'dd of=/dev/sd',
    'dd of=/dev/hd',
    'chmod 777',
    'chmod -R 777',
    'chmod a+rwx',
    'chown -R',
    'chgrp -R',
    'chown root',
    'chgrp root',
    'truncate -s 0',
    'fallocate -l 0',
    // Fork炸弹
    ':(){ :|:& };:',
    'forkbomb',
    '(){ :|:& };:',
    // 权限提升
    'sudo',
    'su root',
    'pkexec',
    'doas',
    'su -',
    'sudo -i',
    // 远程代码执行
    'curl | bash',
    'wget | bash',
    'curl | sh',
    'wget | sh',
    'curl | sudo',
    'wget | sudo',
    'curl | su',
    'wget | su',
    'base64 -d |',
    'echo ... | base64',
    'echo | base64 -d',
    'python -c',
    'python3 -c',
    'perl -e',
    'ruby -e',
    'node -e',
    'bash -c',
    'sh -c',
    'zsh -c',
    'ksh -c',
    'curl -sL',
    'curl -s',
    'wget -q',
    'wget -qO-',
    // 命令注入
    'eval ',
    'exec ',
    'source ',
    '. ',
    // Zsh equals expansion
    '=rm',
    '=sh',
    '=bash',
    '=cp',
    '=mv',
    '=cat',
    '=echo',
    '=kill',
    '=sudo',
    '=su',
    '=curl',
    '=wget',
    '=python',
    // 环境变量污染
    'PATH=',
    'LD_PRELOAD=',
    'LD_LIBRARY_PATH=',
    'PYTHONPATH=',
    'PERL5LIB=',
    'RUBYLIB=',
    'NODE_PATH=',
    'IFS=',
    'HOME=',
    'USER=',
    'SHELL=',
    'LOGNAME=',
  ]);

  /**
   * 敏感路径列表
   */
  private readonly sensitivePaths = new Set([
    // Unix/Linux系统目录（系统关键目录）
    '/etc/',
    '/sys/',
    '/proc/',
    '/usr/bin/',
    '/usr/sbin/',
    '/bin/',
    '/sbin/',
    '/var/',
    '/boot/',
    '/lib/',
    '/lib64/',
    '/root/',
    '/tmp/',
    '/var/tmp/',
    '/run/',
    // Windows系统目录
    'C:\\',
    'D:\\',
    '\\\\.\\',
    '\\\\?\\',
    // 敏感文件
    '/etc/passwd',
    '/etc/shadow',
    '/etc/group',
    '/etc/gshadow',
    '/etc/hosts',
    '/etc/resolv.conf',
    '/etc/ssh/',
    '/etc/sudoers',
    '/root/.ssh/',
    '/var/log/',
    '/var/log/auth.log',
    'cat /root/.ssh/id_rsa',
    'cat /home/*/.ssh/id_rsa',
  ]);

  /**
   * 路径遍历模式
   */
  private readonly pathTraversalPatterns = new Set([
    '../',
    '..\\',
    '/../',
    '\\..\\',
    '..//',
    './/..',
    '.../',
    '..../',
    '..\\..\\',
    '../..',
    // URL编码版本
    '%2e%2e/',
    '%2e%2e\\',
    '%2f%2e%2e',
    '%5c%2e%2e',
    // Unicode编码版本
    '%u002e%u002e/',
    '%u002e%u002e\\',
    // 双重编码版本
    '%252e%252e/',
    '%252e%252e\\',
  ]);

  /**
   * 命令注入模式
   */
  private readonly commandInjectionPatterns = new Set([
    // 命令替换
    '$(',
    '`',
    '${',
    '${{',
    // 管道操作符
    ' | ',
    ' || ',
    ' && ',
    ' ; ',
    // 重定向
    ' > ',
    ' >> ',
    ' 2> ',
    ' 2>> ',
    // 后台执行
    ' & ',
    ' &',
  ]);

  /**
   * Unicode零宽字符
   */
  private readonly zeroWidthCharacters = new Set([
    '\u200B',
    '\u200C',
    '\u200D',
    '\u2060',
    '\uFEFF',
    '\u2028',
    '\u2029',
    '\u180E',
    '\u200E',
    '\u200F',
  ]);

  constructor(config?: Partial<SecurityCheckerConfig>) {
    this.config = {
      enableDangerousCommandDetection: true,
      enablePathTraversalDetection: true,
      enableEnvPollutionDetection: true,
      enableSensitivePathDetection: true,
      enableCommandInjectionDetection: true,
      enableZeroWidthDetection: true,
      enableNullByteDetection: true,
      enableZshEqualsExpansionDetection: true,
      ...config,
    };
  }

  /**
   * 执行完整的安全检查
   * @param options 执行选项
   * @param config 沙箱配置
   * @returns 安全检查结果
   */
  check(
    options: SandboxExecuteOptions,
    config: SandboxConfig
  ): SecurityCheckResult {
    // 检查命令参数
    const argsString = options.args.join(' ');

    // 检查危险命令
    if (this.config.enableDangerousCommandDetection) {
      const dangerousCheck = this.checkDangerousCommands(argsString);
      if (!dangerousCheck.allowed) {
        return dangerousCheck;
      }
    }

    // 检查路径遍历
    if (this.config.enablePathTraversalDetection) {
      const traversalCheck = this.checkPathTraversal(argsString);
      if (!traversalCheck.allowed) {
        return traversalCheck;
      }
    }

    // 检查敏感路径
    if (this.config.enableSensitivePathDetection) {
      const sensitiveCheck = this.checkSensitivePaths(argsString);
      if (!sensitiveCheck.allowed) {
        return sensitiveCheck;
      }
    }

    // 检查命令注入
    if (this.config.enableCommandInjectionDetection) {
      const injectionCheck = this.checkCommandInjection(argsString);
      if (!injectionCheck.allowed) {
        return injectionCheck;
      }
    }

    // 检查零宽字符
    if (this.config.enableZeroWidthDetection) {
      const zeroWidthCheck = this.checkZeroWidthCharacters(argsString);
      if (!zeroWidthCheck.allowed) {
        return zeroWidthCheck;
      }
    }

    // 检查空字节注入
    if (this.config.enableNullByteDetection) {
      const nullByteCheck = this.checkNullByteInjection(argsString);
      if (!nullByteCheck.allowed) {
        return nullByteCheck;
      }
    }

    // 检查Zsh equals expansion
    if (this.config.enableZshEqualsExpansionDetection) {
      const zshCheck = this.checkZshEqualsExpansion(argsString);
      if (!zshCheck.allowed) {
        return zshCheck;
      }
    }

    // 检查环境变量污染
    if (this.config.enableEnvPollutionDetection && options.env) {
      const envCheck = this.checkEnvironmentPollution(options.env);
      if (!envCheck.allowed) {
        return envCheck;
      }
    }

    // 检查工作目录
    if (options.cwd) {
      const cwdCheck = this.checkWorkingDirectory(options.cwd, config);
      if (!cwdCheck.allowed) {
        return cwdCheck;
      }
    }

    return {
      allowed: true,
      reason: '命令通过安全检查',
    };
  }

  /**
   * 检查危险命令
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkDangerousCommands(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();
    // 方案八 8b：危险词改为「token 边界匹配」，杜绝子串误伤。
    // 旧实现用 includes()——如危险词 "ri"（Remove-Item 缩写）会误伤
    // "transcripts"、"dir" 等任何含 "ri" 的正常命令。
    const tokens = lowerCommand.split(/[\s;|&<>]+/).filter(Boolean);

    for (const dangerous of this.dangerousCommands) {
      const d = dangerous.toLowerCase().trim();
      if (!d) continue;
      const matched = d.includes(' ')
        ? lowerCommand.includes(d) // 带参数组合（如 "rm -rf"）整体匹配，组合本身足够具体
        : tokens.includes(d); // 单 token 危险词：按独立 token 精确匹配
      if (matched) {
        return {
          allowed: false,
          reason: `命令包含危险操作: "${dangerous}"`,
          matchedPattern: dangerous,
          suggestion: '请检查命令是否必要，避免执行破坏性操作',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到危险命令',
    };
  }

  /**
   * 检查路径遍历攻击
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkPathTraversal(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();

    for (const pattern of this.pathTraversalPatterns) {
      if (lowerCommand.includes(pattern)) {
        return {
          allowed: false,
          reason: `命令包含路径遍历攻击模式: "${pattern}"`,
          matchedPattern: pattern,
          suggestion: '避免使用".."路径遍历，请使用绝对路径',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到路径遍历攻击',
    };
  }

  /**
   * 检查敏感路径访问
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkSensitivePaths(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();

    for (const path of this.sensitivePaths) {
      if (lowerCommand.includes(path.toLowerCase())) {
        return {
          allowed: false,
          reason: `命令尝试访问敏感路径: "${path}"`,
          matchedPattern: path,
          suggestion: '请避免访问系统敏感路径',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到敏感路径访问',
    };
  }

  /**
   * 检查命令注入攻击
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkCommandInjection(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();

    for (const pattern of this.commandInjectionPatterns) {
      if (lowerCommand.includes(pattern)) {
        return {
          allowed: false,
          reason: `命令包含命令注入模式: "${pattern}"`,
          matchedPattern: pattern,
          suggestion: '避免使用管道、重定向等命令注入技术',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到命令注入攻击',
    };
  }

  /**
   * 检查Unicode零宽字符注入
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkZeroWidthCharacters(command: string): SecurityCheckResult {
    for (const char of this.zeroWidthCharacters) {
      if (command.includes(char)) {
        return {
          allowed: false,
          reason: '命令包含Unicode零宽字符',
          suggestion: '请检查命令中是否存在隐藏字符',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到零宽字符注入',
    };
  }

  /**
   * 检查空字节注入攻击
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkNullByteInjection(command: string): SecurityCheckResult {
    // 检查空字节
    if (command.includes('\x00')) {
      return {
        allowed: false,
        reason: '命令包含空字节注入',
        suggestion: '请检查命令中是否存在空字节攻击',
      };
    }

    // 检查URL编码的空字节
    if (command.includes('%00')) {
      return {
        allowed: false,
        reason: '命令包含URL编码的空字节注入',
        suggestion: '请检查命令中是否存在编码的空字节攻击',
      };
    }

    return {
      allowed: true,
      reason: '未检测到空字节注入',
    };
  }

  /**
   * 检查Zsh equals expansion攻击
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkZshEqualsExpansion(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();

    // 检查=command模式
    const zshPatterns = [
      '=rm',
      '=sh',
      '=bash',
      '=cp',
      '=mv',
      '=cat',
      '=echo',
      '=kill',
      '=sudo',
      '=su',
      '=curl',
      '=wget',
      '=python',
      '=perl',
      '=ruby',
      '=node',
      '=gcc',
      '=make',
      '=docker',
      '=kubectl',
      '=ssh',
      '=scp',
      '=rsync',
      '=git',
      '=npm',
    ];

    for (const pattern of zshPatterns) {
      if (lowerCommand.includes(pattern)) {
        return {
          allowed: false,
          reason: `命令包含Zsh equals expansion攻击模式: "${pattern}"`,
          matchedPattern: pattern,
          suggestion: '避免使用"=command"格式，这可能触发Zsh equals expansion',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到Zsh equals expansion攻击',
    };
  }

  /**
   * 检查环境变量污染
   * @param env 环境变量对象
   * @returns 检查结果
   */
  checkEnvironmentPollution(env: Record<string, string>): SecurityCheckResult {
    const dangerousVars = ['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'IFS'];

    for (const key of dangerousVars) {
      if (key in env) {
        return {
          allowed: false,
          reason: `尝试修改危险环境变量: "${key}"`,
          suggestion: '请避免修改系统关键环境变量',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到危险环境变量修改',
    };
  }

  /**
   * 检查工作目录
   * @param cwd 工作目录
   * @param config 沙箱配置
   * @returns 检查结果
   */
  checkWorkingDirectory(
    cwd: string,
    config: SandboxConfig
  ): SecurityCheckResult {
    // 检查工作目录是否在白名单中
    if (config.filesystemWhitelist.length > 0) {
      const lowerCwd = cwd.toLowerCase();
      let isWhitelisted = false;

      for (const allowedPath of config.filesystemWhitelist) {
        const lowerAllowed = allowedPath.toLowerCase();
        if (
          lowerCwd.startsWith(lowerAllowed) ||
          lowerAllowed.startsWith(lowerCwd)
        ) {
          isWhitelisted = true;
          break;
        }
      }

      if (!isWhitelisted) {
        return {
          allowed: false,
          reason: `工作目录不在白名单中: "${cwd}"`,
          suggestion: '请使用白名单内的工作目录',
        };
      }
    }

    // 检查工作目录是否包含路径遍历
    return this.checkPathTraversal(cwd);
  }
}
