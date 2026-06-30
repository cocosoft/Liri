// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session State Hydrator
 *
 * 对标 BA_REF sessionRestore.ts，加载会话时从 transcript 中恢复衍生状态。
 * 让 Agent 重新进入已有会话时能恢复到上次中断的上下文。
 *
 * 恢复内容：
 * 1. Todo 状态 — 从最后一条 create_task_list 工具调用中提取
 * 2. 文件变更记录 — 从 file_write/file_edit 工具调用中提取
 * 3. 上下文摘要 — 从消息中提取最近的决策记录
 */

import type { ChatSession } from '../../chat/types/session';
import type { Message } from '../../chat/types/message';

// ============================================================================
// 类型定义
// ============================================================================

export interface HydratedState {
  /** 恢复的 todo 列表 */
  todos?: Record<string, unknown>[];
  /** 最近操作的文件路径列表 */
  recentFiles: string[];
  /** 最近的用户决策摘要 */
  recentDecisions: string[];
}

// ============================================================================
// SessionStateHydrator
// ============================================================================

export class SessionStateHydrator {
  /**
   * 从会话消息中恢复衍生状态
   */
  hydrate(session: ChatSession): HydratedState {
    const messages = session.messages || [];
    return {
      todos: this.extractTodos(messages),
      recentFiles: this.extractRecentFiles(messages),
      recentDecisions: this.extractDecisions(messages),
    };
  }

  // ── 1. Todo 恢复 ──

  /**
   * 从消息中倒查最后一条 create_task_list 工具调用的结果
   */
  private extractTodos(
    messages: Message[]
  ): Record<string, unknown>[] | undefined {
    // 倒序查找最近的任务列表工具调用结果
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'tool') continue;

      const metadata = msg.metadata as Record<string, unknown> | undefined;
      const toolName = metadata?.toolName || metadata?.tool_name || '';
      if (toolName !== 'create_task_list' && toolName !== 'tasklist_write') {
        continue;
      }

      // 解析工具结果中的 todos
      const result = this.parseToolResult(msg.content);
      if (result?.todos && Array.isArray(result.todos)) {
        return result.todos as Record<string, unknown>[];
      }
    }
    return undefined;
  }

  // ── 2. 文件变更记录 ──

  /**
   * 从最近 20 条消息中提取被操作的文件路径
   */
  private extractRecentFiles(messages: Message[]): string[] {
    const recent = messages.slice(-20);
    const files = new Set<string>();

    for (const msg of recent) {
      if (msg.role !== 'tool') continue;
      const metadata = msg.metadata as Record<string, unknown> | undefined;
      const toolName = (metadata?.toolName ||
        metadata?.tool_name ||
        '') as string;

      // 文件写/编辑工具
      if (
        toolName === 'file_write' ||
        toolName === 'file_edit' ||
        toolName === 'write_to_file' ||
        toolName === 'replace_in_file'
      ) {
        const filePath = this.extractFilePath(msg.content);
        if (filePath) files.add(filePath);
      }
    }

    return [...files];
  }

  // ── 3. 决策恢复 ──

  /**
   * 从最近用户消息中提取短决策（<200 字符的 user 消息通常是决策）
   */
  private extractDecisions(messages: Message[]): string[] {
    const decisions: string[] = [];
    const recentUserMessages = messages
      .filter((m) => m.role === 'user')
      .slice(-8);

    for (const msg of recentUserMessages) {
      const content = typeof msg.content === 'string' ? msg.content.trim() : '';
      // 短消息（<200 字符）通常是指令/决策
      if (content.length > 0 && content.length < 200) {
        decisions.push(content);
      }
    }

    return decisions;
  }

  // ── 辅助方法 ──

  /**
   * 从工具结果内容中解析文件路径
   */
  private extractFilePath(
    content: string | Array<{ type: string; text?: string; value?: unknown }>
  ): string | null {
    // string 类型：尝试 JSON 解析
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        const path =
          parsed.file_path || parsed.filePath || parsed.path || parsed.file;
        if (typeof path === 'string') return path;
      } catch {
        // 非 JSON，尝试正则提取常见路径模式
        const match = content.match(
          /(?:file_path|filePath|path|file)[:\s]+["']?([^\s"',}\n]+)["']?/i
        );
        if (match) return match[1];
      }
      return null;
    }

    // 数组类型：查找 text block
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            const path = parsed.file_path || parsed.filePath || parsed.path;
            if (typeof path === 'string') return path;
          } catch {
            // ignore
          }
        }
      }
    }

    return null;
  }

  /**
   * 解析工具结果（可能是 JSON 字符串或结构化对象）
   */
  private parseToolResult(
    content: string | Array<{ type: string; text?: string; value?: unknown }>
  ): Record<string, unknown> | null {
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    }

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          try {
            return JSON.parse(block.text);
          } catch {
            // ignore
          }
        }
        if (block.value) {
          return block.value as Record<string, unknown>;
        }
      }
    }

    return null;
  }
}
