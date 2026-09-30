/**
 * 工具执行结果类型
 * 参考CC_CODE的ToolResult设计，适应backend现有架构
 */
import type { ToolResult as CoreToolResult } from '@modules/core';

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
 * ⚠️ 未收敛（后续档位）：`data?` 与 `result?` 两个**并行载荷**（B2）、两处 `any`
 * （`contextModifier` 已随继承收窄；`progress?: any[]` 待 B3）、`output?` 与 `content?` 并行（B3）。
 */
export interface ToolResult<T = unknown> extends CoreToolResult<T> {
  status?: ToolExecutionStatus;
  /**
   * ⚠️ **并行载荷（待收敛 → B2-c）**：与继承来的 `data?: T` 语义重叠。
   *
   * 2026-09-30（B2 收口尝试的**取证结论**）：把本字段移除后，`tsc` 枚举出 **61 处**残留
   * （**51 写 + 10 读**），跨 **31 个文件** —— `ai/interfaces/ToolExecutor.ts`×6 ·
   * `tools/services/ToolResultPersister.ts`×5 · `tools/AgentTool/*`×6 · `knowledge/tools/*`×12 ·
   * `memory/tools/*`×7 · `media/tools/*`×7（`MediaToolResult`）· `modules/calendar/*`×4 ·
   * `modules/mail/*`×1 · `tools/SkillTool/*`×5 · `tools/KnowledgeSaveTool`×2 ·
   * `core/Coordinator.ts`（读）等，**另含 3 个测试文件**（`tests/tools/knowledgeSaveTool` ·
   * `tests/skills/skillInjectionFix` · `tests/tools/AgentTool/swarmDescriptorResolution`）。
   * ⇒ **远超 B2-a 的"3 文件"** —— 那 3 个是「已接线 `outputSchema` 的 **23** 个工具」内的迁移面，
   * 与本口径（**全仓**）不同，**不可互相引用**。
   *
   * **故暂不删除**（此字段仍被 31 个文件读写）：迁移须**按模块分批**（每批 8–10 处，逐批
   * `typecheck` + **全量** `bun test`，并逐站点判"载荷语义"），见 spec
   * `architecture-benchmark-20260928.md` §2.2.1 的 **B2-c**。删除前的复现命令：
   * `cd app; bunx tsc --noEmit | Select-String 'error TS'`（**批次 3 后**：写入 **31** + 兼容读 4 + 测试断言 2 ≈ **37**）。
   * ⚠️ **探针盲区（B2-c 批次 3 实证）**：`tsc` 只对**有上下文标注**的对象字面量报「多余属性」；
   * 位于 `return (async () => {…})()` 等**推断型返回值**中的字面量**不会**被标出
   * （`KnowledgeSaveTool` 的成功分支即如此，**靠测试才发现**）⇒ 每批必须配
   * **grep 复核 + 全量 `bun test`**，不可只信探针计数（纪律 I）。
   */
  result?: T;
  executionTime?: number;
  errorOutput?: string;
  progress?: any[];
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
