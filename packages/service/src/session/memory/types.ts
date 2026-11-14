// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话记忆类型契约
 *
 * T-①07（A5 记忆分层收敛）T1-7 后续 · 类型下沉：这三个类型原先声明在
 * `SessionMemoryManager.ts`（实现模块）内，导致 `SessionMemoryPort.ts`（端口）需
 * `import type` **回指实现模块**。本文件把它们下沉为独立模块 ⇒ 端口与实现
 * **共同依赖**本文件，端口不再依赖实现（消除"端口 → 实现"的类型方向倒挂）。
 *
 * 消费方：`SessionMemoryManager.ts`（实现）· `SessionMemoryPort.ts`（端口）。
 */

/** 记忆项（结构化） */
export interface MemoryItem {
  type:
    | 'discussion'
    | 'decision'
    | 'file_change'
    | 'code_reference'
    | 'todo'
    | 'session_summary';
  content: string;
}

/** 记忆文件内容结构 */
export interface SessionMemory {
  /** 会话 ID */
  sessionId: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 累计处理的 token 数 */
  processedTokens: number;
  /** 累计工具调用次数 */
  processedToolCalls: number;
  /** 记忆项列表 */
  items: MemoryItem[];
}

/** 提炼输入 */
export interface ExtractionInput {
  /** 用户消息内容 */
  userMessage: string;
  /** 助手回复内容 */
  assistantResponse: string;
  /** 本轮消耗的 token 数 */
  tokens: number;
  /** 本轮工具调用次数 */
  toolCalls: number;
}
