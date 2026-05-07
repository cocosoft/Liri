/**
 * 统一功能标志管理
 * 提供条件编译能力，控制可选功能的加载和行为
 *
 * 使用方式：
 *   import { feature } from '@modules/core';
 *   if (feature('AGENT_TRIGGERS')) { ... }
 *
 * 设计原则：
 *   - 集中定义，统一管理
 *   - feature() 签名与 bun:bundle 兼容，支持未来编译期 DCE 升级
 *   - 命名约定参考 CC 源码
 */
export const FEATURE_FLAGS = {
  /** 插件系统 */
  ENABLE_PLUGINS: true,
  /** 技能系统 */
  ENABLE_SKILLS: true,
  /** MCP系统 */
  ENABLE_MCP: true,
  /** 工作流引擎 */
  ENABLE_WORKFLOWS: false,
  /** 高级命令 */
  ENABLE_ADVANCED_COMMANDS: false,

  /** 定时任务触发器 */
  AGENT_TRIGGERS: true,
  /** 远程触发器 */
  AGENT_TRIGGERS_REMOTE: false,
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
  /** 主动模式 */
  PROACTIVE: false,
  /** Agent群组功能 */
  AGENT_SWARMS: true,
  /** 系统监控工具 */
  MONITOR_TOOL: false,
  /** 会话分类器 */
  TRANSCRIPT_CLASSIFIER: false,
  /** Bash命令分类器 */
  BASH_CLASSIFIER: false,

  /** 响应式上下文压缩 */
  REACTIVE_COMPACT: false,
  /** 上下文折叠 */
  CONTEXT_COLLAPSE: false,
  /** 历史消息裁剪 */
  HISTORY_SNIP: false,
  /** 后台会话支持 */
  BG_SESSIONS: false,

  /** 实验性技能搜索 */
  EXPERIMENTAL_SKILL_SEARCH: false,
  /** 模板系统 */
  TEMPLATES: false,

  // ───── 工具层条件加载标志 ─────
  /** PowerShell 工具（Windows） */
  POWERSHELL: true,
  /** LSP 工具 */
  LSP: false,
  /** MCP 工具（工具层） */
  MCP: false,
  /** REPL 工具 */
  REPL: false,
  /** Notebook 工具 */
  NOTEBOOK: false,
  /** 配置工具 */
  CONFIG: true,
  /** 浏览器工具 */
  BROWSER: false,
  /** 计划工具 */
  PLAN: true,
  /** 验证代理提示 */
  VERIFICATION_AGENT: true,
  /** KAIROS GitHub Webhooks */
  KAIROS_GITHUB_WEBHOOKS: false,
  /** UDS 收件箱 */
  UDS_INBOX: false,
  /** 工作流脚本 */
  WORKFLOW_SCRIPTS: false,
  /** 工具搜索 */
  TOOL_SEARCH: true,
  /** Git Worktree */
  WORKTREE: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function feature(name: FeatureFlag): boolean {
  return FEATURE_FLAGS[name] ?? false;
}

export function isFeatureEnabled(name: FeatureFlag): boolean {
  return FEATURE_FLAGS[name];
}
