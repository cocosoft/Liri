/**
 * 工具类型
 */
import type { ToolFailureKind } from '@modules/utils/toolContract/ToolResult';

export enum ToolType {
  /**
   * Bash工具
   */
  BASH = 'bash',

  /**
   * 文件工具
   */
  FILE = 'file',

  /**
   * 网络工具
   */
  NETWORK = 'network',

  /**
   * 系统工具
   */
  SYSTEM = 'system',

  /**
   * 自定义工具
   */
  CUSTOM = 'custom',
}

/**
 * 工具失败分类（LRO-09，设计见 `.trae/specs/circuit-breaker-classification.md §4.1`）
 *
 * **单一事实源在 `utils/toolContract/ToolResult.ts`**（infra 层：`tools`(app) 与 `session`(service)
 * 都可合法向下依赖）——此处 re-export，供会话侧投影与既有读取点沿用同一份联合（R02 不立第二份）。
 */
export type { ToolFailureKind };

/** 合法失败分类（P2-3 落盘侧校验：防把任意字符串当分类写进事件） */
const TOOL_FAILURE_KINDS: readonly string[] = [
  'permission_denied',
  'safety_blocked',
  'env_unavailable',
  'tool_error',
];

/** 类型守卫：`unknown` ⇒ `ToolFailureKind`（不合法 ⇒ false，调用方据此决定是否写键） */
export function isToolFailureKind(value: unknown): value is ToolFailureKind {
  return typeof value === 'string' && TOOL_FAILURE_KINDS.includes(value);
}

/**
 * 工具调用接口
 */
export interface ToolCall {
  /**
   * 工具调用ID
   */
  id: string;

  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具参数
   */
  arguments: Record<string, unknown>;

  /**
   * 工具类型
   */
  type?: ToolType;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 创建时间
   */
  createdAt?: Date;
}

/**
 * 获取工具调用名称的辅助函数
 * 兼容不同的工具调用结构
 */
export function getToolCallName(toolCall: {
  name?: string;
  function?: string;
}): string {
  return toolCall.name || toolCall.function || '';
}

/**
 * 工具使用接口
 */
export interface ToolUse {
  /**
   * 工具调用ID
   */
  id: string;

  /**
   * 工具名称
   */
  function: string;

  /**
   * 工具参数
   */
  arguments: Record<string, unknown>;

  /**
   * 工具类型
   */
  type?: ToolType;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 创建时间
   */
  createdAt?: Date;
}

/**
 * 工具集成接口
 */
export interface ToolIntegration {
  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  executeTool(toolCall: ToolCall): Promise<ToolResult>;
}

/**
 * 工具结果接口（**会话侧投影**：必填 `toolCallId`/`toolName`，另含 `sessionId`/`metadata`）。
 *
 * ⚠️ **同名不同物**（全仓 4 处 `ToolResult`）：本处 = 会话侧投影；另见 `core/types.ts`（协议层载荷）·
 * `utils/toolContract/ToolResult.ts`（工具 `execute()` 契约）· `runtime/api/CoreAPI.ts`（HTTP 门面 DTO）。
 * 依 `data-contract-unification` §9.2「**同名 ≠ 同物 ⇒ 一律不得看着像就合并**」⇒ **禁止互相合并/赋值**。
 */
export interface ToolResult {
  /**
   * 工具调用ID
   */
  toolCallId: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 工具执行结果
   */
  result?: unknown;

  /**
   * 工具执行错误
   */
  error?: string;

  /**
   * 失败分类（LRO-09）：由生产者按结构化依据写入（权限决策 / 安全门 / 沙箱探测），
   * 缺省 = 未分类。仅 `error` 存在时有意义。
   */
  failureKind?: ToolFailureKind;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据（含安全拦截标记等）
   */
  metadata?: Record<string, unknown>;
}
