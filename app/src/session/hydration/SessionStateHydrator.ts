// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session State Hydrator
 *
 * 对标 BA_REF sessionRestore.ts，加载会话时从 transcript 中恢复衍生状态。
 * 让 Agent 重新进入已有会话时能恢复到上次中断的上下文。
 *
 * 恢复内容：
 * 1. 文件变更记录 — 从 file_write/file_edit 工具调用中提取
 * 2. 上下文摘要 — 从消息中提取最近的决策记录
 *
 * ⚠️ 沿革（2026-09-29，台账「c2」处置）：原第 1 项「Todo 状态恢复」（`extractTodos`：扫
 * `create_task_list` / `tasklist_write` 的工具消息、要求其内容含 `todos` 数组）经**端到端实测
 * 证实永不命中** —— ① 该工具出口**从无 `todos` 字段**（纯文本时期与对象化后皆无；对照实验证明
 * 只有 `{"todos":[…]}` 形状才会命中）；② `tasklist_write` **全仓仅出现在该判断里**（无生产者）；
 * ③ `NoteTask` 由 `TaskRegistry` **自身持久化**（`registerNoteTask → saveTasks()`）⇒ 即便命中
 * 也与注册表恢复**重复**。故连同其专属辅助 `parseToolResult`（零其他调用方）一并删除。
 */

import type { ChatSession } from '@modules/session/types/session';
import type { Message } from '@modules/session/types/message';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:hydration:SessionStateHydrator');

// ============================================================================
// 类型定义
// ============================================================================

export interface HydratedState {
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
      recentFiles: this.extractRecentFiles(messages),
      recentDecisions: this.extractDecisions(messages),
    };
  }

  // ── 1. 文件变更记录 ──

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

  // ── 2. 决策恢复 ──

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
            // B12 修复：预期内失败（普通文本不是 JSON）静默忽略，不上报 error——
            // 与 string 分支（:143-157）行为对齐，避免每次加载会话刷 error 日志。
          }
        }
      }
    }

    return null;
  }
}
