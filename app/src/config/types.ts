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

// T-②05（2026-10-03）：快速路径判据的**类型与默认值**下沉 core（`types/`）单一事实源
// —— `config`(infra) 与 `tasks`(app) 同时引用，落任一侧都会造成反向依赖。
import {
  DEFAULT_DANGEROUS_INTENT_PATTERNS,
  DEFAULT_FAST_PATH_MAX_LENGTH,
  type FastPathConfig,
} from '@modules/types/fastPath';

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
    fallback?: Array<{ provider: string; model: string }>;
    zeroUsageRetry?: { enabled: boolean; maxAttempts: number };
    transientRetry?: {
      enabled: boolean;
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
    };
    stats?: { enabled: boolean };
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
  /** AI 提供商（空字符串 = 从 DB/环境变量自动检测） */
  provider?:
    | ''
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
  /** Token 估算器配置 */
  tokenEstimator?: TokenEstimatorConfig;
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
 * 分阶段文档工作流配置（设计方案 §6 M3）
 *
 * 与 negotiation 独立——docWorkflow 控制文档生成流水线行为，
 * negotiation 控制协商式执行引擎的门控强度。
 */
export interface DocWorkflowConfig {
  /** 是否启用分阶段文档生成（false = 一次性生成） */
  staged: boolean;
  /** 默认输出格式 */
  defaultFormat: 'docx' | 'pptx' | 'html' | 'pdf';
  /** 图片生成并发度 */
  imageConcurrency: number;
  /** 大纲确认超时（毫秒，0 = 不超时） */
  outlineConfirmTimeoutMs: number;
  /** 图片生成失败时是否降级为占位符（true）还是中止（false） */
  degradeOnImageFailure: boolean;
}

/**
 * 协商式执行引擎配置（设计方案 §6 M3）
 *
 * 与 docWorkflow 独立——negotiation 控制全局门控强度，
 * docWorkflow 控制文档流水线行为。
 */
export interface NegotiationConfig {
  /** 是否启用协商式执行（false = 自动执行不拦截） */
  enabled: boolean;
  /** 门控强度：strict（全拦截）/ moderate（仅外部操作+异常）/ relaxed（仅外部操作） */
  tier: 'strict' | 'moderate' | 'relaxed';
  /** 用户响应超时（毫秒，默认 5 分钟） */
  responseTimeoutMs: number;
  /** 超时后是否自动降级（true = 取默认答案继续，false = 中止） */
  autoDegradeOnTimeout: boolean;
}

/**
 * AI-VFS 用户可配置挂载点条目（`.trae/specs/ai-vfs-user-mountable.md`）。
 *
 * ⚠️ `config`（infra 层）在此只定义**纯类型** —— ❌ 禁止 `config` import `app/src/vfs`
 * （否则 infra → app 倒挂）；运行时装配在 `entrypoints/vfsWiring.ts`。
 */
export interface VfsMountConfigEntry {
  /** 挂载 scheme（当前仅支持 'dev_docs' | 'mcp'） */
  scheme: 'dev_docs' | 'mcp';
  /** 仅 `mcp` 用：MCP 服务器名 */
  server?: string;
  /** 缺省视为 true */
  enabled?: boolean;
}

/**
 * AI-VFS 用户可配置挂载面（`~/.pyapp/config.json` 的 `vfs` 段）。
 *
 * 缺省（无 `vfs` 段，或 `mounts` 缺省）⇒ 内置默认：`dev_docs` + `mcp`（保持只读试点行为）。
 */
export interface VfsConfig {
  /** 用户挂载点清单（"挂载点即用户面契约"） */
  mounts?: VfsMountConfigEntry[];
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
  /** 分阶段文档工作流配置（设计方案 §6 M3） */
  docWorkflow: DocWorkflowConfig;
  /** 协商式执行引擎配置（设计方案 §6 M3） */
  negotiation: NegotiationConfig;
  /**
   * 快速路径（PlanDrivenLoop 分流）判据配置（T-②05）
   *
   * 覆盖原硬编码的 `SIMPLE_TASK_MAX_LENGTH` 与「危险意图」正则清单；
   * 默认值见 `@modules/types/fastPath`（单一事实源）。**留空/非法 ⇒ 回退默认**（fail-closed）。
   */
  fastPath: FastPathConfig;

  /**
   * AI-VFS 用户可配置挂载面（`.trae/specs/ai-vfs-user-mountable.md`）。
   *
   * 缺省（无 `vfs` 段）⇒ 内置默认：`dev_docs` 启用、`mcp` 不限 server（保持只读试点行为）；
   * 显式配置 `vfs.mounts` ⇒ **严格按清单**（未知 scheme / 缺失必填 ⇒ 跳过 + WARN，不回退）。
   */
  vfs?: VfsConfig;

  // ===== 旧扁平字段（已删声明）=====
  // 2026-10-06（P2-8 ② 配置字段迁移收尾）：原 23 个 `@deprecated` 扁平字段
  // （preferredNotifChannel / messageIdleNotifThresholdMs / … / migrationVersion）的
  // **类型声明已删除** —— 它们已由 `ConfigMigration.migrateToV2` 折入
  // `notifications` / `features` / `internal`，且生产代码**零读取**（唯一读取点
  // `companion.ts` 已改读 `internal.userID`）。旧配置文件仍由迁移器兼容处理
  // （其读取走 `any` + 字符串键，不依赖此声明）。
  // ⚠️ 形如 `migrationVersion` 的**顶层**字段由 `ConfigMigration` 直接读写，属**在用**字段，
  //    仅其「扁平业务字段」身份被取消 ⇒ 见索引签名兜底。

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
    docWorkflow: {
      staged: true,
      defaultFormat: 'docx',
      imageConcurrency: 3,
      outlineConfirmTimeoutMs: 0,
      degradeOnImageFailure: true,
    },
    negotiation: {
      enabled: true,
      tier: 'moderate',
      responseTimeoutMs: 5 * 60 * 1000,
      autoDegradeOnTimeout: true,
    },
    // T-②05：快速路径判据（默认值来自 core 单一事实源；展开拷贝避免共享只读数组）
    fastPath: {
      maxSimpleTaskLength: DEFAULT_FAST_PATH_MAX_LENGTH,
      dangerousIntentPatterns: [...DEFAULT_DANGEROUS_INTENT_PATTERNS],
    },
    ai: {
      provider: '', // 空字符串 → 从 DB/环境变量自动检测
      model: '',
      deepseek: {
        apiKey: process.env['DEEPSEEK_API_KEY'] || '',
        baseUrl: process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com',
        model: '',
      },
      anthropic: {
        apiKey: process.env['ANTHROPIC_API_KEY'] || '',
        baseUrl: process.env['ANTHROPIC_BASE_URL'] || '',
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
  default?: unknown;
  validate?: (value: unknown) => boolean;
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
  [key: string]: any;
}
