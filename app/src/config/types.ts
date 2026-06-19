// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
  mcpServers?: Record<string, unknown>;
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
 * 通知频道
 */
export type NotificationChannel = 'auto' | 'native' | 'none';

/**
 * 模型路由配置
 */
export interface ModelConfig {
  /** 当前选中的主模型 */
  current?: string;
  /** 任务分工映射 */
  tasks?: Record<string, string>;
  /** 各供应商默认模型 e.g. { ollama: "qwen2.5:7b", deepseek: "deepseek-chat" } */
  defaultModel?: Record<string, string>;
  /** 模型元数据覆盖 */
  overrides?: Record<string, Record<string, unknown>>;
  /** 智能路由配置（启用 SmartRouter 时使用） */
  router?: {
    enabled: boolean;
    judge?: {
      provider: string;
      model: string;
      timeoutMs: number;
    };
    tiers: Record<string, { model: string; providerHint?: string }>;
    defaultTier: 'simple' | 'medium' | 'complex' | 'reasoning';
    sessionSticky?: boolean;
  };
}

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
  provider?:
    | 'anthropic'
    | 'openai'
    | 'deepseek'
    | 'ollama'
    | 'azure'
    | 'vertex';
  /** 默认模型 */
  model?: string;
  /** DeepSeek 配置 */
  deepseek?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  /** Anthropic 配置 */
  anthropic?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  /** OpenAI 配置 */
  openai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  /** Azure 配置 */
  azure?: {
    resourceName?: string;
    apiKey?: string;
    apiVersion?: string;
    baseUrl?: string;
  };
  /** Vertex 配置 */
  vertex?: {
    projectId?: string;
    region?: string;
    credentials?: {
      clientEmail?: string;
      privateKey?: string;
    };
  };
  /** 本地 Ollama 配置 */
  localOllama?: OllamaConfig;
  /** 路由配置 */
  routing?: RoutingConfig;
  /** Token 估算器配置 */
  tokenEstimator?: TokenEstimatorConfig;
  /** Local Agent 配置 */
  localAgent?: LocalAgentConfig;
}

/**
 * Local Agent 配置
 */
export interface LocalAgentConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 路由策略 */
  routing: RoutingConfig;
  /** Ollama 配置 */
  ollama?: OllamaConfig;
  /** 绕过路由（这些路由不经过 LocalAgent 直接执行） */
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
 * 通知配置
 */
export interface NotificationsConfig {
  /** 首选通知渠道 */
  preferredChannel: NotificationChannel;
  /** 消息空闲通知阈值（毫秒） */
  idleThresholdMs: number;
  /** 任务完成通知启用 */
  taskCompleteEnabled: boolean;
  /** 需要输入通知启用 */
  inputNeededEnabled: boolean;
  /** 代理推送通知启用 */
  agentPushEnabled: boolean;
}

/**
 * 功能开关配置
 */
export interface FeatureFlags {
  /** 自动压缩启用 */
  autoCompact: boolean;
  /** 显示回合持续时间 */
  showTurnDuration: boolean;
  /** 文件检查点启用 */
  fileCheckpointing: boolean;
  /** 终端进度条启用 */
  terminalProgressBar: boolean;
  /** 终端标签页显示状态 */
  showStatusInTerminalTab: boolean;
  /** 尊重.gitignore */
  respectGitignore: boolean;
  /** 复制完整响应 */
  copyFullResponse: boolean;
  /** 待办事项功能启用 */
  todoEnabled: boolean;
  /** 显示展开的待办事项 */
  showExpandedTodos: boolean;
}

/**
 * 自动更新配置
 */
export interface AutoUpdateConfig {
  /** 是否启用自动检查更新 */
  enabled: boolean;
  /** 检查间隔（毫秒），默认24小时 */
  checkIntervalMs: number;
  /** 更新通道：stable 或 beta */
  channel: 'stable' | 'beta';
  /** 是否在启动时静默检查 */
  checkOnStartup: boolean;
  /** 是否显示详细日志 */
  verbose: boolean;
}

/**
 * 渠道入站监听配置
 */
export interface ChannelInboundConfig {
  /** 是否启用入站消息监听 */
  enabled: boolean;
}

/**
 * 外部渠道配置（控制网关和渠道入站监听）
 */
export interface ChannelsConfig {
  /** 网关整体开关 */
  gateway: {
    enabled: boolean;
  };
  /** QQ Bot 通道配置 */
  qq: ChannelInboundConfig;
  /** Discord 通道配置 */
  discord: ChannelInboundConfig;
  /** Telegram 通道配置 */
  telegram: ChannelInboundConfig;
  /** 钉钉通道配置 */
  dingtalk: ChannelInboundConfig;
  /** 飞书通道配置 */
  feishu: ChannelInboundConfig;
  /** 微信通道配置 */
  wechat: ChannelInboundConfig;
}

/**
 * 内部运行状态（不直接暴露给用户）
 */
export interface InternalState {
  /** 启动次数 */
  numStartups: number;
  /** 用户ID */
  userID?: string;
  /** 提示历史 */
  tipsHistory: { [tipId: string]: number };
  /** 内存使用计数 */
  memoryUsageCount: number;
  /** 提示队列使用计数 */
  promptQueueUseCount: number;
  /** BTW使用计数 */
  btwUseCount: number;
  /** 首次启动时间 */
  firstStartTime?: string;
  /** 缓存的统计门值 */
  cachedStatsigGates: { [gateName: string]: boolean };
  /** 迁移版本 */
  migrationVersion?: number;
}

// ===== 工作空间信任机制类型 =====

/**
 * 工作空间信任级别
 */
export type WorkspaceTrustLevel = 'chat' | 'work' | 'development';

/**
 * 单个工作空间配置
 */
export interface WorkspaceConfig {
  /** 工作空间路径（绝对路径） */
  path: string;
  /** 信任级别 */
  trustLevel: WorkspaceTrustLevel;
  /** 自定义路径白名单（可选） */
  additionalPaths?: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 备注 */
  label?: string;
}

/** 单个命令规则 */
export interface CommandRule {
  /** 规则字符串（支持 glob/regex） */
  pattern: string;
  /** 类型 */
  type: 'blacklist' | 'whitelist';
  /** 备注 */
  label?: string;
}

/** 目录规则 */
export interface DirectoryRule {
  /** 目录路径 */
  path: string;
  /** 类型 */
  type: 'blacklist' | 'whitelist';
  /** 备注 */
  label?: string;
}

/**
 * 自定义规则配置
 */
export interface CustomRulesConfig {
  /** 命令黑白名单 */
  commandRules?: {
    blacklist: CommandRule[];
    whitelist: CommandRule[];
    mode: 'whitelist' | 'blacklist';
  };
  /** 目录黑白名单 */
  directoryRules?: {
    blacklist: DirectoryRule[];
    whitelist: DirectoryRule[];
  };
}

/**
 * 工作空间权限配置
 */
export interface PermissionConfig {
  /** 信任的工作空间列表 */
  trustedWorkspaces: WorkspaceConfig[];
  /** 默认权限模式 */
  mode: 'default' | 'strict' | 'permissive';
  /** 用户自定义规则 */
  customRules?: CustomRulesConfig;
  /** 全局默认信任级别（chat/work/development），通过 CLI --trust-level 设置 */
  defaultTrustLevel?: string;
}

/**
 * 规则合并工具：用户未配置时使用默认值（零变化），配置了则合并
 */
export function loadRules<T>(defaults: T[], userRules: T[] | undefined): T[] {
  if (!userRules || userRules.length === 0) return defaults;
  return [...defaults, ...userRules];
}

/**
 * 全局配置接口
 */
export interface GlobalConfig {
  /** 配置版本 */
  version: number;

  // ===== 用户可见配置 =====

  /** 主题设置 */
  theme: 'dark' | 'light' | 'system';
  /** 是否已完成引导 */
  hasCompletedOnboarding?: boolean;
  /** 详细模式 */
  verbose: boolean;
  /** 编辑器模式 */
  editorMode?: EditorMode;
  /** 差异工具 */
  diffTool?: DiffTool;
  /** 环境变量 */
  env: { [key: string]: string };
  /** 项目配置 */
  projects?: Record<string, ProjectConfig>;

  /** 权限与工作空间配置 */
  permission?: PermissionConfig;

  /** AI 模块配置 */
  ai?: AIConfig;

  /** 模型路由配置 */
  models?: ModelConfig;

  /** 伙伴配置 */
  companion?: {
    name: string;
    soul: string;
  };
  /** 伙伴是否静音 */
  companionMuted?: boolean;

  // ===== 分组配置 =====

  /** 通知配置 */
  notifications: NotificationsConfig;
  /** 功能开关 */
  features: FeatureFlags;
  /** 自动更新配置 */
  autoUpdate: AutoUpdateConfig;
  /** 外部渠道配置 */
  channels: ChannelsConfig;
  /** 内部运行状态 */
  internal: InternalState;

  // ===== 已废弃（向后兼容，请使用分组字段） =====

  /** @deprecated 使用 notifications.preferredChannel */
  preferredNotifChannel?: NotificationChannel;
  /** @deprecated 使用 notifications.idleThresholdMs */
  messageIdleNotifThresholdMs?: number;
  /** @deprecated 使用 notifications.taskCompleteEnabled */
  taskCompleteNotifEnabled?: boolean;
  /** @deprecated 使用 notifications.inputNeededEnabled */
  inputNeededNotifEnabled?: boolean;
  /** @deprecated 使用 notifications.agentPushEnabled */
  agentPushNotifEnabled?: boolean;
  /** @deprecated 使用 features.autoCompact */
  autoCompactEnabled?: boolean;
  /** @deprecated 使用 features.showTurnDuration */
  showTurnDuration?: boolean;
  /** @deprecated 使用 features.fileCheckpointing */
  fileCheckpointingEnabled?: boolean;
  /** @deprecated 使用 features.terminalProgressBar */
  terminalProgressBarEnabled?: boolean;
  /** @deprecated 使用 features.showStatusInTerminalTab */
  showStatusInTerminalTab?: boolean;
  /** @deprecated 使用 features.respectGitignore */
  respectGitignore?: boolean;
  /** @deprecated 使用 features.copyFullResponse */
  copyFullResponse?: boolean;
  /** @deprecated 使用 features.todoEnabled */
  todoFeatureEnabled?: boolean;
  /** @deprecated 使用 features.showExpandedTodos */
  showExpandedTodos?: boolean;
  /** @deprecated 使用 internal.numStartups */
  numStartups?: number;
  /** @deprecated 使用 internal.userID */
  userID?: string;
  /** @deprecated 使用 internal.tipsHistory */
  tipsHistory?: { [tipId: string]: number };
  /** @deprecated 使用 internal.memoryUsageCount */
  memoryUsageCount?: number;
  /** @deprecated 使用 internal.promptQueueUseCount */
  promptQueueUseCount?: number;
  /** @deprecated 使用 internal.btwUseCount */
  btwUseCount?: number;
  /** @deprecated 使用 internal.firstStartTime */
  firstStartTime?: string;
  /** @deprecated 使用 internal.cachedStatsigGates */
  cachedStatsigGates?: { [gateName: string]: boolean };
  /** @deprecated 使用 internal.migrationVersion */
  migrationVersion?: number;

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
    theme: 'dark',
    verbose: false,
    editorMode: 'normal',
    diffTool: 'auto',
    env: {},
    companionMuted: false,
    notifications: {
      preferredChannel: 'auto',
      idleThresholdMs: 60000,
      taskCompleteEnabled: true,
      inputNeededEnabled: true,
      agentPushEnabled: true,
    },
    features: {
      autoCompact: true,
      showTurnDuration: true,
      fileCheckpointing: true,
      terminalProgressBar: true,
      showStatusInTerminalTab: false,
      respectGitignore: true,
      copyFullResponse: false,
      todoEnabled: true,
      showExpandedTodos: false,
    },
    autoUpdate: {
      enabled: true,
      checkIntervalMs: 86400000,
      channel: 'stable',
      checkOnStartup: true,
      verbose: false,
    },
    channels: {
      gateway: { enabled: false },
      qq: { enabled: false },
      discord: { enabled: false },
      telegram: { enabled: false },
      dingtalk: { enabled: false },
      feishu: { enabled: false },
      wechat: { enabled: false },
    },
    internal: {
      numStartups: 0,
      tipsHistory: {},
      memoryUsageCount: 0,
      promptQueueUseCount: 0,
      btwUseCount: 0,
      cachedStatsigGates: {},
    },
    ai: {
      provider: 'deepseek',
      model: '',
      deepseek: {
        apiKey: process.env['DEEPSEEK_API_KEY'] || '',
        baseUrl: process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com',
        model: '',
      },
      anthropic: {
        apiKey: process.env['ANTHROPIC_API_KEY'] || '',
        baseUrl: 'https://api.anthropic.com',
        model: '',
      },
      openai: {
        apiKey: process.env['OPENAI_API_KEY'] || '',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
      },
      azure: {
        resourceName: '',
        apiKey: '',
        apiVersion: '2024-02-15-preview',
        baseUrl: '',
      },
      vertex: {
        projectId: '',
        region: 'us-central1',
        credentials: {
          clientEmail: '',
          privateKey: '',
        },
      },
      localOllama: {
        enabled: false,
        baseUrl: 'http://localhost:11434',
        defaultModel: '',
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
  'theme',
  'hasCompletedOnboarding',
  'verbose',
  'editorMode',
  'diffTool',
  'env',
  'notifications',
  'features',
  'channels',
  'internal',
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
  hashChecks?: number;
  hashMismatches?: number;
}

/**
 * 用户设置 JSON 结构
 */
export interface SettingsJson {
  theme?: string;
  language?: string;
  fontSize?: number;
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}
