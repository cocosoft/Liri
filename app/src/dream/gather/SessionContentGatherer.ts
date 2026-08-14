// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * SessionContentGatherer — 会话内容采集器
 *
 * 扫描上次梦境以来的新会话，生成 SessionDigest 摘要，
 * 并按双通道策略读取会话内容（首 N 条 + 尾 N 条）。
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { resolveSessionsDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { SessionDigest } from '../types';

const logger = getLogger('dream:gather');

interface ReadSessionOpts {
  maxTokens?: number;
  strategy?: 'recent' | 'summary' | 'full';
}

export class SessionContentGatherer {
  /**
   * 扫描上次梦境以来的新会话
   * @param sinceMs 上次梦境完成时间戳
   * @param pendingDir 挂起会话目录（会话关闭时写入的标记文件）
   */
  async scanNewSessions(
    sinceMs: number,
    pendingDir?: string
  ): Promise<SessionDigest[]> {
    const sessionsDir = resolveSessionsDir();
    const digests: SessionDigest[] = [];
    const seen = new Set<string>();

    // 优先扫描 pending_sessions 目录
    if (pendingDir) {
      try {
        const pendingFiles = await readdir(pendingDir);
        for (const file of pendingFiles) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = await readFile(join(pendingDir, file), 'utf-8');
            const pending = JSON.parse(data);
            if (pending.sessionId) {
              seen.add(pending.sessionId);
            }
          } catch {
            /* skip corrupted */
            void handleError(new Error('读取挂起会话失败'), {
              module: 'dream:gather',
              action: 'readPendingSession',
            });
          }
        }
      } catch (err) {
        // 断点 8 修复（2026-08-14 第一轮报告）：pending 目录不存在（ENOENT）= 无挂起
        // 会话的正常情况，不报 error（原实现固定字符串"挂起目录不存在"刷 UNHANDLED_ERROR）；
        // 其余错误（权限等）保留原始 error 上下文
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
          void handleError(err, {
            module: 'dream:gather',
            action: 'readPendingDir',
          });
        }
      }
    }

    // 扫描 sessions 目录
    try {
      const sessionIds = await readdir(sessionsDir);
      for (const sessionId of sessionIds) {
        const sessionPath = join(sessionsDir, sessionId);
        try {
          const s = await stat(sessionPath);
          if (s.mtimeMs <= sinceMs && !seen.has(sessionId)) continue;

          const digest = await this.buildDigest(sessionId, sessionPath);
          if (digest) digests.push(digest);
        } catch {
          /* skip */
          void handleError(new Error('读取会话状态失败'), {
            module: 'dream:gather',
            action: 'statSession',
          });
        }
      }
    } catch (err) {
      // 断点 8 修复（2026-08-14 第一轮报告）：sessions 目录不存在（ENOENT）不报 error
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        void handleError(err, {
          module: 'dream:gather',
          action: 'readSessionsDir',
        });
      }
    }

    return digests;
  }

  /** 构建单个会话摘要 */
  private async buildDigest(
    sessionId: string,
    sessionPath: string
  ): Promise<SessionDigest | null> {
    try {
      const indexPath = join(sessionPath, 'index.json');
      const indexData = await readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexData);

      const digest: SessionDigest = {
        sessionId,
        title: index.title || sessionId,
        messageCount: index.messageCount || 0,
        firstMessageAt: index.createdAt || 0,
        lastMessageAt: index.updatedAt || Date.now(),
        hasToolCalls: false,
        hasCodeBlocks: false,
      };

      // 尝试读取消息 JSONL 检测工具调用和代码块
      const msgPath = join(sessionPath, 'messages.jsonl');
      try {
        const content = await readFile(msgPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.tool_calls || msg.toolCalls) {
              digest.hasToolCalls = true;
            }
            if (
              typeof msg.content === 'string' &&
              msg.content.includes('```')
            ) {
              digest.hasCodeBlocks = true;
            }
            if (digest.hasToolCalls && digest.hasCodeBlocks) break;
          } catch {
            /* skip malformed lines */
            void handleError(new Error('解析消息行失败'), {
              module: 'dream:gather',
              action: 'parseMessageLine',
            });
          }
        }
      } catch (err) {
        // 断点 8 修复（2026-08-14 第一轮报告）：消息文件不存在（ENOENT）= 空会话正常
        // 情况，不报 error；其余错误保留上下文
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
          void handleError(err, {
            module: 'dream:gather',
            action: 'readMessagesFile',
          });
        }
      }

      return digest;
    } catch {
      void handleError(new Error('构建摘要失败'), {
        module: 'dream:gather',
        action: 'buildDigest',
      });
      return null;
    }
  }

  /**
   * 读取指定会话的关键内容片段（双通道策略）
   * @param sessionId 会话 ID
   * @param opts 读取选项
   */
  async readSessionContent(
    sessionId: string,
    opts: ReadSessionOpts = {}
  ): Promise<string> {
    const sessionsDir = resolveSessionsDir();
    const sessionPath = join(sessionsDir, sessionId);
    const msgPath = join(sessionPath, 'messages.jsonl');

    try {
      const content = await readFile(msgPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const messages = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            void handleError(new Error('解析消息JSON失败'), {
              module: 'dream:gather',
              action: 'parseMessageJson',
            });
            return null;
          }
        })
        .filter((m): m is Record<string, unknown> => m !== null);

      if (messages.length === 0) return '';

      const strategy = opts.strategy || 'recent';
      const maxTokens = opts.maxTokens || 4096;

      if (strategy === 'full' || messages.length < 20) {
        return this.formatMessages(messages, maxTokens);
      }

      // 双通道策略：首 N 条 + 尾 N 条
      if (strategy === 'recent') {
        const headCount = Math.min(5, Math.floor(messages.length / 4));
        const tailCount = Math.min(10, Math.floor(messages.length / 2));
        const head = messages.slice(0, headCount);
        const tail = messages.slice(-tailCount);

        let result = '=== 对话开头 ===\n';
        result += this.formatMessages(head, Math.floor(maxTokens / 3));
        result += '\n=== ... (中间省略) ... ===\n';
        result += this.formatMessages(tail, Math.floor((maxTokens * 2) / 3));
        return result;
      }

      return this.formatMessages(messages.slice(-20), maxTokens);
    } catch {
      void handleError(new Error('读取会话内容失败'), {
        module: 'dream:gather',
        action: 'readSessionContent',
      });
      return '';
    }
  }

  /** 格式化消息为可读文本 */
  private formatMessages(
    messages: Record<string, unknown>[],
    maxTokens: number
  ): string {
    let result = '';
    let charCount = 0;
    const charLimit = maxTokens * 3; // rough estimate: 1 token ≈ 3 chars

    for (const msg of messages) {
      const role = msg.role || 'unknown';
      let content = '';

      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ text?: string }>)
          .map((c) => c.text || '')
          .join('\n');
      } else {
        content = JSON.stringify(msg.content);
      }

      const line = `[${role}] ${content}\n`;
      if (charCount + line.length > charLimit) {
        result += `[${role}] ... (truncated)\n`;
        break;
      }
      result += line;
      charCount += line.length;
    }

    return result;
  }
}
