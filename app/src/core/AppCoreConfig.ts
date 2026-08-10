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
   * 启动模式（对应 CLI 的 mode 参数）
   * 传递给 DIContainer.bootstrap() 使用
   */
  mode?: 'repl' | 'daemon' | 'oneshot';
}
