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

/** 构建变体（分版标识） */
export type BuildVariant = 'core' | 'personal' | 'coding' | 'enterprise';

/** 所有构建变体列表 */
export const BUILD_VARIANTS: readonly BuildVariant[] = [
  'core',
  'personal',
  'coding',
  'enterprise',
] as const;

/**
 * 当前构建变体
 *
 * 控制当前构建的版本类型，影响功能开关的默认值。
 * - 'core': 核心版（最小功能集，仅 CLI + 基础工具）
 * - 'personal': 个人版（Core + Telegram/Web 通道 + 插件）
 * - 'coding': 编码版（Personal + LSP + Notebook + 代码分析）
 * - 'enterprise': 企业版（Coding + Slack/Discord + Auth + Audit）
 *
 * 可通过环境变量 LIRI_BUILD_VARIANT 覆盖。
 */
export const BUILD_VARIANT: BuildVariant =
  (process.env['LIRI_BUILD_VARIANT'] as BuildVariant) || 'coding';

export const FEATURE_FLAGS = {
  // ───── AI/Agent 功能 ─────
  /** Agent 功能 */
  AGENT: true,
  /** 定时任务触发器 */
  AGENT_TRIGGERS: true,
  /** 远程触发器 */
  AGENT_TRIGGERS_REMOTE: false,
  /** 验证代理 */
  VERIFICATION_AGENT: true,
  /**
   * 13-P0-1（2026-10-05）：验证器**降级路径 fail-closed**（默认开）。
   *
   * 验证器自身不可用/异常/响应不可解析 ⇒ `passed:false`（ESCALATE），不再降级为 APPROVE。
   * 灰度回退旧行为：`FEATURE_VERIFIER_FAIL_CLOSED=false`（`feature()` 的 env 覆盖约定）。
   */
  VERIFIER_FAIL_CLOSED: true,
  /** 代理协调模式 */
  COORDINATOR_MODE: false,
  /** 主动模式 */
  PROACTIVE: false,

  // ───── Loop 系统（Phase 1-6）─────
  /** Goal-based Loop (/goal 命令) */
  LOOP_GOAL: true,
  /** Auto Verify Skill 集成 */
  LOOP_AUTO_VERIFY: true,
  /** Time-based Loop (/loop 命令) */
  LOOP_TIME: true,
  /** 模型路由自动选择 */
  LOOP_MODEL_ROUTING: true,
  /** Proactive Loop (Webhook) */
  LOOP_PROACTIVE: false,

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
  /** 沙箱模式 */
  SANDBOX: true,
  /** 离线/无人值守模式：所有交互降级为 Inbox 排队，计划自动审批 */
  UNATTENDED_MODE: false,

  // ───── 功能系统 ─────
  /** 插件系统 */
  ENABLE_PLUGINS: true,
  /** 技能系统 */
  ENABLE_SKILLS: true,
  /** 工作流引擎 */
  ENABLE_WORKFLOWS: false,
  /** 高级命令 */
  ENABLE_ADVANCED_COMMANDS: false,
  /** 命令管道 */
  COMMAND_PIPELINE: false,
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

  // ───── 办公模块（Office） ─────
  /** 文档模块（OfficeCLI MCP 集成） */
  DOC_MODULE: true,
  /** 文档模板引擎 */
  DOC_TEMPLATE: true,
  /** 邮件模块 */
  MAIL_MODULE: true,
  /** 邮件 IMAP 收件箱 */
  MAIL_IMAP: true,
  /** 日历模块 */
  CALENDAR_MODULE: true,
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
  /** MCP OAuth 认证 */
  MCP_OAUTH: false,
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
  /** 团队成员 */
  TEAMMEM: false,
  /** 休眠工具 */
  SLEEP: false,
  /** Git Worktree */
  WORKTREE: true,
  /** Chronos 定时任务 */
  CHRONOS: true,
  /** Tungsten 工具 */
  TUNGSTEN: true,
  /** 多通道消息系统 */
  FEATURE_CHANNELS: true,
  /** 企业微信通道 */
  FEATURE_CHANNEL_WECOM: true,
  /** 飞书通道 */
  FEATURE_CHANNEL_FEISHU: true,
  /** 钉钉通道 */
  FEATURE_CHANNEL_DINGTALK: true,
  /** Channel-Bridge 协同（跨机器任务委托） */
  FEATURE_CHANNEL_BRIDGE: true,
  /** 微信公众号通道 */
  FEATURE_CHANNEL_WECHAT: true,
  /** QQ Bot 通道 */
  FEATURE_CHANNEL_QQ: true,
  /** Telegram 通道 */
  FEATURE_CHANNEL_TELEGRAM: true,
  /** Discord 通道 */
  FEATURE_CHANNEL_DISCORD: true,
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
  /** 安全审计 */
  SECURITY_AUDIT: true,
  /**
   * 13-P2-1（2026-10-05）：**输出侧内容护栏**总开关（默认关）。
   *
   * 开启后 `chat/finalOutputGuard` 在终稿 mermaid 校验前/后跑统一护栏管线
   * （PII 脱敏 / 敏感拦截 / 注入回显，见 `chat/outputGuards/`）。
   * 默认关：脱敏会改写既有回复中的邮箱/卡号等，属可见行为变更 ⇒ 显式开启：
   * `FEATURE_OUTPUT_GUARD=true`。
   */
  OUTPUT_GUARD: false,
  /**
   * 13-P2-1：护栏命中敏感内容时**阻断**而非打码（默认关 ⇒ 打码）。
   * 仅在 `OUTPUT_GUARD=true` 时生效：`FEATURE_OUTPUT_GUARD_BLOCK=true`。
   */
  OUTPUT_GUARD_BLOCK: false,
  /**
   * P26-2 **P4**（2026-10-07）：护栏改写审计**是否连原文一起落盘**（默认关）。
   *
   * 关（默认）⇒ `validation/output_guard_applied` 只记**元数据**（动作 / 护栏名 / 原文长度 /
   * 原文 SHA-256）—— 可审计"发生过改写"且**不把刚打码的内容再写回磁盘**；
   * 开 ⇒ 额外附 `originalText`（护栏**前**原文），可完全重建"模型原本说了什么"
   * （FP 排查用）。⚠️ 开启即接受**未打码内容落入本地事件日志**：
   * `FEATURE_OUTPUT_GUARD_KEEP_ORIGINAL=true`。
   */
  OUTPUT_GUARD_KEEP_ORIGINAL: false,
  /**
   * A5（2026-10-05）：**跨会话资源治理**开关（默认关）。
   *
   * 开启后 `streamMessageFlow` / `ChatOrchestrator.sendMessage` 的准入点会经
   * `resourceGovernor` 登记在飞会话并提供只读视图 + 并发达上限**告警**（不拦截）。
   * 默认关：整链零行为变更（`admit` 不登记、`snapshot()` 为空）。
   * `FEATURE_RESOURCE_GOVERNOR=true`。
   */
  RESOURCE_GOVERNOR: false,

  // ───── Bash 安全姿态（A2/A4/A5，2026-10-09）─────
  // A2 = **安全基线**（默认开）；A4/A5 = 灰度（默认关，待启用条件满足）
  /**
   * A2：已批准命令**安全复检**（**2026-10-09 起默认开启 = 安全基线**）。
   *
   * 开 ⇒ 批准只免"审批交互"（ask 不再重复弹卡），危险命令/危险正则/AST/沙箱/白名单
   * 等**硬拦截仍须过**。关 ⇒ 保留旧行为"已批准命令跳过全部安全拦截层"。
   *
   * 第九轮审查 §七 特别点名本项：关闭时命中已批准缓存会**跳过整套安全拦截层**，
   * 与审批哈希语义问题叠加风险最高 ⇒ 用户裁定（2026-10-09）**翻转为安全基线**。
   * 回退（灰度）：`FEATURE_BASH_APPROVED_REVALIDATE=false`。
   */
  BASH_APPROVED_REVALIDATE: true,
  /**
   * A4：高能力解释器命令**人工确认**（默认关）。
   *
   * 开 ⇒ 未批准的 node/bun/npm/npx/python/pwsh 等解释器命令不得仅凭"白名单内"放行，
   * 转人工确认；关（默认）⇒ 行为不变。`FEATURE_BASH_INTERPRETER_GUARD=true`。
   */
  BASH_INTERPRETER_GUARD: false,
  /**
   * A5：批准**严格模式**（默认关）。
   *
   * 开 ⇒ 禁用"命令名级放行"（仅保留精确 hash 命中），消除同名不同参漂移放行；
   * 关（默认）⇒ 保留既有命令名级放行。`FEATURE_BASH_APPROVAL_STRICT=true`。
   */
  BASH_APPROVAL_STRICT: false,

  // ───── Execution 生命周期（PR2，2026-10-09；默认关 = 零行为变更的灰度开关）─────
  /**
   * PR2：**两段式取消**（默认关）。
   *
   * 开 ⇒ 渠道空转超时走两段：`CANCEL_REQUESTED` → `abort()`（端到端信号）→ grace（5s）确认
   * 底层停止 → `CANCELLED`；**grace 内未确认 ⇒ 保留 lease**（不释放 session 所有权，后续消息
   * 排队 `QUEUED`，不启动下一次）。关（默认）⇒ 保留既有"超时即释放、best-effort 关闭"行为。
   * `FEATURE_EXECUTION_TWO_PHASE_CANCEL=true`。
   */
  EXECUTION_TWO_PHASE_CANCEL: false,

  // ───── 安全姿态（P0-3，2026-10-10；默认关 = 零行为变更的灰度开关）─────
  /**
   * P0-3：**code_run 深扫未完成即拒绝**（默认关）。
   *
   * 开 ⇒ SWC 原生 CallExpression 深扫**未执行/失败**（`scanStatus='skipped'|'failed'`）时，
   * code_run **不落入 ALLOW**，按 fail-closed **拒绝**（`security-rejected`）。
   * 关（默认）⇒ 保留既有"深扫不可用 ⇒ 跳过"行为（但结果**如实带出 `scanStatus`**，可观测）。
   * 背景：深扫不可用时旧行为等价于把 `INDETERMINATE` 折叠为 `ALLOW`（fail-open 盲区）。
   * `FEATURE_CODE_RUN_DEEP_SCAN_STRICT=true`。
   */
  CODE_RUN_DEEP_SCAN_STRICT: false,

  // ───── 客户端流式接入 Execution（P0-2，2026-10-10；默认关 = 零行为变更的灰度开关）─────
  /**
   * P0-2：**客户端 `/v1/chat/stream` 接入 Execution 生命周期**（默认关）。
   *
   * 开 ⇒ SSE 入口 `acquire(sessionId)` 注入 `executionId`，与渠道路径**同一记账链路**
   * （`ChatManager` 工具执行前 `await beginToolCall()` ⇒ **写前记账 + fail-closed**，
   * 落盘失败即拒绝该工具），并按终态 `complete`/`fail` 结算。
   * 关（默认）⇒ 不 acquire、不注入、不记账、不拒绝（与既有行为完全一致）。
   * `FEATURE_CLIENT_STREAM_EXECUTION=true`。
   */
  CLIENT_STREAM_EXECUTION: false,

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

  // ───── Code Mode（模型生成编排代码沙箱执行，默认关闭）─────
  /** code_run 工具总开关（默认关闭，显式开启才暴露；CM-1 三轮评审 P0-2） */
  CODE_MODE: false,

  // ───── 研究模式（Teamwork P0-3 竞争编排，默认关闭）─────
  /** 候选生成 + 对抗批评（VerifierAgent）收敛总开关——研究型意图/显式研究模式下启用 */
  COMPETITIVE_STRATEGY: false,

  // ───── 编排模式：自校验（2026-10-07，`pattern-wiring-closure.md` §4「P1」）─────
  /**
   * `self_verify` 模式总开关（**默认关闭**）。
   *
   * 开启后：`complex + 自校验意图` 的任务将由该模式命中，并把配方落到**既有** VerifierAgent
   * （`verifyPolicy:'blocking'` + `failClosed:true` + `maxCycles:2`）⇒ 回合质量判定**更严**
   * （可能增加重试）。**默认关**是刻意的（不静默改变既有编排行为）；命中 ≠ 启用。
   */
  SELF_VERIFY_PATTERN: false,

  // ───── 工作流脚本 ─────
  /** 工作流脚本 */
  WORKFLOW_SCRIPTS: false,

  // ───── 图像工具（Image Tools） ─────
  /** 多后端图像生成 Provider 模式 */
  IMAGE_GENERATE_MULTI_PROVIDER: true,
  /** L2 本地模型图片分析（OCR/YOLO/CLIP via Python） */
  IMAGE_ANALYSIS_LOCAL: true,
  /** 图像工具扩展编辑操作 */
  IMAGE_TOOL_EXTENDED: true,
  /** CanvasTool V2（Sharp 渲染） */
  CANVAS_TOOL_V2: true,

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

  // ───── 版本分层（Pro 版能力，默认关闭）─────
  // 占位默认 false；可用 FEATURE_PRO_* 环境变量开启。
  // license 体系恢复后，默认值由 tier 决定（见版本划分方案）。
  /** Pro：视频生成 */
  PRO_VIDEO_GENERATION: false,
  /** Pro：办公套件（文档/邮件/日历） */
  PRO_OFFICE_SUITE: false,
  /** Pro：PDCA 完整流程 */
  PRO_PDCA_FULL: false,
  /** Pro：安全五件套（信任工作区/自定义规则/智能路由） */
  PRO_SECURITY_SUITE: false,
  /** Pro：Swarm 编排 */
  PRO_SWARM: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function feature(name: FeatureFlag): boolean {
  const envValue = process.env[`FEATURE_${name}`];
  if (envValue !== undefined) {
    return envValue === 'true';
  }
  return FEATURE_FLAGS[name] ?? false;
}

export function isFeatureEnabled(name: FeatureFlag): boolean {
  return FEATURE_FLAGS[name];
}

/** 获取当前构建变体 */
export function getBuildVariant(): BuildVariant {
  return BUILD_VARIANT;
}

/** 检查是否为指定变体 */
export function isBuildVariant(variant: BuildVariant): boolean {
  return BUILD_VARIANT === variant;
}

/** 检查当前变体是否至少包含指定变体的功能（core < personal < coding < enterprise） */
export function isAtLeastVariant(variant: BuildVariant): boolean {
  const order: Record<BuildVariant, number> = {
    core: 0,
    personal: 1,
    coding: 2,
    enterprise: 3,
  };

  return order[BUILD_VARIANT] >= order[variant];
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
  ENABLE_IMAGE_GENERATE_MULTI: 'IMAGE_GENERATE_MULTI_PROVIDER',
  ENABLE_IMAGE_ANALYSIS_LOCAL: 'IMAGE_ANALYSIS_LOCAL',
  ENABLE_IMAGE_TOOL_EXTENDED: 'IMAGE_TOOL_EXTENDED',
  ENABLE_CANVAS_TOOL_V2: 'CANVAS_TOOL_V2',
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
