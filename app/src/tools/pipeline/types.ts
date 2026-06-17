/**
 * 工具执行 Pipeline 类型定义
 *
 * 设计目标：将 ToolExecutor 中串行的 5 层管理器重构为按需组合的 Middleware 模式。
 * - 简单只读工具（read_file、grep 等）走快速通道：仅 Permission + 直接执行
 * - 写入/破坏性工具走完整通道：Permission + Governance + Sandbox + PostHooks
 * - 高危工具（Bash、PowerShell 等）额外挂载 Sandbox + Governance
 *
 * 参考优化方案 §2.2：引入 ToolMiddlewarePipeline，按工具标签声明所需中间件。
 */

import type { Tool } from '../types/Tool';
import type { ToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';

// ── Middleware 接口 ──────────────────────────────────────────────────

/** 中间件执行上下文：贯穿整个 Pipeline 的可变状态 */
export interface PipelineContext {
  /** 工具实例 */
  tool: Tool;
  /** 工具输入参数 */
  input: Record<string, unknown>;
  /** 工具使用上下文（sessionId、traceId 等） */
  toolUseContext: ToolUseContext;
  /** 工具调用唯一 ID */
  toolUseId: string;
  /** 开始时间戳 */
  startTime: number;
  /** 是否允许继续执行 */
  allowed: boolean;
  /** 阻止原因（当 allowed=false 时填充） */
  blockReason?: string;
  /** 元数据收集（中间件可追加） */
  metadata: Map<string, unknown>;
}

/** 中间件执行结果 */
export interface MiddlewareResult {
  /** 是否继续执行后续中间件 */
  continue: boolean;
  /** 错误信息（如果阻止执行） */
  error?: string;
  /** 工具结果（中间件可直接返回结果终止 Pipeline） */
  result?: ToolResult;
}

/** 单个中间件 */
export interface ToolMiddleware {
  /** 唯一名称，用于审计日志 */
  name: string;
  /** 执行前钩子（返回 false 终止 Pipeline） */
  before(ctx: PipelineContext): Promise<MiddlewareResult>;
  /** 执行后钩子（仅在 before 返回 continue=true 时调用） */
  after?(ctx: PipelineContext, result: ToolResult): Promise<void>;
}

// ── Pipeline Builder ─────────────────────────────────────────────────

/** 中间件注册条目 */
export interface MiddlewareEntry {
  middleware: ToolMiddleware;
  /** 所属中间件组（用于按组启用/禁用） */
  group: MiddlewareGroup;
  /** 是否必需（不可被跳过） */
  required: boolean;
}

/** 中间件组枚举 */
export enum MiddlewareGroup {
  /** 安全校验（performSecurityCheck） */
  SECURITY = 'security',
  /** 权限检查（PermissionManager） */
  PERMISSION = 'permission',
  /** 输入验证（validateInput） */
  VALIDATION = 'validation',
  /** 治理闭环（GovernanceManager） */
  GOVERNANCE = 'governance',
  /** 沙箱执行（SandboxManager） */
  SANDBOX = 'sandbox',
  /** 前置 Hook（ToolHookManager pre） */
  PRE_HOOK = 'pre_hook',
  /** 后置 Hook（ToolHookManager post） */
  POST_HOOK = 'post_hook',
  /** 审计日志 */
  AUDIT = 'audit',
}

/**
 * Pipeline 配置：声明工具应经过哪些中间件
 *
 * 路由规则（优先级从高到低）：
 * 1. 如果指定 middlewares 数组 → 显式列表
 * 2. 如果 tool.readOnly && !tool.destructive → 快速通道（仅 SECURITY + PERMISSION + VALIDATION）
 * 3. 否则 → 完整通道（所有中间件）
 */
export interface PipelineConfig {
  /** 显式声明所需中间件组（覆盖自动路由） */
  middlewares?: MiddlewareGroup[];
  /** 显式排除的中间件组 */
  exclude?: MiddlewareGroup[];
  /** 超时毫秒数 */
  timeoutMs?: number;
}

/** Pipeline 实例 */
export interface ToolPipeline {
  /** 执行工具 */
  execute(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    config?: PipelineConfig
  ): Promise<ToolResult>;
}

// ── 基准测试类型 ────────────────────────────────────────────────────

/** 单次执行记录 */
export interface ExecutionRecord {
  toolName: string;
  durationMs: number;
  path: 'fast' | 'full' | 'legacy';
  success: boolean;
  middlewareCount: number;
  timestamp: number;
}

/** 基准测试汇总 */
export interface BenchmarkSummary {
  totalExecutions: number;
  fastPathCount: number;
  fullPathCount: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  records: ExecutionRecord[];
}
