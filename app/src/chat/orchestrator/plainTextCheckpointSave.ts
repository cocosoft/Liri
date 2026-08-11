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
 * plainTextCheckpointSave — 普通对话轻量检查点保存辅助（streamMessageFlow 拆分）
 *
 * R04-001 治理：将主触发点（无工具调用）与兜底触发点（finally 块）两段
 * PlainTextCheckpoint 保存逻辑抽离，streamMessageFlow 内仅保留一行调用。
 */

import { getLogger } from '@modules/monitoring';
import { PlainTextCheckpoint } from '../services/PlainTextCheckpoint.js';
import { isCheckpointLogEnabled } from '../../config/settings/CheckpointLogConfig';
import type { ChatSession } from '../types/session.js';
import type { ParsedToolCall } from '@modules/ai';

const logger = getLogger('chat:streamFlow');

export interface PlainTextCheckpointSaveParams {
  checkpoint: PlainTextCheckpoint;
  session: ChatSession;
  /** 触发点标识：main=主触发点 / fallback=finally 兜底 */
  trigger: 'main' | 'fallback';
  /** 无工具调用的 finishReason（主触发点日志） */
  finishReason?: string;
  /** 累计输出内容长度（主触发点日志） */
  contentLength?: number;
  /** 本轮工具调用（有工具调用时主触发点跳过保存） */
  toolCalls?: ParsedToolCall[];
}

/**
 * 保存普通对话轻量检查点（fire-and-forget，失败仅 warn 不阻断主流程）
 *
 * 主触发点：无工具调用时保存；有工具调用时仅记录 debug 日志。
 * 兜底触发点：finally 块无条件保存（消息数未变时 PlainTextCheckpoint 内部跳过）。
 */
export function savePlainTextCheckpoint(
  params: PlainTextCheckpointSaveParams
): void {
  const {
    checkpoint,
    session,
    trigger,
    finishReason,
    contentLength,
    toolCalls,
  } = params;
  const isMain = trigger === 'main';

  if (isMain && toolCalls && toolCalls.length > 0) {
    if (isCheckpointLogEnabled()) {
      logger.debug('PlainTextCheckpoint: 主触发点 — 跳过（有工具调用）', {
        sessionId: session.id,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((tc: ParsedToolCall) => tc.name),
      });
    }
    return;
  }

  const msgCount = session.messages.length;
  if (isCheckpointLogEnabled()) {
    if (isMain) {
      logger.info('PlainTextCheckpoint: 主触发点 — 无工具调用的纯文本对话', {
        sessionId: session.id,
        messageCount: msgCount,
        finishReason: finishReason ?? 'unknown',
        contentLength: contentLength ?? 0,
      });
    } else {
      logger.debug('PlainTextCheckpoint: 兜底触发点 — finally 块', {
        sessionId: session.id,
        messageCount: msgCount,
      });
    }
  }

  checkpoint
    .save(session.messages, session.metadata, session.state)
    .then((cp) => {
      if (isCheckpointLogEnabled()) {
        if (cp) {
          logger.info(
            `PlainTextCheckpoint: ${isMain ? '主触发点' : '兜底触发点'} — 检查点已保存`,
            {
              sessionId: session.id,
              checkpointId: cp.id,
              messageCount: msgCount,
            }
          );
        } else {
          logger.debug(
            `PlainTextCheckpoint: ${isMain ? '主触发点' : '兜底触发点'} — 消息数未变，跳过${
              isMain ? '' : '（主触发点已保存）'
            }`,
            { sessionId: session.id, messageCount: msgCount }
          );
        }
      }
    })
    .catch((err) => {
      logger.warn(
        `PlainTextCheckpoint: ${isMain ? '主触发点' : '兜底触发点'} — 保存失败（非关键）`,
        {
          sessionId: session.id,
          error: String(err),
        }
      );
    });
}
