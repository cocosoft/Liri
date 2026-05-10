/**
 * 统一功能标志管理
 * 提供条件编译能力，控制可选功能的加载和行为
 *
 * 使用方式：
 *   import { feature } from '@modules/core';
 *   if (feature('AGENT_TRIGGERS')) { ... }
 *
 * 设计原则：
 *   - 集中定义，统一管理（唯一数据源）
 *   - feature() 签名与 bun:bundle 兼容，支持未来编译期 DCE 升级
 *   - 命名约定参考 CC 源码
 */

export const FEATURE_FLAGS = {
  // ───── AI/Agent 功能 ─────
  /** Agent 功能 */
  AGENT: true,
  /** Agent 群组功能 */
  AGENT_SWARMS: true,
  /** 定时任务触发器 */
  AGENT_TRIGGERS: true,
  /** 远程触发器 */
  AGENT_TRIGGERS_REMOTE: false,
  /** 验证代理 */
  VERIFICATION_AGENT: true,
  /** 代理协调模式 */
  COORDINATOR_MODE: false,
  /** 主动模式 */
  PROACTIVE: false,

  // ───── 系统模式 ─────
  /** 桥接模式 */
  BRIDGE_MODE: false,
  /** 守护进程模式 */
  DAEMON: false,
  /** 语音模式 */
  VOICE_MODE: false,
  /** 后台常驻模式 */
  KAIROS: false,
  /** KAIROS 简报 */
  KAIROS_BRIEF: false,
  /** KAIROS GitHub Webhooks */
  KAIROS_GITHUB_WEBHOOKS: false,
  /** KAIROS 推送通知 */
  KAIROS_PUSH_NOTIFICATION: false,

  // ───── 功能系统 ─────
  /** 插件系统 */
  ENABLE_PLUGINS: true,
  /** 技能系统 */
  ENABLE_SKILLS: true,
  /** 工作流引擎 */
  ENABLE_WORKFLOWS: false,
  /** 高级命令 */
  ENABLE_ADVANCED_COMMANDS: false,
  /** MCP 系统 */
  MCP_SYSTEM: true,
  /** 模板系统 */
  TEMPLATES: false,
  /** 实验性技能搜索 */
  EXPERIMENTAL_SKILL_SEARCH: false,
  /** 工具搜索 */
  TOOL_SEARCH: true,
  /** 缓存 */
  ENABLE_CACHE: true,

  // ───── 核心工具 ─────
  /** Bash 工具 */
  BASH: true,
  /** 文件读取工具 */
  FILE_READ: true,
  /** 文件写入工具 */
  FILE_WRITE: true,
  /** 文件编辑工具 */
  FILE_EDIT: true,
  /** Grep 工具 */
  GREP: true,
  /** Glob 工具 */
  GLOB: true,
  /** WebFetch 工具 */
  WEB_FETCH: true,
  /** WebSearch 工具 */
  WEB_SEARCH: true,
  /** 任务工具 */
  TASK: true,
  /** TODO 工具 */
  TODO: true,
  /** 简报工具 */
  BRIEF: true,
  /** 计划工具 */
  PLAN: true,
  /** 配置工具 */
  CONFIG: true,
  /** 提问工具 */
  ASK: true,

  // ───── 平台工具 ─────
  /** PowerShell 工具（Windows） */
  POWERSHELL: true,
  /** LSP 工具 */
  LSP: false,
  /** MCP 工具（平台层） */
  MCP: false,
  /** REPL 工具 */
  REPL: false,
  /** Notebook 工具 */
  NOTEBOOK: false,
  /** 浏览器工具 */
  BROWSER: false,
  /** 代码分析工具 */
  CODE_ANALYSIS: false,
  /** 监控工具 */
  MONITOR_TOOL: false,

  // ───── 协作/消息工具 ─────
  /** 发送消息工具 */
  SEND_MESSAGE: false,
  /** 团队创建工具 */
  TEAM_CREATE: false,
  /** 团队删除工具 */
  TEAM_DELETE: false,
  /** 休眠工具 */
  SLEEP: false,
  /** Git Worktree */
  WORKTREE: true,
  /** Chronos 定时任务 */
  CHRONOS: true,
  /** Tungsten 工具 */
  TUNGSTEN: true,
  /** 远程触发器工具 */
  REMOTE_TRIGGER: false,
  /** 发送用户文件工具 */
  SEND_USER_FILE: false,
  /** 推送通知工具 */
  PUSH_NOTIFICATION: false,
  /** 订阅 PR 工具 */
  SUBSCRIBE_PR: false,
  /** Snip 工具 */
  SNIP: false,

  // ───── 状态管理 ─────
  /** 响应式上下文压缩 */
  REACTIVE_COMPACT: false,
  /** 上下文折叠 */
  CONTEXT_COLLAPSE: false,
  /** 历史消息裁剪 */
  HISTORY_SNIP: false,
  /** 后台会话支持 */
  BG_SESSIONS: false,
  /** 溢出测试工具 */
  OVERFLOW_TEST_TOOL: false,

  // ───── 安全 ─────
  /** 权限检查 */
  PERMISSION_CHECKS: true,
  /** 安全扫描 */
  SECURITY_SCAN: true,

  // ───── 性能与监控 ─────
  /** 内存监控 */
  MEMORY_MONITORING: true,
  /** 性能追踪 */
  PERFORMANCE_TRACKING: true,

  // ───── 开发调试 ─────
  /** 调试模式 */
  DEBUG_MODE: false,
  /** 开发者功能 */
  DEV_FEATURES: false,
  /** 测试模式 */
  TEST_MODE: false,
  /** 终端面板 */
  TERMINAL_PANEL: false,
  /** 简单模式 */
  SIMPLE_MODE: false,
  /** 用户类型 */
  USER_TYPE_ANT: false,

  // ───── 分类器 ─────
  /** 会话分类器 */
  TRANSCRIPT_CLASSIFIER: false,
  /** Bash命令分类器 */
  BASH_CLASSIFIER: false,

  // ───── UDS ─────
  /** UDS 收件箱 */
  UDS_INBOX: false,

  // ───── 工作流脚本 ─────
  /** 工作流脚本 */
  WORKFLOW_SCRIPTS: false,

  // ───── 文件转换器（File Converter） ─────
  /** 文件转换总开关 */
  FILE_CONVERTER: true,
  /** DOCX 转换 */
  FILE_CONVERTER_DOCX: true,
  /** XLSX 转换 */
  FILE_CONVERTER_XLSX: true,
  /** PPTX 转换 */
  FILE_CONVERTER_PPTX: true,
  /** PDF 转换 */
  FILE_CONVERTER_PDF: true,
  /** 图片转换 */
  FILE_CONVERTER_IMAGE: true,
  /** 音频转换 */
  FILE_CONVERTER_AUDIO: true,
  /** EPUB 转换 */
  FILE_CONVERTER_EPUB: true,
  /** ZIP 递归转换 */
  FILE_CONVERTER_ZIP: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function feature(name: FeatureFlag): boolean {
  return FEATURE_FLAGS[name] ?? false;
}

export function isFeatureEnabled(name: FeatureFlag): boolean {
  return FEATURE_FLAGS[name];
}

/** 工具名到核心标志的映射表 */
const TOOL_FLAG_MAP: Record<string, FeatureFlag> = {
  ENABLE_BASH: 'BASH',
  ENABLE_FILE_READ: 'FILE_READ',
  ENABLE_FILE_WRITE: 'FILE_WRITE',
  ENABLE_FILE_EDIT: 'FILE_EDIT',
  ENABLE_GREP: 'GREP',
  ENABLE_GLOB: 'GLOB',
  ENABLE_WEB_FETCH: 'WEB_FETCH',
  ENABLE_WEB_SEARCH: 'WEB_SEARCH',
  ENABLE_AGENT: 'AGENT',
  ENABLE_SKILL: 'ENABLE_SKILLS',
  ENABLE_TASK: 'TASK',
  ENABLE_TODO: 'TODO',
  ENABLE_BRIEF: 'BRIEF',
  ENABLE_CONFIG: 'CONFIG',
  ENABLE_PLAN: 'PLAN',
  ENABLE_NOTEBOOK: 'NOTEBOOK',
  ENABLE_CHRONOS: 'CHRONOS',
  ENABLE_TUNGSTEN: 'TUNGSTEN',
  ENABLE_ASK: 'ASK',
  ENABLE_SEND_MESSAGE: 'SEND_MESSAGE',
  ENABLE_TEAM_CREATE: 'TEAM_CREATE',
  ENABLE_TEAM_DELETE: 'TEAM_DELETE',
  ENABLE_SLEEP: 'SLEEP',
  ENABLE_MONITOR: 'MONITOR_TOOL',
  ENABLE_BROWSER: 'BROWSER',
  ENABLE_WORKTREE: 'WORKTREE',
  ENABLE_VOICE: 'VOICE_MODE',
  ENABLE_CODE_ANALYSIS: 'CODE_ANALYSIS',
  ENABLE_REMOTE_TRIGGER: 'REMOTE_TRIGGER',
  ENABLE_SEND_USER_FILE: 'SEND_USER_FILE',
  ENABLE_PUSH_NOTIFICATION: 'PUSH_NOTIFICATION',
  ENABLE_SUBSCRIBE_PR: 'SUBSCRIBE_PR',
  ENABLE_SNIP: 'SNIP',
  ENABLE_TOOL_SEARCH: 'TOOL_SEARCH',
  ENABLE_FILE_CONVERTER: 'FILE_CONVERTER',
  ENABLE_FILE_CONVERTER_DOCX: 'FILE_CONVERTER_DOCX',
  ENABLE_FILE_CONVERTER_XLSX: 'FILE_CONVERTER_XLSX',
  ENABLE_FILE_CONVERTER_PPTX: 'FILE_CONVERTER_PPTX',
  ENABLE_FILE_CONVERTER_PDF: 'FILE_CONVERTER_PDF',
  ENABLE_FILE_CONVERTER_IMAGE: 'FILE_CONVERTER_IMAGE',
  ENABLE_FILE_CONVERTER_AUDIO: 'FILE_CONVERTER_AUDIO',
  ENABLE_FILE_CONVERTER_EPUB: 'FILE_CONVERTER_EPUB',
  ENABLE_FILE_CONVERTER_ZIP: 'FILE_CONVERTER_ZIP',
};

/** 所有工具名称列表 */
export const TOOL_NAMES: readonly string[] = Object.keys(TOOL_FLAG_MAP);

/**
 * 获取工具功能的启用状态
 * 通过工具名在映射表中查找对应的核心标志
 */
export function getToolFlag(toolName: string): boolean {
  const coreKey = TOOL_FLAG_MAP[toolName];
  if (coreKey) {
    return feature(coreKey);
  }
  return false;
}
