/**
 * AppCore 配置类型定义
 * 从 AppCore.ts 抽取，遵循单类原则
 */

/**
 * Git 工作树创建选项
 */
export interface WorktreeOptions {
  enabled: boolean;
  name?: string;
  prNumber?: number;
  tmuxEnabled?: boolean;
}

/**
 * 会话持久化加载选项
 */
export interface SessionStartupOptions {
  enabled: boolean;
  sessionId?: string;
  storageDir?: string;
}

/**
 * 启动流程增强选项
 */
export interface AppCoreStartupOptions {
  worktree?: WorktreeOptions;
  session?: SessionStartupOptions;
  terminalBackup?: boolean;
}

/**
 * 应用配置
 */
export interface AppCoreConfig {
  name: string;
  version: string;
  debug?: boolean;
  startup?: AppCoreStartupOptions;

  /**
   * 使用旧版模块系统（ModuleDependencyManager）
   * 灰度回退标志：设为 true 则沿用 AppCore 内部的模块管理，跳过 ModuleRegistry 统一路径
   * 对应 CLI 参数 --use-legacy-module-system
   */
  useLegacyModuleSystem?: boolean;
}
