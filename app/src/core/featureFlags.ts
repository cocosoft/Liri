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

// D1（2026-10-11 用户裁定「接线」）：构建变体层 —— `build-variant.ts` 生成的
// `BUILD_VARIANT_FLAGS` 是**构建期**产物，作为 `feature()` 的变体默认层（见 `feature()`）。
import { BUILD_VARIANT_FLAGS } from './buildVariantFlags';

/** 构建变体（分版标识） */
export type BuildVariant =
  | 'core'
  | 'personal'
  | 'coding'
  | 'enterprise'
  | 'headless';

/** 所有构建变体列表 */
export const BUILD_VARIANTS: readonly BuildVariant[] = [
  'core',
  'personal',
  'coding',
  'enterprise',
  'headless',
] as const;

/**
 * 当前构建变体
 *
 * 控制当前构建的版本类型，影响功能开关的默认值。
 * - 'core': 核心版（最小功能集，仅 CLI + 基础工具）
 * - 'personal': 个人版（Core + Telegram/Web 通道 + 插件）
 * - 'coding': 编码版（Personal + LSP + Notebook + 代码分析）
 * - 'enterprise': 企业版（Coding + Slack/Discord + Auth + Audit）
 * - 'headless': 无界面服务端版（**与 personal 同能力面**，构建期剔除 UI；通道默认保留）
 *
 * 可通过环境变量 LIRI_BUILD_VARIANT 覆盖。
 */
export const BUILD_VARIANT: BuildVariant =
  (process.env['LIRI_BUILD_VARIANT'] as BuildVariant) || 'coding';

export const FEATURE_FLAGS = {
  // ───── 变体标记（非用户可配能力） ─────
  /**
   * `core` 变体标记（2026-10-20，变体矩阵方案 §3.1）：
   * 开 ⇒ 工具装配点（`tools/utils/ToolManagerUtils.ts`）把工具面收敛为 **7 项下限**
   * （`bash` / `file_read` / `file_write` / `file_edit` / `grep` / `glob` / `ask_user_question`）。
   *
   * 由 `scripts/variant-matrix.ts` 的 `minimalToolSurface` 生成 —— **仅 `core` 为 true**；
   * 其余变体恒 `false`（与静态默认一致 ⇒ 零行为变更）。
   */
  CORE_MINIMAL: false,
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
  /**
   * 主动模式（Cron 完成/失败后的主动汇报、风险告警等）。
   *
   * 2026-10-20（U-01，用户裁定「默认开启」）：`false → true`。
   * 关闭时：不建主动队列表、不启动扫描器、Cron 完成走原通知中心链路；
   * 回退方式：`FEATURE_PROACTIVE=false`（`feature()` 的 env 覆盖约定）。
   */
  PROACTIVE: true,

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
  /**
   * AlwaysOn 自主执行（U-02，2026-10-20 用户裁定「接线并默认开」）。
   *
   * 开启时：启动期从 `ProjectStore` 读取项目并注册运行时（5 分钟 tick，受既有 9 门控 +
   * 日预算 + 工具调用上限约束）；关闭时不注册、不启动，行为与接线前一致。
   * 回退：`FEATURE_ALWAYSON=false`。
   */
  ALWAYSON: true,
  /**
   * AlwaysOn **目标达成自评**（2026-10-20 产品裁定「启用」，默认开）。
   *
   * 开 ⇒ 每轮执行收尾后多一次**只读**模型调用，对「计划 + 执行输出 + 错误 + 工具调用数 +
   * 补丁字节」做三值判定（`achieved` / `not_achieved` / `unverified`），结果进报告与通知；
   * 自评前过 `checkDailyBudget`（预算锁定 ⇒ 不评估），异常/解析失败一律 `unverified`。
   * 关 ⇒ 回到 v2 口径：报告固定 `unverified（未做模型自评）`，零额外模型调用。
   * 回退：`FEATURE_ALWAYSON_GOAL_EVAL=false`。
   */
  ALWAYSON_GOAL_EVAL: true,
  /**
   * AlwaysOn **snapshot-copy 回退**（2026-10-20，默认开）。
   *
   * 开 ⇒ git-worktree 不可用（非 git 仓库 / 工作区脏）时，改为**目录快照**隔离
   * （`<data>/alwayson/snapshots/<runId>`，排除 `.git`/`node_modules`/`dist` 等；
   * 源目录 > 1 GiB 拒绝），让 AlwaysOn 在非 git 项目上也能跑；
   * 该模式**无 git 语义、不自动回灌** ⇒ 隔离区一律保留（报告 `Snapshot Kept` 指路）。
   * 关 ⇒ 回到 v2 口径：这类项目每轮跳过（`not_git_repo_or_dirty`）。
   * 回退：`FEATURE_ALWAYSON_SNAPSHOT_FALLBACK=false`。
   */
  ALWAYSON_SNAPSHOT_FALLBACK: true,

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
  /**
   * 发送消息工具。
   *
   * 2026-10-20（U-03 收口，用户裁定「开 flag 接线」）：由 `false` 改为 `true`。
   * 依据：loader / 分类别（`notify`）/ 真实现（`TeammateManager.sendMessageToTeammate`）齐备，
   * 只差本默认值；它与 `broadcast`（人类通道）与 `channel`（多通道）职责正交。
   */
  SEND_MESSAGE: true,
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
  /**
   * U-05b（2026-10-17）：渠道交互提问“下一条消息即答案”。
   * 默认关闭；开启后仅对声明 `capabilities.interactive` 的渠道生效。
   */
  CHANNEL_QUESTION_ANSWER: false,
  /**
   * G-2（2026-10-18）：**通道级工具面最小权限（PoLP）**（默认关 = 零行为变更）。
   *
   * 开 ⇒ 远程 IM / Webhook 通道的入站请求默认按 `messaging` 任务面裁剪工具
   * （不含 `shell` / `file` 写类，见 `tools/toolCategories.ts` 的 `TASK_TOOL_CATEGORIES.messaging`）；
   * 本地 REPL / 客户端会话无通道来源 ⇒ 不注入，行为不变。
   * 关（默认）⇒ 不注入 `taskType` ⇒ 与现状逐字一致。
   * ⚠️ **例外（2026-10-20）**：`mobile` 属 `channels/toolPolicy.ts` 的
   * `ALWAYS_RESTRICTED_CHANNELS` —— 远程不可信来源，安全约束**不随本开关**开关，
   * 无论取值如何都按 `messaging` 面裁剪（方案 §2.6 硬约束）。
   * `FEATURE_CHANNEL_TOOL_POLICY=true`。
   * 触发条件见 `.trae/specs/default-off-switches-review-gates.md` §2 #14。
   */
  CHANNEL_TOOL_POLICY: false,
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
  /**
   * 阶段 4（2026-10-12）：**四原语只读投影广播**（默认关 = 零行为变更）。
   *
   * 开 ⇒ 执行域在**唯一 choke point**（`ExecutionManager.emitStatus`）把原生状态映射为四原语
   * （`PREPARED`/`RUNNING`/`SUSPENDED`/`SETTLED`）并经既有 `globalEventBus` 广播
   * （事件名 `SystemEvents.STATE_PROJECTED`；**只带原语**、不带原生细粒度状态）。
   * 关（默认）⇒ **不发布任何广播**（零行为变更；仅有常数级映射查表开销）。
   * ⚠️ 当前**无生产消费者**（出站订阅面 = 通道治理 §3 阶段 2.3，已暂缓）⇒ 属**预留接线**（UW）。
   * `FEATURE_STATE_PROJECTION_BROADCAST=true`。
   */
  STATE_PROJECTION_BROADCAST: false,

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
  /**
   * E-1（2026-10-18）：**swarm verifier 判不过时回灌 worker 重试一轮**（默认关 = 零行为变更）。
   *
   * 开 ⇒ `AgentSwarm` 仅在 verifier 给出**明确** `pass:false`（含 feedback）时，把 feedback 回灌
   * 原 worker 重试 **1 次**并重新门禁（独立 token 上限 20k，超限即跳过；verifier 自身故障 /
   * 输出不可解析 / worker 超时 / 批次取消 均不回灌）。
   * 关（默认）⇒ 与现状逐字一致（判不过即 `verify:'failed'`，不重试）。
   * `FEATURE_SWARM_VERIFY_RETRY=true`。
   * 触发条件见 `.trae/specs/default-off-switches-review-gates.md` §2 #15。
   */
  SWARM_VERIFY_RETRY: false,

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

  // ───── AI-VFS（D7，2026-10-11；默认关 = **默认最小工具面**）─────
  /**
   * D7（2026-10-11 用户裁定「①+④ 组合」）：AI-VFS **文件类**系统调用工具
   * （`read_vfs`/`list_vfs`/`write_vfs`）**默认不注册**（避免与 `file_read`/`file_write`/`glob`
   * 形成"事实源双轨"；G21）。
   *
   * 开 ⇒ 三个文件类 VFS 工具随 `VFS_ENABLED=true` 显式启用；`stat_vfs` **始终可见**（元数据探测，
   * 不与文件工具重叠）。互斥/排他断言见 `tools/toolCategories` 双轨对 + `tests/tools/toolNameLists`。
   */
  VFS_ENABLED: false,

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

  // ───── 长任务预算挂起续跑（债二，2026-10-12；**同日用户裁定启用：默认开**）─────
  /**
   * **每日预算耗尽 ⇒ 长任务挂起 / 放行后续跑**总开关（**默认开**）。
   *
   * 开 ⇒ 撞限时两条链各自落"挂起标记"检查点并登记到 `BudgetSuspendCoordinator`，
   * 用户放行（boost/unlock-today/waive-once）后按挂起时间序、上限内续跑。
   * 关 ⇒ 撞限行为与启用前**完全一致**（零行为变更）：`FEATURE_BUDGET_SUSPEND_RESUME=false`。
   *
   * **启用依据（2026-10-12 用户裁定「补齐查询面可见性与 taor 链 E2E 后再启用开关」）**：
   * 两链「撞限 → 放行 → **真续跑**」均已真实端到端实证（流式链 v1.4 · taor 链 v1.6），
   * 且收尾缺陷（B3-1 续跑短路 / B3-2 递减连续性 / B3-3 启动期装配 / 幽灵挂起 /
   * E2E-1 会话锁泄漏）已全部根因修复。详见 `.trae/specs/long-task-suspend-resume.md` v1.7
   * 与证据 `.trae/architecture/fix-evidence-registry.json` → `BUDGET-SUSPEND-RESUME`。
   */
  BUDGET_SUSPEND_RESUME: true,

  // ───── 长程 guard 挂起 + 独立继续入口（T3-12，2026-10-13 用户裁定；**默认关**）─────
  /**
   * **guard 挂起（熵门禁 / 轮上限）接通 + 独立「长程继续」入口**总开关（**默认关**）。
   *
   * 开 ⇒ ①熵门禁（`evaluateSchemaEntropyGate` 命中 warn）/ 轮上限（TAOR `max_turns`）在
   * 既有轮间安全点各落 `guard_suspend` 检查点并登记 `BudgetSuspendCoordinator`（`kind='guard'`，
   * reason = `schema_entropy` / `turn_limit`）；②新增独立端点 `POST /v1/sessions/:id/continue`
   * 可对 **guard** 挂起触发续跑（**不复用** relief 放行通道）。
   * 关（默认）⇒ 零行为变更：熵门禁**仍只 WARN**（`TOOLGOV-TG5` 的「绝不阻断」成立）、轮上限仍 aborts、
   * 继续端点 404。`FEATURE_GUARD_SUSPEND=true`。
   *
   * ⚠️ 与 `BUDGET_SUSPEND_RESUME`（日预算挂起，默认开）**正交**：`kind='budget'` 的挂起仍只由
   * relief（boost/waive-once/unlock-today）唤醒；`onReliefApplied` **绝不**唤醒 `kind='guard'`。
   */
  GUARD_SUSPEND: false,

  // ───── PREPARED 快照重放（T1-13 / `✅-4`，R-A；**默认关 ⇒ 零行为变更**）─────
  /**
   * 重放**强制套用**落盘快照（默认关）。
   *
   * 开 ⇒ 续跑（`ChatManager._resumeSuspendedStream` 的「重发一轮」分支）在**重算工具面之前**
   * 读取该会话最近一条 `execution/prepared` 快照，并以 `visibleTools` **覆盖**实时计算结果
   * ⇒ 运行期改动 profile / 工具注册表**不影响**历史执行的重放工具面（可复现性硬约束）。
   * 关（默认）⇒ **完全等价现状**（不读快照、不覆盖）。`FEATURE_PREPARED_SNAPSHOT_REPLAY=true`。
   *
   * **W3 裁定（2026-10-21 用户「保持关闭」）**：关 ⇒ 重放**不保证**工具面与当时一致 ——
   * 会按**当前** profile / 工具注册表重新计算。这是**有意的取舍**（零行为变更优先，且避免
   * 快照缺失时把重放变成硬失败），不是缺陷；需要历史执行严格可复现时再开启本开关。
   * 回归锁见 `tests/config/featureFlagContract.test.ts` 的「W3 可复现性裁定」用例。
   *
   * ⚠️ 只覆盖**会重算工具面**的续跑分支 —— 检查点重放（`resumeStream` 逐条重放剩余工具调用）
   * **不重选**工具 ⇒ 无需强制（见 `.trae/specs/execution-prepared-snapshot-persistence.md` §11 R-A）。
   * ⚠️ 本键为**功能灰度开关**（不在 17 项 `SAFETY_SWITCHES` 内），不受 `lint:doc-code` 安全开关断言约束。
   */
  PREPARED_SNAPSHOT_REPLAY: false,

  /**
   * 轮次级 **USD 前置判定**（**默认开**；外部建议 ②，2026-10-20 用户裁定「开启」）。
   *
   * 背景：金额轨按 **已结算** 判定（2026-10-15 用户裁定「金额轨无本轮预估」）⇒ 一个
   * 超大附件 / 超长上下文轮次可以先放行、到**下一轮**才被拦（单轮可穿透上限）。
   * 开 ⇒ 发模型前用当前模型价 + 本轮估算（含附件字节折算的 token）算一次金额，
   * `已结算 + 本轮估算 > 有效上限` 即**短路拒发**（错误码沿用 `DAILY_BUDGET_EXCEEDED`）。
   *
   * ⚠️ 本键为默认开即**覆盖**上述 2026-10-15 口径（按"本轮预估"参与判定）——
   * 2026-10-20 用户明确裁定开启。
   * 灰度回退：`FEATURE_USD_TURN_PREFLIGHT=false`（`feature()` 的 env 覆盖约定）。
   */
  USD_TURN_PREFLIGHT: true,

  // ───── 工具侧车隔离（Tool Sidecar Isolation，S1；**默认关 ⇒ 零行为变更**）─────
  /**
   * P1：常驻 LSP 侧车**双跑开关**（默认关）。
   *
   * 关（默认）⇒ 侧车进程**根本不启动**，`lsp` 工具走**内置 loader**（与现状逐字等价，零行为变更）；
   * 开 ⇒ 工具装载改选**侧车 loader** 并按 `utils/sidecarIpc.ts` 契约拉起常驻侧车（骨架见
   * `tools/sidecar/**`；工具面接线在 S2/T2.2）。运维/灰度覆盖：`FEATURE_TOOL_SIDECAR_LSP=true`。
   *
   * 依据：`.trae/specs/tool-sidecar-isolation.md` §3-D4；三级解析 env > 变体层 > 静态默认。
   * **如实**：本键**不在** 17 项 `SAFETY_SWITCHES`（`tests/config/featureFlagContract.test.ts`）内，
   * 属功能灰度开关，不受该契约测试约束。
   */
  TOOL_SIDECAR_LSP: false,
  /**
   * P2：媒体侧车（`sharp` 原生面 + Python `vision_worker`）**双跑开关**（默认关）。
   *
   * 关（默认）⇒ 零行为变更（媒体工具仍走既有实现）；开 ⇒ 受管媒体侧车（S5/T5.*）。
   * 运维/灰度覆盖：`FEATURE_TOOL_SIDECAR_MEDIA=true`。依据：同 spec §3-D4。
   */
  TOOL_SIDECAR_MEDIA: false,
  /**
   * P3：**侧车作业挂起**（长耗时侧车工具**不得同步阻塞**）开关（默认关）。
   *
   * 开 ⇒ 媒体侧车 L2 分析走**作业模式**（`job.submit` → 挂起 → `job.completed` → 续跑）：
   * 工具调用期间向内核登记 `kind='tool-job'` 挂起并投影 `SUSPENDED`（**不推进轮次**、**保留连接**），
   * 完成通知到达后释放挂起、投影 `RUNNING` 并把结果交回调用方（续跑）。
   * 关（默认）⇒ **零行为变更**（L2 仍走既有同步路径 / `WorkerGuard`）。有效前提：`TOOL_SIDECAR_MEDIA` 亦开。
   * 运维/灰度覆盖：`FEATURE_TOOL_JOB_SUSPEND=true`。
   *
   * 依据：`.trae/specs/sidecar-async-suspend.md` §4 裁定（Q2 新增 `kind='tool-job'`、Q3 不推进轮次 + 保留连接）。
   */
  TOOL_JOB_SUSPEND: false,

  // ───── USD 金额闸门（债四 S3 / USD-4，2026-10-13；**2026-10-15 启用：默认开**）─────
  /**
   * **金额口径（USD）闸门**（**默认开**）。
   *
   * 开 **且** 用户已保存 `limitUsd` ⇒ 日预算闸门（单一收口 `checkDailyBudget`）在 Token 轨之外
   * **并行**判定金额轨并**双轨从严**（任一先踩线即拒，见治理方案 §6.4）：
   * `usedUsd >= limitUsd` ⇒ 拒发（`AppError('DAILY_BUDGET_EXCEEDED')`，与 R16 同一路径与同一码）。
   * **未配置 `limitUsd`** ⇒ **金额轨完全不参与判定** ⇒ 行为与 Token 单轨**逐字一致**
   * （⇒ 本开关置 true 不会单独改变任何行为，必须同时配额度才生效）。
   * 运维/灰度覆盖：`FEATURE_USD_BUDGET_GATE=false` 可临时关闭。
   *
   * ⚠️ **不新增账本**：金额轨只**读**既有 S5/S8 的 `usedUsd` / `limitUsd`（闸门内不做预留/结算）；
   * ⚠️ **拦截 ≠ 挂起**：拒发是硬拦截；给用户放行机会**复用**既有 `BudgetSuspendCoordinator`
   *    （`kind='budget'`）+ 放行三件套（boost / waive-once / unlock-today），**不得**把四原语
   *    `SUSPENDED` 当作拦截信号（四原语严格只读、不承载裁决）。
   * ⚠️ 本键为**功能灰度开关**（不在 17 项 `SAFETY_SWITCHES` 内），不受 `lint:doc-code` 安全开关断言约束。
   *
   * 启用前置（2026-10-15 同日修复，缺一不可）：
   *  ① USD 台账同源化 —— 原 CLI 对话路径漏传 `model` 致金额记账**静默跳过 71%**
   *     （`usedUsd` 偏低会让限额远晚触发）；② `applyRelief` 补留痕（放行可追溯）。
   */
  USD_BUDGET_GATE: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * 解析功能开关（**三级优先**，D1 接线，2026-10-11）：
 *
 * 1. **env 覆盖**（最高）：`FEATURE_<name>=true|false` —— 运维/灰度显式控制；
 * 2. **构建变体层**：`BUILD_VARIANT_FLAGS[name]`（由 `scripts/build-variant.ts` **构建期**生成；
 *    仅含该变体显式声明的键）—— 未声明的键**回落**下一层；
 * 3. **静态默认**：`FEATURE_FLAGS[name]`（仅作变体未覆盖时的兜底）。
 *
 * ⚠️ 变体层是**构建期**产物：`LIRI_BUILD_VARIANT` 的**运行期**覆盖只影响 `getBuildVariant()`
 * （分版标识），**不**重新生成 flags。二者语义不同，勿混用。
 */
export function feature(name: FeatureFlag): boolean {
  const envValue = process.env[`FEATURE_${name}`];
  if (envValue !== undefined) {
    return envValue === 'true';
  }
  // 变体层：仅当生成物显式声明了该键时才接管（`undefined` ⇒ 回落静态默认）
  const variantValue = (
    BUILD_VARIANT_FLAGS as Readonly<Record<string, boolean | undefined>>
  )[name];
  if (variantValue !== undefined) {
    return variantValue;
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
    // `headless` 不计入"能力递增链"：它的能力面 = personal（2026-10-20 裁定），
    // 只是构建期剔除 UI ⇒ 与 personal 同档，避免被 `isAtLeastVariant('coding')` 误判。
    headless: 1,
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

/**
 * 工具开关的**键名**列表（`ENABLE_*`）—— 注意：这些**不是**工具名（真工具名见
 * `constants/toolNames.generated.ts` 的 `TOOL_NAMES`）。
 *
 * G7（2026-10-11，S2-3）：原名 `TOOL_NAMES` 与生成物的 `TOOL_NAMES`（真工具名）**同名不同物**
 * ⇒ 重命名为 `TOOL_FLAG_KEYS` 消除歧义（`getToolFlag` 亦按此键名查表）。
 */
export const TOOL_FLAG_KEYS: readonly string[] = Object.keys(TOOL_FLAG_MAP);

/**
 * 获取工具功能的启用状态
 * 通过**键名**（`ENABLE_*`）在映射表中查找对应的核心标志
 */
export function getToolFlag(flagKey: string): boolean {
  const coreKey = TOOL_FLAG_MAP[flagKey];
  if (coreKey) {
    return feature(coreKey);
  }
  return false;
}
