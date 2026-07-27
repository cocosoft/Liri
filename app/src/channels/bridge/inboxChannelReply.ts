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
 * Inbox → 渠道 下行回传纯函数
 *
 * 当 Inbox 项被回复或过期时，将结果/通知回传给来源渠道。
 * 纯函数，无实例状态，通过 channelRegistry 获取对应通道的 OutboundAdapter。
 */

import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import type { InboxItem } from '@modules/runtime/InboxManager.js';
import { channelRegistry } from '../registry/ChannelRegistry';
import { channelBootstrapper } from '../bootstrap/ChannelBootstrapper';
import { isReplyEnabled } from '../setupChannels';

const logger = new Logger({ module: 'channels:inboxReply' });

/**
 * 将 Inbox 回复结果回传给渠道
 *
 * 根据渠道能力降级选择通知方式：
 *   InteractiveCard（按钮审批） > Markdown > 纯文本
 */
export async function relayReplyToChannel(inboxItem: InboxItem): Promise<void> {
  if (!isReplyEnabled()) {
    return;
  }

  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.relayReply', {
    'inbox.id': inboxItem.id,
    'inbox.channelId': inboxItem.channelId ?? 'unknown',
    'inbox.traceId': inboxItem.traceId ?? '',
  });

  try {
    if (!inboxItem.channelSessionId || !inboxItem.channelId) {
      logger.info('relayReplyToChannel: no channel reference, skipping', {
        inboxId: inboxItem.id,
      });
      otel.endSpan(span, SpanStatusCode.OK);
      return;
    }

    const channelName = inboxItem.channelId;
    const channel = channelRegistry.get(channelName);

    if (!channel) {
      logger.warn('relayReplyToChannel: channel not found', {
        channelName,
        inboxId: inboxItem.id,
      });
      otel.endSpan(span, SpanStatusCode.ERROR, 'channel_not_found');
      return;
    }

    // 查找对应的 IChannelPlugin 实例获取 OutboundAdapter
    const plugin = channelBootstrapper.getPluginInstance(channelName);
    const outbound = plugin?.outbound;

    const content = _formatReplyMessage(inboxItem);
    const target =
      inboxItem.channelConversationId ?? inboxItem.channelSessionId;

    if (!outbound) {
      // fallback: 使用 ChannelRegistry 的 sendMessage
      const regChannel = channelRegistry.get(channelName);
      if (!regChannel) {
        logger.warn('relayReplyToChannel: channel not found', {
          channelName,
          inboxId: inboxItem.id,
        });
        otel.endSpan(span, SpanStatusCode.ERROR, 'channel_not_found');
        return;
      }
      await regChannel.sendMessage(target, content);
    } else {
      // 优先使用 sendInteractive（支持按钮的渠道）
      if (typeof (outbound as any).sendInteractive === 'function') {
        await outbound.sendInteractive(target, {
          title: inboxItem.status === 'expired' ? '审批已过期' : '审批结果',
          content,
          color: inboxItem.reply === 'approve' ? 'green' : 'red',
        });
      } else if (typeof (outbound as any).sendMarkdown === 'function') {
        await (outbound as any).sendMarkdown(target, content);
      } else if (typeof outbound.sendText === 'function') {
        await outbound.sendText(target, content);
      } else {
        logger.warn('relayReplyToChannel: no usable outbound adapter', {
          channelName,
          inboxId: inboxItem.id,
        });
      }
    }

    logger.info('Inbox reply relayed to channel', {
      inboxId: inboxItem.id,
      channelName,
      status: inboxItem.status,
      traceId: inboxItem.traceId,
    });
    otel.endSpan(span, SpanStatusCode.OK);
  } catch (err) {
    // @ignore-catch: 回传失败不阻塞 Inbox 主流程
    // ── 指数退避重试 + 死信队列 ──
    const retryResult = await _retryWithBackoff(
      () => _sendWithAdapter(inboxItem),
      3,
      [1000, 4000, 15000]
    );

    if (!retryResult.success) {
      await _writeDeadLetter(inboxItem);
      logger.warn('Inbox reply dead-lettered after 3 retries', {
        inboxId: inboxItem.id,
        channelName: inboxItem.channelId,
      });
    }

    await handleError(err, {
      module: 'channels:inboxReply',
      action: 'relayReplyToChannel',
      context: { inboxId: inboxItem.id, channelName: inboxItem.channelId },
    });
    otel.recordError(span, err instanceof Error ? err : new Error(String(err)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(err));
  }
}

/**
 * 通知渠道：审批项已过期
 */
export async function notifyExpired(inboxItem: InboxItem): Promise<void> {
  if (!isReplyEnabled()) {
    return;
  }

  if (!inboxItem.channelSessionId || !inboxItem.channelId) {
    return;
  }

  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.notifyExpired', {
    'inbox.id': inboxItem.id,
    'inbox.channelId': inboxItem.channelId,
  });

  try {
    const channelName = inboxItem.channelId;
    const plugin = channelBootstrapper.getPluginInstance(channelName);
    const outbound = plugin?.outbound;
    const target =
      inboxItem.channelConversationId ?? inboxItem.channelSessionId;
    const message = `审批「${inboxItem.title}」已因超时而失效。`;

    if (outbound?.sendText) {
      await outbound.sendText(target, message);
    } else {
      const channel = channelRegistry.get(channelName);
      if (channel) {
        await channel.sendMessage(target, message);
      }
    }

    logger.info('Expired notification sent to channel', {
      inboxId: inboxItem.id,
      channelName,
      traceId: inboxItem.traceId,
    });
    otel.endSpan(span, SpanStatusCode.OK);
  } catch (err) {
    await handleError(err, {
      module: 'channels:inboxReply',
      action: 'notifyExpired',
      context: { inboxId: inboxItem.id, channelName: inboxItem.channelId },
    });
    otel.recordError(span, err instanceof Error ? err : new Error(String(err)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(err));
  }
}

/** 格式化审批回复消息 */
function _formatReplyMessage(inboxItem: InboxItem): string {
  const status = inboxItem.status === 'expired' ? '已过期' : '已完成';
  const verb =
    inboxItem.reply === 'approve'
      ? '已批准'
      : inboxItem.reply === 'reject'
        ? '已拒绝'
        : '已处理';

  let msg = `${verb}：${inboxItem.title}`;

  if (
    inboxItem.reply &&
    inboxItem.reply !== 'approve' &&
    inboxItem.reply !== 'reject'
  ) {
    msg += `\n回复：${inboxItem.reply}`;
  }

  if (inboxItem.traceId) {
    msg += `\n[trace: ${inboxItem.traceId}]`;
  }

  return msg;
}

// ─── 重试 + 死信机制 ───

async function _sendWithAdapter(inboxItem: InboxItem): Promise<boolean> {
  const channelName = inboxItem.channelId!;
  const plugin = channelBootstrapper.getPluginInstance(channelName);
  const outbound = plugin?.outbound;
  const target = inboxItem.channelConversationId ?? inboxItem.channelSessionId!;
  const content = _formatReplyMessage(inboxItem);

  if (outbound?.sendText) {
    const result = await outbound.sendText(target, content);
    return result.success;
  }
  const channel = channelRegistry.get(channelName);
  if (channel) {
    return await channel.sendMessage(target, content);
  }
  return false;
}

async function _retryWithBackoff(
  fn: () => Promise<boolean>,
  maxRetries: number,
  delays: number[]
): Promise<{ success: boolean }> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise((r) => setTimeout(r, delays[i] || 15000));
      const ok = await fn();
      if (ok) return { success: true };
    } catch {
      // continue to next retry
    }
  }
  return { success: false };
}

async function _writeDeadLetter(inboxItem: InboxItem): Promise<void> {
  try {
    const { resolveDbPath } = await import('@modules/core/paths');
    const { Database } = await import('@modules/core/external/sqlite3');
    const db = new Database(resolveDbPath());
    await new Promise<void>((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS inbox_reply_deadletter (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inbox_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          target TEXT NOT NULL,
          content TEXT NOT NULL,
          failed_at INTEGER NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 3
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO inbox_reply_deadletter (inbox_id, channel_name, target, content, failed_at) VALUES (?, ?, ?, ?, ?)`,
        [
          inboxItem.id,
          inboxItem.channelId ?? '',
          inboxItem.channelConversationId ?? inboxItem.channelSessionId ?? '',
          _formatReplyMessage(inboxItem),
          Date.now(),
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    db.close();
  } catch (err) {
    logger.warn('Failed to write dead letter', {
      inboxId: inboxItem.id,
      error: String(err),
    });
  }
}
