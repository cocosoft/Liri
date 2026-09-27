/**
 * 状态块 `statusType` 契约（前后端唯一事实来源）
 *
 * ## 为什么放在 shared
 *
 * 「状态块是否属于内部过渡状态（协议过程消息，非用户可见 ⇒ 前端丢弃）」这一判据
 * 原在 app / client **各有一份逐字重复的实现**（含 13 条字符串模式回退）；且两端
 * **取值口径不一致** —— 后端为 `🔧 Running tool` 发 `tool_running`，而白名单只认
 * `tool_started`（该值**全仓无生产者**）⇒ 结构化通路对该项**从未生效**，实际靠
 * `content.includes('🔧') && content.includes('Running tool')` 兜住（CS02 病理）。
 *
 * 本文件是该判据的**单一事实来源**：值表 + 分类集合，双端只引用、不再写字面量。
 * 详见 `.trae/specs/chat-status-type-contract.md`。
 */

/** 状态块 `statusType` 的规范值 */
export const STATUS_TYPE = {
  // ── 内部过渡：协议过程消息，非用户可见 ⇒ 前端丢弃
  /** 模型思考/分析/准备等过程提示（如 `AI is thinking...`、`思考中`） */
  AI_THINKING: "ai_thinking",
  /** 工具执行中提示（如 `🔧 Running tool: <name>`） */
  TOOL_RUNNING: "tool_running",
  /**
   * 工具开始提示。
   * ⚠ 当前**无生产者**（历史值，保留以覆盖既有持久化数据 / 第三方实现）。
   */
  TOOL_STARTED: "tool_started",
  /** 工具完成提示（如 `✅ Tool <name> completed`） */
  TOOL_COMPLETED: "tool_completed",
  /** 工具失败提示（如 `❌ Tool <name> failed — <msg>`） */
  TOOL_FAILED: "tool_failed",

  // ── 用户可见：保留渲染
  /** 上下文压缩进度 */
  COMPACTION: "compaction",
  /** 上下文水位告警 */
  WATERMARK: "watermark",
  /** 输出被截断（达到最大工具轮次等） */
  TRUNCATED: "truncated",
  /** 工具失败后的重试提示 */
  TOOL_RETRY: "tool_retry",
  /** 请求重试提示 */
  RETRY: "retry",
  /** 连接重建提示（前端自制） */
  RECONNECT: "reconnect",
  /** 任务全部完成 */
  TASK_ALL_DONE: "task_all_done",
  /** 会话恢复提示 */
  RESUME: "resume",
  /** 错误提示（前端自制） */
  ERROR: "error",
} as const;

export type SharedStatusType = (typeof STATUS_TYPE)[keyof typeof STATUS_TYPE];

/**
 * 内部过渡状态集合（前端据此**丢弃**）。
 *
 * ## 设计取舍：显式瞬态集合 + 未知值默认可见（fail-visible）
 *
 * 不使用"可渲染白名单"：若新增值忘记分类，**默认会被用户看到**（可发现），
 * 而不是被静默吞掉（不可发现）。同时与修复前行为等价 —— 旧实现亦为黑名单式丢弃。
 *
 * ## 与旧字符串回退的等价性（逐值）
 *
 * | 值 | 旧行为（结构化 OR 字符串） | 新行为（仅结构化） |
 * |---|---|---|
 * | `ai_thinking` | 丢弃 | 丢弃 |
 * | `tool_running` | 丢弃（**仅字符串**） | 丢弃（结构化） |
 * | `tool_completed` | 丢弃 | 丢弃 |
 * | `tool_failed` | 丢弃（**仅字符串**） | 丢弃（结构化） |
 * | `tool_started` | 丢弃（结构化，无生产者） | 丢弃 |
 * | 其余值 | 渲染 | 渲染 |
 */
export const TRANSIENT_STATUS_TYPES: ReadonlySet<string> = new Set([
  STATUS_TYPE.AI_THINKING,
  STATUS_TYPE.TOOL_RUNNING,
  STATUS_TYPE.TOOL_STARTED,
  STATUS_TYPE.TOOL_COMPLETED,
  STATUS_TYPE.TOOL_FAILED,
]);

/**
 * 判断状态块是否属于内部过渡状态（应丢弃）。
 *
 * 判据**只依赖结构化 `statusType`**，禁止回退到 `content` 文本匹配（CS02）。
 * 未知 / 缺失值一律判为「非内部过渡」⇒ 保留渲染（fail-visible）。
 */
export function isTransientStatusType(statusType?: string): boolean {
  return statusType !== undefined && TRANSIENT_STATUS_TYPES.has(statusType);
}
