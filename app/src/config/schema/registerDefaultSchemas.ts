/**
 * registerDefaultSchemas 注册默认配置 Schema
 * 将 GlobalConfig 中所有配置项注册到 configSchema，用于文档生成和校验
 */
import { configSchema } from './ConfigSchema.js';

/**
 * 注册所有默认配置项到 configSchema
 */
export function registerDefaultSchemas(): void {
  registerGeneralSettings();
  registerThemeSettings();
  registerAiSettings();
  registerNotificationSettings();
  registerFeatureFlags();
  registerAutoUpdateSettings();
  registerChannelSettings();
}

function registerGeneralSettings(): void {
  configSchema.registerItem('通用设置', {
    key: 'version',
    description: '配置文件版本号，用于迁移兼容',
    type: 'number',
    defaultValue: 1,
    required: true,
    example: 1,
  });

  configSchema.registerItem('通用设置', {
    key: 'verbose',
    description: '详细模式开关，开启后输出更多调试信息',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通用设置', {
    key: 'editorMode',
    description: '编辑器模式，控制编辑体验',
    type: 'string',
    defaultValue: 'normal',
    enum: ['normal', 'vim', 'emacs'],
    example: 'vim',
  });

  configSchema.registerItem('通用设置', {
    key: 'diffTool',
    description: '差异对比工具',
    type: 'string',
    defaultValue: 'auto',
    enum: ['auto', 'diff', 'git-diff'],
    example: 'git-diff',
  });

  configSchema.registerItem('通用设置', {
    key: 'hasCompletedOnboarding',
    description: '是否已完成首次引导',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}

function registerThemeSettings(): void {
  configSchema.registerItem('主题设置', {
    key: 'theme',
    description: '应用主题',
    type: 'string',
    defaultValue: 'dark',
    enum: ['dark', 'light', 'system'],
    example: 'system',
  });

  configSchema.registerItem('主题设置', {
    key: 'companion.name',
    description: '伙伴名称',
    type: 'string',
    defaultValue: 'PY',
    example: 'PY',
  });

  configSchema.registerItem('主题设置', {
    key: 'companion.soul',
    description: '伙伴个性设定',
    type: 'string',
    defaultValue: '',
    example: '你是一个友好的 AI 助手',
  });

  configSchema.registerItem('主题设置', {
    key: 'companionMuted',
    description: '是否静音伙伴消息',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}

function registerAiSettings(): void {
  configSchema.registerItem('AI 设置', {
    key: 'ai.provider',
    description: 'AI 提供商',
    type: 'string',
    defaultValue: 'deepseek',
    enum: ['anthropic', 'openai', 'deepseek', 'ollama', 'azure', 'vertex'],
    example: 'deepseek',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.model',
    description: '默认使用的 AI 模型名称',
    type: 'string',
    defaultValue: 'deepseek-chat',
    example: 'claude-3-5-sonnet-20241022',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.deepseek.apiKey',
    description: 'DeepSeek API 密钥',
    type: 'string',
    defaultValue: '',
    pattern: '^sk-',
    example: 'sk-your-key-here',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.deepseek.baseUrl',
    description: 'DeepSeek API 地址',
    type: 'string',
    defaultValue: 'https://api.deepseek.com',
    example: 'https://api.deepseek.com',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.deepseek.model',
    description: 'DeepSeek 使用的模型',
    type: 'string',
    defaultValue: 'deepseek-chat',
    example: 'deepseek-coder',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.anthropic.apiKey',
    description: 'Anthropic API 密钥',
    type: 'string',
    defaultValue: '',
    pattern: '^sk-ant-',
    example: 'sk-ant-your-key-here',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.anthropic.baseUrl',
    description: 'Anthropic API 地址',
    type: 'string',
    defaultValue: 'https://api.anthropic.com',
    example: 'https://api.anthropic.com',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.anthropic.model',
    description: 'Anthropic 使用的模型',
    type: 'string',
    defaultValue: 'claude-3-5-sonnet-20241022',
    example: 'claude-opus-4-20250514',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.openai.apiKey',
    description: 'OpenAI API 密钥',
    type: 'string',
    defaultValue: '',
    pattern: '^sk-',
    example: 'sk-your-key-here',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.openai.baseUrl',
    description: 'OpenAI API 地址',
    type: 'string',
    defaultValue: 'https://api.openai.com/v1',
    example: 'https://api.openai.com/v1',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.openai.model',
    description: 'OpenAI 使用的模型',
    type: 'string',
    defaultValue: 'gpt-4o',
    example: 'gpt-4o-mini',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.routing.strategy',
    description: 'AI 路由策略',
    type: 'string',
    defaultValue: 'cloud-first',
    enum: ['cloud-first', 'ollama-first', 'local-first'],
    example: 'cloud-first',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.routing.fallbackToCloud',
    description: '是否允许降级到云端',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.localOllama.enabled',
    description: '是否启用本地 Ollama',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.localOllama.baseUrl',
    description: 'Ollama 服务地址',
    type: 'string',
    defaultValue: 'http://localhost:11434',
    example: 'http://localhost:11434',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.localOllama.defaultModel',
    description: 'Ollama 默认模型',
    type: 'string',
    defaultValue: 'qwen3:1.8b',
    example: 'llama3:8b',
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.localOllama.timeout',
    description: 'Ollama 请求超时（毫秒）',
    type: 'number',
    defaultValue: 30000,
    min: 1000,
    max: 120000,
    example: 30000,
  });

  configSchema.registerItem('AI 设置', {
    key: 'ai.tokenEstimator.enabled',
    description: '是否启用 Token 估算器',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}

function registerNotificationSettings(): void {
  configSchema.registerItem('通知设置', {
    key: 'notifications.preferredChannel',
    description: '首选通知渠道',
    type: 'string',
    defaultValue: 'auto',
    enum: ['auto', 'terminal', 'channel'],
    example: 'terminal',
  });

  configSchema.registerItem('通知设置', {
    key: 'notifications.idleThresholdMs',
    description: '消息空闲通知阈值（毫秒）',
    type: 'number',
    defaultValue: 60000,
    min: 5000,
    max: 3600000,
    example: 120000,
  });

  configSchema.registerItem('通知设置', {
    key: 'notifications.taskCompleteEnabled',
    description: '任务完成时发送通知',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('通知设置', {
    key: 'notifications.inputNeededEnabled',
    description: '需要用户输入时发送通知',
    type: 'boolean',
    defaultValue: true,
    example: false,
  });

  configSchema.registerItem('通知设置', {
    key: 'notifications.agentPushEnabled',
    description: 'Agent 主动推送通知',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });
}

function registerFeatureFlags(): void {
  configSchema.registerItem('功能开关', {
    key: 'features.autoCompact',
    description: '自动压缩对话历史',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.showTurnDuration',
    description: '显示每轮对话耗时',
    type: 'boolean',
    defaultValue: true,
    example: false,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.fileCheckpointing',
    description: '文件检查点功能',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.terminalProgressBar',
    description: '终端进度条显示',
    type: 'boolean',
    defaultValue: true,
    example: false,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.showStatusInTerminalTab',
    description: '在终端标签页显示状态',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.respectGitignore',
    description: '文件操作时尊重 .gitignore',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.copyFullResponse',
    description: '复制完整响应内容',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.todoEnabled',
    description: '启用待办事项功能',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('功能开关', {
    key: 'features.showExpandedTodos',
    description: '默认展开显示待办事项',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}

function registerAutoUpdateSettings(): void {
  configSchema.registerItem('自动更新', {
    key: 'autoUpdate.enabled',
    description: '是否启用自动检查更新',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('自动更新', {
    key: 'autoUpdate.checkIntervalMs',
    description: '更新检查间隔（毫秒），默认 24 小时',
    type: 'number',
    defaultValue: 86400000,
    min: 3600000,
    max: 604800000,
    example: 43200000,
  });

  configSchema.registerItem('自动更新', {
    key: 'autoUpdate.channel',
    description: '更新通道',
    type: 'string',
    defaultValue: 'stable',
    enum: ['stable', 'beta'],
    example: 'beta',
  });

  configSchema.registerItem('自动更新', {
    key: 'autoUpdate.checkOnStartup',
    description: '启动时静默检查更新',
    type: 'boolean',
    defaultValue: true,
    example: true,
  });

  configSchema.registerItem('自动更新', {
    key: 'autoUpdate.verbose',
    description: '显示更新检查的详细日志',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}

function registerChannelSettings(): void {
  configSchema.registerItem('通道设置', {
    key: 'channels.gateway.enabled',
    description: '消息网关总开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.qq.enabled',
    description: 'QQ Bot 通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.discord.enabled',
    description: 'Discord 通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.telegram.enabled',
    description: 'Telegram 通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.dingtalk.enabled',
    description: '钉钉通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.feishu.enabled',
    description: '飞书通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });

  configSchema.registerItem('通道设置', {
    key: 'channels.wechat.enabled',
    description: '微信通道开关',
    type: 'boolean',
    defaultValue: false,
    example: true,
  });
}
