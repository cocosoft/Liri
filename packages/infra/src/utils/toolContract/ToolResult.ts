/**
 * 工具执行结果类型
 * 参考CC_CODE的ToolResult设计，适应backend现有架构
 */
import type { ToolResult as CoreToolResult } from '@openliri/kernel';

export enum ToolExecutionStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  PARTIAL = 'partial',
  /** 需要用户审批才能继续执行 */
  REQUIRES_APPROVAL = 'requires_approval',
}

/**
 * 文件操作结果基类型
 * 所有文件操作工具的 result 接口应包含这两个字段，
 * 以便前端始终能获取标准化后的绝对路径
 */
export interface FileOperationResult {
  /** 用户传入的原始路径 */
  filePath: string;
  /** 标准化后的绝对路径（经 path.resolve() 后的完整路径） */
  canonicalPath: string;
}

/**
 * 错误级别
 * 对标 OpenClaw result.errorLevel：区分错误严重程度，简化后续输出
 */
export enum ErrorLevel {
  /** 纠正型错误：用户可自行纠正，不需要重试 */
  RECOVERABLE = 'recoverable',
  /** 可重试错误：系统可自动重试 */
  RETRYABLE = 'retryable',
  /** 致命错误：需要终止执行 */
  FATAL = 'fatal',
}

/**
 * 工具失败分类（LRO-09，2026-10-26）——**单一事实源**。
 *
 * 落点选择（分层事实源 `scripts/modules-to-layers.json`）：`utils` = infra，`tools`（app）与
 * `session`（service）都可合法向下依赖它；`session/types/tool.ts` 的会话侧投影以 re-export
 * 复用同一份定义（不另立第二份联合，R02）。
 *
 * 由**生产者按结构化依据**写入，禁止解析 `error` 文本反推（CS02）。
 */
export type ToolFailureKind =
  /** 权限规则 / 审批拒绝（含 Inbox 不可用降级） */
  | 'permission_denied'
  /** 安全分析器 / PathGuard / 预处理拦截 */
  | 'safety_blocked'
  /** 依赖缺失、能力未就绪（如沙箱 helper 不可用） */
  | 'env_unavailable'
  /**
   * 会话工作区严格边界越界（B1，2026-10-30，issue #35）。
   *
   * **可恢复**：用户批准后目标可作为新根加入 `metadata.workspaceRoots` ⇒ 重发即通过。
   * 因此**不得**归入 `environment_blocked`（那会在 2 轮内熔断整轮，模型没有改错机会）。
   */
  | 'workspace_escape'
  /**
   * 会话工作区越界**且已提交「允许访问」审批申请**（2026-10-31，台账 §16）。
   *
   * 与 `workspace_escape` 的区别只有一点：此态下**用户侧有待办**，模型重试不会有不同结果，
   * 唯一出路是等审批落地后自动重试。故熔断分型把它判为**中性**（同 `aborted`：既不计数、
   * 也不清零），避免「等批准」把 `consecutiveInvalidTurns`（3 轮）烧完导致审批落地已无轮次可用。
   */
  | 'workspace_escape_pending_approval'
  /** 工具自身执行失败（可能可恢复） */
  | 'tool_error';

/**
 * 工具出参（**主契约**，工具执行层）
 *
 * 2026-09-30（P1-3 **B1 档**，spec `architecture-benchmark-20260928.md` §2.2）：
 * 原先此处把 7 个字段（`success` / `output` / `error` / `data` / `newMessages` /
 * `contextModifier` / `mcpMeta`）与 **core 层最小视图** `core/types.ts:46` **各写一份**
 * ⇒ 改为 **`extends` core 版**，消灭重声明（`tools → core` 为**合法下行**，且本文件
 * 原本就已从 `@modules/core` 引入 `Message` ⇒ **零新增跨层对**）。
 *
 * ⚠️ 连带收紧（有意为之）：core 版 `contextModifier` 是 `(context: unknown) => unknown`，
 * 原此处为 `any` ⇒ 继承后**变严**；实现侧若依赖上下文 `any` 需显式标注。
 *
 * ✅ 已收敛（P1-3 **B2 档**，2026-09-30 收口）：`result?` **并行载荷已删除** —— 写入侧 51 处
 * + 读取侧 5 处已全部迁移 / 收口至 `data`（逐批过程与「探针盲区」纪律见 spec §2.2.1）。
 *
 * ✅ 已收敛（P1-3 **B3-a 档**，2026-10-01）：`progress?: any[]` **死字段已删除**（取证：非空写入 0 处、
 * 全仓读取 0 处；**165** 个空数组写入点已清理，另有 **3** 处因「推断型返回值」盲区遗漏同期清理）。
 *
 * ⚠️ 未收敛：`output?`（core 基座，**JSON 载荷文本**）与 `content?`（本接口，**人类可读摘要**）
 * 存在**语义分工**，B3-b 结论为 **保留**（详见 spec §2.2.1）。
 *
 * ⚠️ **同名不同物**（全仓 4 处 `ToolResult`）：本处 = **工具 `execute()` 契约**（`extends` core 的协议层载荷）；
 * 另见 `session/types/tool.ts`（会话侧投影）· `runtime/api/CoreAPI.ts`（HTTP 门面 DTO）。
 * 依 `data-contract-unification` §9.2「**同名 ≠ 同物 ⇒ 一律不得看着像就合并**」⇒ **禁止互相合并/赋值**。
 */
export interface ToolResult<T = unknown> extends CoreToolResult<T> {
  status?: ToolExecutionStatus;
  executionTime?: number;
  errorOutput?: string;
  metadata?: Record<string, unknown>;
  executionId?: string;
  toolName?: string;
  timestamp?: number;
  content?: string;
  truncated?: boolean;
  /** 错误级别，用于区分错误严重程度 */
  errorLevel?: ErrorLevel;
  /** 是否需要用户审批（工具执行层标记，供 TAORLoop 检测） */
  requireApproval?: boolean;
  /** 审批原因描述 */
  approvalReason?: string;
  /**
   * 失败分类（LRO-09）：仅失败时有意义；缺省 = 未分类。
   * 由工具在**结构化拒绝**处写入（如 BashTool 预处理"禁止"分支 ⇒ `safety_blocked`）。
   */
  failureKind?: ToolFailureKind;
}

export function createToolResult<T = unknown>(
  data: T,
  options?: Partial<ToolResult<T>>
): ToolResult<T> {
  return {
    data,
    ...options,
  };
}
