/**
 * 沙箱集成
 * 用于安全地执行命令
 */

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /**
   * 是否启用沙箱
   */
  enabled: boolean;
  /**
   * 是否自动允许沙箱中的命令
   */
  autoAllowIfSandboxed: boolean;
  /**
   * 沙箱工作目录
   */
  workingDirectory?: string;
  /**
   * 允许的命令列表
   */
  allowedCommands?: string[];
  /**
   * 禁止的命令列表
   */
  forbiddenCommands?: string[];
}

/**
 * 沙箱决策结果
 */
export interface SandboxDecision {
  /**
   * 是否应该使用沙箱
   */
  shouldUseSandbox: boolean;
  /**
   * 是否自动允许
   */
  autoAllow: boolean;
  /**
   * 原因
   */
  reason?: string;
}

/**
 * 沙箱接口
 */
export interface ISandboxManager {
  /**
   * 检查沙箱是否启用
   * @returns 是否启用
   */
  isSandboxingEnabled(): boolean;

  /**
   * 检查是否应该自动允许沙箱中的命令
   * @returns 是否自动允许
   */
  isAutoAllowBashIfSandboxedEnabled(): boolean;

  /**
   * 判断是否应该使用沙箱
   * @param input 命令输入
   * @returns 是否使用沙箱
   */
  shouldUseSandbox(input: Record<string, unknown>): boolean;

  /**
   * 获取沙箱决策
   * @param input 命令输入
   * @returns 沙箱决策
   */
  getSandboxDecision(input: Record<string, unknown>): SandboxDecision;

  /**
   * 检查命令是否安全
   * @param command 命令
   * @returns 是否安全
   */
  isCommandSafe(command: string): boolean;
}

/**
 * 默认沙箱配置
 */
const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  autoAllowIfSandboxed: false, // 安全修复：沙箱内不再自动放行，走完整权限检查
  allowedCommands: [
    'ls',
    'dir',
    'pwd',
    'echo',
    'cat',
    'grep',
    'find',
    'head',
    'tail',
    'wc',
    'sort',
    'uniq',
    'cut',
    'sed',
    'awk',
  ],
  forbiddenCommands: [
    'rm -rf',
    'rm -fr',
    'mkfs',
    'format',
    'dd if=',
    'chmod 777',
    ':(){ :|:& };:',
  ],
};

/**
 * 沙箱管理器实现
 */
export class PermissionSandboxManager implements ISandboxManager {
  /**
   * 配置
   */
  private config: SandboxConfig;

  /**
   * 构造函数
   * @param config 沙箱配置
   */
  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * 检查沙箱是否启用
   * @returns 是否启用
   */
  isSandboxingEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 检查是否应该自动允许沙箱中的命令
   * @returns 是否自动允许
   */
  isAutoAllowBashIfSandboxedEnabled(): boolean {
    return this.config.autoAllowIfSandboxed;
  }

  /**
   * 判断是否应该使用沙箱
   * @param input 命令输入
   * @returns 是否使用沙箱
   */
  shouldUseSandbox(input: Record<string, unknown>): boolean {
    if (!this.isSandboxingEnabled()) {
      return false;
    }

    const command = this.extractCommand(input);
    if (!command) {
      return false;
    }

    // 如果命令是安全的，可能不需要沙箱
    if (this.isCommandSafe(command)) {
      return false;
    }

    // 对于其他命令，使用沙箱
    return true;
  }

  /**
   * 获取沙箱决策
   * @param input 命令输入
   * @returns 沙箱决策
   */
  getSandboxDecision(input: Record<string, unknown>): SandboxDecision {
    const shouldUseSandbox = this.shouldUseSandbox(input);

    if (shouldUseSandbox) {
      const autoAllow = this.isAutoAllowBashIfSandboxedEnabled();
      return {
        shouldUseSandbox: true,
        autoAllow,
        reason: autoAllow
          ? 'Command will be executed in sandbox and auto-allowed'
          : 'Command will be executed in sandbox',
      };
    }

    return {
      shouldUseSandbox: false,
      autoAllow: false,
      reason: 'Sandbox not needed for this command',
    };
  }

  /**
   * 检查命令是否安全
   * @param command 命令
   * @returns 是否安全
   */
  isCommandSafe(command: string): boolean {
    const lowerCommand = command.toLowerCase();

    // 检查是否在禁止列表中
    if (this.config.forbiddenCommands) {
      for (const forbidden of this.config.forbiddenCommands) {
        if (lowerCommand.includes(forbidden.toLowerCase())) {
          return false;
        }
      }
    }

    // 检查是否在允许列表中
    if (this.config.allowedCommands) {
      const baseCommand = lowerCommand.split(' ')[0];
      return this.config.allowedCommands.includes(baseCommand);
    }

    // 默认认为不安全
    return false;
  }

  /**
   * 从输入中提取命令
   * @param input 输入
   * @returns 命令
   */
  private extractCommand(input: Record<string, unknown>): string | null {
    // 尝试常见的命令字段
    const possibleFields = ['command', 'cmd', 'script', 'code', 'text'];

    for (const field of possibleFields) {
      if (input[field] && typeof input[field] === 'string') {
        return input[field];
      }
    }

    // 尝试将整个输入字符串化
    try {
      return JSON.stringify(input);
    } catch {
      // @ignore-catch: 循环引用等极端输入下视为无命令
      return null;
    }
  }

  /**
   * 更新配置
   * @param config 新配置
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   * @returns 当前配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

/**
 * 沙箱集成服务
 */
export class SandboxIntegrationService {
  /**
   * 沙箱管理器
   */
  private sandboxManager: ISandboxManager;

  /**
   * 构造函数
   * @param sandboxManager 沙箱管理器
   */
  constructor(sandboxManager?: ISandboxManager) {
    this.sandboxManager = sandboxManager || new PermissionSandboxManager();
  }

  /**
   * 获取沙箱管理器
   * @returns 沙箱管理器
   */
  getSandboxManager(): ISandboxManager {
    return this.sandboxManager;
  }

  /**
   * 检查工具是否应该在沙箱中执行
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 沙箱决策
   */
  checkSandboxRequirement(
    toolName: string,
    input: Record<string, unknown>
  ): SandboxDecision {
    // 只对特定工具使用沙箱
    const sandboxTools = ['bash', 'shell', 'exec', 'run', 'powershell'];
    const lowerToolName = toolName.toLowerCase();

    if (!sandboxTools.some((t) => lowerToolName.includes(t))) {
      return {
        shouldUseSandbox: false,
        autoAllow: false,
        reason: 'Tool does not require sandbox',
      };
    }

    return this.sandboxManager.getSandboxDecision(input);
  }

  /**
   * 检查是否可以自动允许沙箱中的命令
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 是否可以自动允许
   */
  canAutoAllowInSandbox(
    toolName: string,
    input: Record<string, unknown>
  ): boolean {
    const decision = this.checkSandboxRequirement(toolName, input);
    return decision.shouldUseSandbox && decision.autoAllow;
  }
}

// 导出单例
export const sandboxManager = new PermissionSandboxManager();
export const sandboxIntegrationService = new SandboxIntegrationService(
  sandboxManager
);
