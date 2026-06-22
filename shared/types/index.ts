/**
 * 共享类型定义
 *
 * Web (client/) 和 TUI (app/) 两端复用的核心类型。
 * 重点关注：Streaming 状态、工具调用状态、消息结构。
 */

// ============================================================
// Streaming 相关类型
// ============================================================

/** Stream 统计数据 */
export interface SharedStreamStats {
  startTime: number;
  tokenCount: number;
  currentSpeed: number;
}

/** Stream 状态枚举 */
export type SharedStreamState = "idle" | "streaming" | "paused" | "question" | "done";

// ============================================================
// 工具调用相关类型
// ============================================================

/** 工具调用信息 */
export interface SharedToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具调用执行状态 */
export interface SharedToolCallStatus {
  toolCallId: string;
  toolName: string;
  progress: number;
  message: string;
  status: "running" | "completed" | "failed";
}

// ============================================================
// 消息相关类型
// ============================================================

/** Token 消耗统计 */
export interface SharedTokenUsage {
  input: number;
  output: number;
  total: number;
  cacheRead?: number;
  cacheCreation?: number;
}
