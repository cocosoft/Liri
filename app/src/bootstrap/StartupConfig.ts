/**
 * 启动配置类型定义
 * startup.yaml 配置文件的完整类型体系
 */

/** 启动模式 */
export type StartupMode = 'cli' | 'repl' | 'mcp' | 'daemon';

/** AI 提供商（'' = 从 DB/环境变量自动检测） */
export type StartupAiProvider =
  | ''
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'azure'
  | 'vertex';

/** 插件来源 */
export type PluginSource = 'marketplace' | 'local' | 'npm';

/** 启动配置接口 */
export interface StartupConfig {
  /** 配置文件版本 */
  version: number;
  /** 启动模式 */
  mode: StartupMode;
  /** 调试配置 */
  debug: boolean;
  /** 详细日志 */
  verbose: boolean;
  /** 模块配置 */
  modules?: StartupModulesConfig;
  /** 插件配置 */
  plugins?: StartupPluginsConfig;
  /** 网关通道配置 */
  gateway?: StartupGatewayConfig;
  /** AI 配置 */
  ai?: StartupAiConfig;
  /** 特性开关 */
  features?: StartupFeaturesConfig;
  /** 性能配置 */
  performance?: StartupPerformanceConfig;
  /** 安全配置 */
  security?: StartupSecurityConfig;
}

/** 模块配置 */
export interface StartupModulesConfig {
  /** 启用的模块列表 */
  enabled?: string[];
  /** 禁用的模块列表 */
  disabled?: string[];
}

/** 插件配置 */
export interface StartupPluginsConfig {
  /** 是否自动加载插件 */
  autoLoad?: boolean;
  /** 允许的插件来源 */
  allowedSources?: PluginSource[];
  /** 插件黑名单 */
  blacklist?: string[];
}

/** 网关通道配置 */
export interface StartupGatewayConfig {
  /** 启用的通道列表 */
  enabledChannels?: string[];
  /** 禁用的通道列表 */
  disabledChannels?: string[];
  /** WebSocket 配置 */
  websocket?: {
    enabled: boolean;
    port?: number;
  };
}

/** AI 配置 */
export interface StartupAiConfig {
  /** AI 提供商 */
  provider?: StartupAiProvider;
  /** 模型名称 */
  model?: string;
  /** API 基础地址 */
  baseUrl?: string;
}

/** 特性开关配置 */
export interface StartupFeaturesConfig {
  /** 自动压缩 */
  autoCompact?: boolean;
  /** 遥测 */
  telemetry?: boolean;
  /** 文件检查点 */
  fileCheckpointing?: boolean;
  /** 终端进度条 */
  terminalProgressBar?: boolean;
}

/** 性能配置 */
export interface StartupPerformanceConfig {
  /** 启动超时时间（毫秒） */
  startupTimeoutMs?: number;
  /** 是否启用延迟预加载 */
  deferredPrefetch?: boolean;
}

/** 安全配置 */
export interface StartupSecurityConfig {
  /** 沙箱隔离级别 */
  sandboxIsolation?: 'maximum' | 'standard' | 'minimal' | 'none';
  /** 是否启用 mTLS */
  mtlsEnabled?: boolean;
  /** 权限检查级别 */
  permissionLevel?: 'strict' | 'standard' | 'permissive';
}

/** 默认启动配置 */
export const DEFAULT_STARTUP_CONFIG: StartupConfig = {
  version: 1,
  mode: 'repl',
  debug: false,
  verbose: false,
  modules: {
    enabled: [],
    disabled: [],
  },
  plugins: {
    autoLoad: true,
    allowedSources: ['marketplace', 'local'],
    blacklist: [],
  },
  gateway: {
    enabledChannels: [],
    disabledChannels: [],
    websocket: {
      enabled: true,
    },
  },
  ai: {
    provider: '',   // 空字符串 → 从 DB/环境变量自动检测
    model: '',
  },
  features: {
    autoCompact: true,
    telemetry: true,
    fileCheckpointing: true,
    terminalProgressBar: true,
  },
  performance: {
    startupTimeoutMs: 30000,
    deferredPrefetch: true,
  },
  security: {
    sandboxIsolation: 'standard',
    mtlsEnabled: false,
    permissionLevel: 'standard',
  },
};
