/**
 * 配置系统类型定义
 * 提供全局配置和项目级配置的完整类型支持
 */

/**
 * 项目配置接口
 */
export interface ProjectConfig {
  /** 允许的工具列表 */
  allowedTools: string[];
  /** MCP上下文URI列表 */
  mcpContextUris: string[];
  /** MCP服务器配置 */
  mcpServers?: Record<string, any>;
  /** 是否已接受信任对话框 */
  hasTrustDialogAccepted?: boolean;
  /** 是否已完成项目引导 */
  hasCompletedProjectOnboarding?: boolean;
  /** 项目引导显示次数 */
  projectOnboardingSeenCount: number;
  /** 最后会话ID */
  lastSessionId?: string;
  /** 自定义配置项 */
  [key: string]: any;
}

/**
 * 默认项目配置
 */
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  hasTrustDialogAccepted: false,
  projectOnboardingSeenCount: 0,
};

/**
 * 通知渠道类型
 */
export type NotificationChannel = 'auto' | 'native' | 'none';

/**
 * 编辑器模式
 */
export type EditorMode = 'normal' | 'vim' | 'emacs';

/**
 * 差异工具
 */
export type DiffTool = 'terminal' | 'auto';

/**
 * AI 模块配置
 */
export interface AIConfig {
  /** AI 提供商 */
  provider?: 'anthropic' | 'openai' | 'deepseek' | 'ollama';
  /** 默认模型 */
  model?: string;
  /** 本地 Ollama 配置 */
  localOllama?: OllamaConfig;
  /** 路由配置 */
  routing?: RoutingConfig;
  /** Token 估算器配置 */
  tokenEstimator?: TokenEstimatorConfig;
  /** Mini Agent 配置 */
  miniAgent?: MiniAgentConfig;
}

/**
 * Mini Agent 配置
 */
export interface MiniAgentConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 路由策略 */
  routing: RoutingConfig;
  /** Ollama 配置 */
  ollama?: OllamaConfig;
  /** 绕过路由（这些路由不经过 MiniAgent 直接执行） */
  bypassRoutes?: string[];
  /** 是否启用性能指标 */
  enableMetrics?: boolean;
  /** Skill 提供者配置 */
  skillProvider?: {
    enabled: boolean;
  };
  /** MCP 提供者配置 */
  mcpProvider?: {
    enabled: boolean;
  };
}

/**
 * Ollama 配置
 */
export interface OllamaConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 服务地址 */
  baseUrl: string;
  /** 默认模型 */
  defaultModel: string;
  /** 超时时间（毫秒） */
  timeout: number;
}

/**
 * 路由配置
 */
export interface RoutingConfig {
  /** 路由策略 */
  strategy: 'cloud-first' | 'ollama-first' | 'local-first';
  /** 是否降级到 Cloud */
  fallbackToCloud: boolean;
}

/**
 * Token 估算器配置
 */
export interface TokenEstimatorConfig {
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 全局配置接口
 */
export interface GlobalConfig {
  /** 配置版本 */
  version: number;
  /** 启动次数 */
  numStartups: number;
  /** 用户ID */
  userID?: string;
  /** 主题设置 */
  theme: 'dark' | 'light' | 'system';
  /** 是否已完成引导 */
  hasCompletedOnboarding?: boolean;
  /** 详细模式 */
  verbose: boolean;
  /** 编辑器模式 */
  editorMode?: EditorMode;
  /** 首选通知渠道 */
  preferredNotifChannel: NotificationChannel;
  /** 差异工具 */
  diffTool?: DiffTool;
  /** 环境变量 */
  env: { [key: string]: string };
  /** 项目配置 */
  projects?: Record<string, ProjectConfig>;
  /** 自动压缩启用 */
  autoCompactEnabled: boolean;
  /** 显示回合持续时间 */
  showTurnDuration: boolean;
  /** 消息空闲通知阈值（毫秒） */
  messageIdleNotifThresholdMs: number;
  /** 文件检查点启用 */
  fileCheckpointingEnabled: boolean;
  /** 终端进度条启用 */
  terminalProgressBarEnabled: boolean;
  /** 终端标签页显示状态 */
  showStatusInTerminalTab?: boolean;
  /** 任务完成通知启用 */
  taskCompleteNotifEnabled?: boolean;
  /** 需要输入通知启用 */
  inputNeededNotifEnabled?: boolean;
  /** 代理推送通知启用 */
  agentPushNotifEnabled?: boolean;
  /** 尊重.gitignore */
  respectGitignore: boolean;
  /** 复制完整响应 */
  copyFullResponse: boolean;
  /** 提示历史 */
  tipsHistory: { [tipId: string]: number };
  /** 内存使用计数 */
  memoryUsageCount: number;
  /** 提示队列使用计数 */
  promptQueueUseCount: number;
  /** BTW使用计数 */
  btwUseCount: number;
  /** 待办事项功能启用 */
  todoFeatureEnabled: boolean;
  /** 显示展开的待办事项 */
  showExpandedTodos?: boolean;
  /** 首次启动时间 */
  firstStartTime?: string;
  /** 缓存的统计门值 */
  cachedStatsigGates: { [gateName: string]: boolean };
  /** 迁移版本 */
  migrationVersion?: number;
  /** AI 模块配置 */
  ai?: AIConfig;
  /** 自定义配置项 */
  [key: string]: any;
}

/**
 * 创建默认全局配置的工厂函数
 * @returns 新的默认全局配置
 */
export function createDefaultGlobalConfig(): GlobalConfig {
  return {
    version: 1,
    numStartups: 0,
    theme: 'dark',
    preferredNotifChannel: 'auto',
    verbose: false,
    editorMode: 'normal',
    diffTool: 'auto',
    env: {},
    tipsHistory: {},
    memoryUsageCount: 0,
    promptQueueUseCount: 0,
    btwUseCount: 0,
    todoFeatureEnabled: true,
    showExpandedTodos: false,
    messageIdleNotifThresholdMs: 60000,
    autoCompactEnabled: true,
    showTurnDuration: true,
    fileCheckpointingEnabled: true,
    terminalProgressBarEnabled: true,
    respectGitignore: true,
    copyFullResponse: false,
    cachedStatsigGates: {},
    ai: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      localOllama: {
        enabled: false,
        baseUrl: 'http://localhost:11434',
        defaultModel: 'qwen3:1.8b',
        timeout: 30000,
      },
      routing: {
        strategy: 'cloud-first',
        fallbackToCloud: true,
      },
      tokenEstimator: {
        enabled: false,
      },
    },
  };
}

/**
 * 全局配置键列表
 */
export const GLOBAL_CONFIG_KEYS = [
  'version',
  'numStartups',
  'userID',
  'theme',
  'hasCompletedOnboarding',
  'verbose',
  'editorMode',
  'preferredNotifChannel',
  'diffTool',
  'env',
  'autoCompactEnabled',
  'showTurnDuration',
  'todoFeatureEnabled',
  'showExpandedTodos',
  'messageIdleNotifThresholdMs',
  'fileCheckpointingEnabled',
  'terminalProgressBarEnabled',
  'showStatusInTerminalTab',
  'taskCompleteNotifEnabled',
  'inputNeededNotifEnabled',
  'agentPushNotifEnabled',
  'respectGitignore',
  'copyFullResponse',
  'firstStartTime',
] as const;

/**
 * 全局配置键类型
 */
export type GlobalConfigKey = (typeof GLOBAL_CONFIG_KEYS)[number];

/**
 * 项目配置键列表
 */
export const PROJECT_CONFIG_KEYS = [
  'allowedTools',
  'hasTrustDialogAccepted',
  'hasCompletedProjectOnboarding',
  'projectOnboardingSeenCount',
] as const;

/**
 * 项目配置键类型
 */
export type ProjectConfigKey = (typeof PROJECT_CONFIG_KEYS)[number];

/**
 * 配置验证规则
 */
export interface ConfigValidationRule {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: any;
  validate?: (value: any) => boolean;
  message?: string;
}

/**
 * 配置来源枚举
 */
export enum ConfigSource {
  DEFAULT = 'default',
  ENV = 'env',
  FILE = 'file',
  RUNTIME = 'runtime',
}

/**
 * 配置统计信息
 */
export interface ConfigStats {
  readCount: number;
  writeCount: number;
  cacheHits: number;
  cacheMisses: number;
  lastReadTime?: number;
  lastWriteTime?: number;
}
