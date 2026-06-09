/**
 * Shell 钩子检测器
 * 检测当前 Shell 环境并验证钩子兼容性
 */

import { configManager } from '@modules/config';
import { execSync } from 'child_process';

/**
 * Shell 类型
 */
export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell' | 'unknown';

/**
 * Shell 钩子能力
 */
export interface ShellCapability {
  shell: ShellType;
  version: string;
  supportsHooks: boolean;
  supportsEnvFile: boolean;
  supportsWatch: boolean;
  maxHookLength: number;
  notes: string[];
}

/**
 * 钩子兼容性检查结果
 */
export interface HookCompatibilityResult {
  compatible: boolean;
  shell: ShellType;
  warnings: string[];
  suggestions: string[];
}

/**
 * Shell 环境信息
 */
export interface ShellEnvironment {
  shell: ShellType;
  version: string;
  isWSL: boolean;
  isGitBash: boolean;
  isCygwin: boolean;
  envFile: string;
}

/**
 * Shell 钩子检测器
 */
export class ShellHookDetector {
  private static readonly SHELL_ENV_VARS: Record<ShellType, string[]> = {
    bash: ['BASH', 'BASH_VERSION'],
    zsh: ['ZSH_VERSION'],
    fish: ['FISH_VERSION'],
    powershell: ['PSModulePath'],
    unknown: [],
  };

  private static readonly HOOK_EVENTS = [
    'CwdChanged',
    'FileChanged',
    'SubagentStart',
    'Notification',
  ];

  /**
   * 检测当前 Shell 环境
   * @returns Shell 环境信息
   */
  detectShell(): ShellEnvironment {
    const shell = this.detectShellType();
    const version = this.detectVersion(shell);
    const isWSL = this.checkWSL();
    const isGitBash = this.checkGitBash();
    const isCygwin = this.checkCygwin();
    const envFile = this.getEnvFilePath(shell);

    return { shell, version, isWSL, isGitBash, isCygwin, envFile };
  }

  /**
   * 获取 Shell 钩子能力
   * @param shell Shell 类型（可选，默认自动检测）
   * @returns Shell 钩子能力信息
   */
  getCapabilities(shell?: ShellType): ShellCapability {
    const detected = shell || this.detectShellType();

    switch (detected) {
      case 'fish':
        return {
          shell: 'fish',
          version: this.detectVersion('fish'),
          supportsHooks: true,
          supportsEnvFile: true,
          supportsWatch: true,
          maxHookLength: 4096,
          notes: [
            'Fish 原生支持事件驱动的钩子系统',
            '使用 --on-event 触发器注册钩子',
            '支持环境文件自动加载',
          ],
        };

      case 'zsh':
        return {
          shell: 'zsh',
          version: this.detectVersion('zsh'),
          supportsHooks: true,
          supportsEnvFile: true,
          supportsWatch: true,
          maxHookLength: 4096,
          notes: [
            'Zsh 通过 chpwd/precmd/preexec 钩子支持',
            '需要加载 zsh/parameter 模块',
            '支持 watch 文件变化检测',
          ],
        };

      case 'bash':
        return {
          shell: 'bash',
          version: this.detectVersion('bash'),
          supportsHooks: true,
          supportsEnvFile: true,
          supportsWatch: false,
          maxHookLength: 2048,
          notes: [
            'Bash 通过 PROMPT_COMMAND 模拟钩子',
            '不支持原生 watch 文件变化',
            '需要 trap DEBUG 实现命令前钩子',
          ],
        };

      case 'powershell':
        return {
          shell: 'powershell',
          version: this.detectVersion('powershell'),
          supportsHooks: true,
          supportsEnvFile: true,
          supportsWatch: true,
          maxHookLength: 8192,
          notes: [
            'PowerShell 通过 Register-EngineEvent 支持',
            '支持 FileSystemWatcher 实现文件监控',
            '环境文件需要 .ps1 格式',
          ],
        };

      default:
        return {
          shell: 'unknown',
          version: '',
          supportsHooks: false,
          supportsEnvFile: false,
          supportsWatch: false,
          maxHookLength: 0,
          notes: ['无法识别的 Shell 环境', '钩子功能可能不可用'],
        };
    }
  }

  /**
   * 检查钩子兼容性
   * @param hookName 钩子名称
   * @returns 兼容性检查结果
   */
  checkHookCompatibility(hookName: string): HookCompatibilityResult {
    const shell = this.detectShellType();
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!ShellHookDetector.HOOK_EVENTS.includes(hookName)) {
      warnings.push(`未知的钩子事件: ${hookName}`);
      suggestions.push(`可用钩子: ${ShellHookDetector.HOOK_EVENTS.join(', ')}`);
    }

    switch (hookName) {
      case 'CwdChanged':
        if (shell === 'bash') {
          warnings.push('Bash 不支持原生目录变更钩子');
          suggestions.push('考虑使用 PROMPT_COMMAND 模拟或切换到 Zsh/Fish');
        }
        break;

      case 'FileChanged':
        if (shell === 'bash') {
          warnings.push('Bash 不支持原生文件变更监听');
          suggestions.push('考虑使用轮询机制或切换到 Zsh/Fish');
        }
        break;

      case 'SubagentStart':
        if (shell === 'fish') {
          suggestions.push('Fish 可使用 --on-event 注册子代理启动钩子');
        }
        break;

      case 'Notification':
        suggestions.push(`${shell} 可通过 eval 集成通知钩子`);
        break;
    }

    return {
      compatible: warnings.length === 0,
      shell,
      warnings,
      suggestions,
    };
  }

  /**
   * 验证当前环境是否满足钩子要求
   * @param requiredHooks 必需的钩子列表
   * @returns 包含兼容性结果和缺失能力的映射
   */
  validateEnvironment(requiredHooks: string[]): {
    passed: boolean;
    results: Record<string, HookCompatibilityResult>;
    missing: string[];
  } {
    const results: Record<string, HookCompatibilityResult> = {};
    const missing: string[] = [];

    for (const hook of requiredHooks) {
      const result = this.checkHookCompatibility(hook);
      results[hook] = result;

      if (!result.compatible) {
        missing.push(hook);
      }
    }

    return {
      passed: missing.length === 0,
      results,
      missing,
    };
  }

  /**
   * 检测 Shell 类型
   * @returns 检测到的 Shell 类型
   */
  private detectShellType(): ShellType {
    const shellEnv = configManager.env('SHELL') || '';

    if (shellEnv.includes('fish')) return 'fish';
    if (shellEnv.includes('zsh')) return 'zsh';
    if (shellEnv.includes('bash')) return 'bash';

    if (process.platform === 'win32') {
      const psEnv = configManager.env('PSModulePath') || '';

      if (psEnv) return 'powershell';
    }

    try {
      const parentProcess = this.getParentProcessName().toLowerCase();

      if (parentProcess.includes('fish')) return 'fish';
      if (parentProcess.includes('zsh')) return 'zsh';
      if (parentProcess.includes('bash')) return 'bash';
      if (
        parentProcess.includes('powershell') ||
        parentProcess.includes('pwsh')
      ) {
        return 'powershell';
      }
    } catch {
      return 'unknown';
    }

    return 'unknown';
  }

  /**
   * 检测 Shell 版本
   * @param shell Shell 类型
   * @returns 版本字符串
   */
  private detectVersion(shell: ShellType): string {
    const versionVar = ShellHookDetector.SHELL_ENV_VARS[shell][1];
    const version = versionVar ? process.env[versionVar] || '' : '';

    if (version) return version;

    try {
      const cmdMap: Record<ShellType, string> = {
        bash: 'bash --version',
        zsh: 'zsh --version',
        fish: 'fish --version',
        powershell: 'powershell -Command "$PSVersionTable.PSVersion"',
        unknown: '',
      };

      const cmd = cmdMap[shell];
      if (cmd) {
        const output = execSync(cmd, { timeout: 3000, encoding: 'utf-8' });

        return output.split('\n')[0].trim();
      }
    } catch {
      return 'unknown';
    }

    return 'unknown';
  }

  /**
   * 获取父进程名称
   * @returns 父进程名称
   */
  private getParentProcessName(): string {
    if (process.platform === 'win32') {
      try {
        const pid = process.ppid;
        const output = execSync(
          `wmic process where "processid=${pid}" get name`,
          { timeout: 2000, encoding: 'utf-8' }
        );

        return output.split('\n')[1]?.trim() || '';
      } catch {
        return '';
      }
    }

    try {
      const output = execSync(`ps -p ${process.ppid} -o comm=`, {
        timeout: 2000,
        encoding: 'utf-8',
      });

      return output.trim();
    } catch {
      return '';
    }
  }

  /**
   * 检查是否在 WSL 中运行
   * @returns 是否 WSL
   */
  private checkWSL(): boolean {
    try {
      if (process.platform === 'linux') {
        const output = execSync('uname -r', {
          timeout: 1000,
          encoding: 'utf-8',
        });

        return (
          output.toLowerCase().includes('microsoft') ||
          output.toLowerCase().includes('wsl')
        );
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * 检查是否在 Git Bash 中运行
   * @returns 是否 Git Bash
   */
  private checkGitBash(): boolean {
    const path = configManager.env('PATH') || '';
    const shell = configManager.env('SHELL') || '';

    return (
      path.includes('Git') ||
      path.includes('git') ||
      shell.includes('git-bash') ||
      shell.includes('Git')
    );
  }

  /**
   * 检查是否在 Cygwin 中运行
   * @returns 是否 Cygwin
   */
  private checkCygwin(): boolean {
    const path = configManager.env('PATH') || '';

    return path.includes('/cygdrive/') || path.includes('cygwin');
  }

  /**
   * 获取环境文件路径
   * @param shell Shell 类型
   * @returns 环境文件路径
   */
  private getEnvFilePath(shell: ShellType): string {
    const home = configManager.env('HOME') || configManager.env('USERPROFILE') || '';

    switch (shell) {
      case 'bash':
        return `${home}/.bashrc`;
      case 'zsh':
        return `${home}/.zshrc`;
      case 'fish':
        return `${home}/.config/fish/config.fish`;
      case 'powershell':
        return `${home}/Documents/PowerShell/Microsoft.PowerShell_profile.ps1`;
      default:
        return '';
    }
  }
}

/** 全局 Shell 钩子检测器实例 */
export const shellHookDetector = new ShellHookDetector();
