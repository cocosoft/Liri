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

import { getLogger } from '@openliri/infra/monitoring';
import { getOTelTracing } from '@openliri/infra/monitoring/otel/OTelTracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@openliri/infra/error';
import { withRetry, RetryableError } from '@openliri/infra/utils/withRetry';
import type { InboxItem } from '@modules/runtime/InboxManager.js';
// 仅类型：sqlite 连接在 `_writeDeadLetter` 里**动态** import（不进启动面），类型用擦除式导入
import type { Database } from '@openliri/infra/external';
import { channelRegistry } from '../registry/ChannelRegistry';
import { channelBootstrapper } from '../bootstrap/ChannelBootstrapper';
import { isReplyEnabled } from '../setupChannels';

const logger = getLogger('channels:inboxReply');

/**
 * P38-b-2（2026-11-02）：影子队列的**注入端口**。
 *
 * `channels` 属 service 层，`tasks/effects` 属 app 层 ⇒ 不得反向 import（R00-001）。
 * 由宿主（`bootstrap/pipeline` 的 domain_init）在启动期注入；未注入 ⇒ 不写影子（零行为）。
 */
export type ReplyShadowPort = (input: {
  inboxItemId: string;
  channelId: string;
  channelSessionId?: string;
  conversationId?: string;
  reply?: string;
  /** 真实投递是否成功（含内部重试成功后成功的场景） */
  delivered: boolean;
}) => void | Promise<void>;

let replyShadowPort: ReplyShadowPort | null = null;

/** 注入/复位影子端口（宿主启动期调用一次；`null` ⇒ 关闭影子写） */
export function setReplyShadowPort(port: ReplyShadowPort | null): void {
  replyShadowPort = port;
}

/** 通知影子端口（异常只 warn：对照数据缺失不得影响真实回传） */
async function notifyReplyShadow(
  input: Parameters<ReplyShadowPort>[0]
): Promise<void> {
  if (!replyShadowPort) return;
  try {
    await replyShadowPort(input);
  } catch (err) {
    // @ignore-catch: 影子写失败不得影响真实回传（CS03）
    logger.warn('reply shadow port failed', {
      inboxItemId: input.inboxItemId,
      error: String(err),
    });
  }
}

/** 死信写入用的连接类型别名（`Database` 运行时是按需加载的） */
type DatabaseConnection = Database;

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
  /** 真实投递结果（影子对照的 `real` 侧；只有实际发出才可能为 true） */
  let delivered = false;

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
      delivered = true;
    } else {
      let sent = false;

      // 优先使用 sendInteractive（支持按钮的渠道），失败时降级到 sendMarkdown → sendText
      if (
        typeof (outbound as unknown as Record<string, Function>)
          .sendInteractive === 'function'
      ) {
        try {
          await outbound.sendInteractive(target, {
            title: inboxItem.status === 'expired' ? '审批已过期' : '审批结果',
            content,
            color: inboxItem.reply === 'approve' ? 'green' : 'red',
          });
          sent = true;
        } catch (e) {
          logger.warn('sendInteractive 失败，降级到 sendMarkdown/sendText', {
            channelName,
            inboxId: inboxItem.id,
            error: String(e),
          });
        }
      }
      if (
        !sent &&
        typeof (outbound as unknown as Record<string, Function>)
          .sendMarkdown === 'function'
      ) {
        try {
          await (outbound as unknown as Record<string, Function>).sendMarkdown(
            target,
            content
          );
          sent = true;
        } catch (e) {
          logger.warn('sendMarkdown 失败，降级到 sendText', {
            channelName,
            inboxId: inboxItem.id,
            error: String(e),
          });
        }
      }
      if (!sent && typeof outbound.sendText === 'function') {
        await outbound.sendText(target, content);
        sent = true;
      }
      if (!sent) {
        logger.warn('relayReplyToChannel: no usable outbound adapter', {
          channelName,
          inboxId: inboxItem.id,
        });
      }
      delivered = sent;
    }

    logger.info('Inbox reply relayed to channel', {
      inboxId: inboxItem.id,
      channelName,
      status: inboxItem.status,
      traceId: inboxItem.traceId,
    });
    otel.endSpan(span, SpanStatusCode.OK);
    // P38-b-2 影子对照：只写队列、不派发；异常在端口内吞掉（不影响真实回传）
    await notifyReplyShadow({
      inboxItemId: inboxItem.id,
      channelId: channelName,
      channelSessionId: inboxItem.channelSessionId,
      conversationId: inboxItem.channelConversationId,
      reply: inboxItem.reply,
      delivered,
    });
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
      await handleError(err, {
        module: 'channels:inboxReply',
        action: 'relayReplyToChannel',
        context: { inboxId: inboxItem.id, channelName: inboxItem.channelId },
      });
      logger.warn('Inbox reply dead-lettered after 3 retries', {
        inboxId: inboxItem.id,
        channelName: inboxItem.channelId,
      });
    }
    // P38-b-2 影子对照（含重试成功的情形）：只写队列、不派发
    await notifyReplyShadow({
      inboxItemId: inboxItem.id,
      channelId: inboxItem.channelId ?? 'unknown',
      channelSessionId: inboxItem.channelSessionId,
      conversationId: inboxItem.channelConversationId,
      reply: inboxItem.reply,
      delivered: retryResult.success,
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
  // KB-R01-RETRY（2026-08-29）：自建 for 循环重试 → withRetry 标准实现。
  // fn 返回 false（发送失败）时抛 RetryableError → isRetryableError 命中重试；
  // 退避对齐原 delays 序列（首延迟 delays[0]，封顶末位 delays[last]）。
  try {
    await withRetry(
      async () => {
        const ok = await fn();
        if (!ok) throw new RetryableError('send failed');
      },
      {
        maxRetries: maxRetries - 1,
        initialDelayMs: delays[0] ?? 1000,
        backoffMultiplier: 2,
        maxDelayMs: delays[delays.length - 1] ?? 15000,
      }
    );
    return { success: true };
  } catch {
    return { success: false };
  }
}

async function _writeDeadLetter(inboxItem: InboxItem): Promise<void> {
  // 每次写死信都新开连接 ⇒ 用 finally 保证关掉：原来只在成功路径 `db.close()`，
  // DDL/INSERT 抛错时连接与分区 `app.db` 句柄会残留（Windows 上让删租户目录 `blocked`）。
  // 运行时仍是动态 import；`import type` 只在编译期取类型（擦除后无静态依赖）。
  let db: DatabaseConnection | null = null;
  try {
    const { resolveTenantDbPath } = await import('@openliri/infra/environment');
    const { Database } = await import('@openliri/infra/external');
    const { getRequestPrincipalKey } =
      await import('@openliri/kernel/identity/requestScope.js');
    // 租户级库（基础设施专项 §6.1）：死信表随请求身份落库（通道后台路径 ⇒ 本地共享库）
    const ownerKey = getRequestPrincipalKey();
    db = new Database(resolveTenantDbPath());
    await new Promise<void>((resolve, reject) => {
      db!.run(
        `CREATE TABLE IF NOT EXISTS inbox_reply_deadletter (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inbox_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          target TEXT NOT NULL,
          content TEXT NOT NULL,
          failed_at INTEGER NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 3,
          owner_key TEXT NOT NULL DEFAULT 'local:local'
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    // 旧库（单身份）补列：无回调会被兼容层静默吞错 ⇒ 带回调，只对非重复列告警
    await new Promise<void>((resolve) => {
      db!.run(
        `ALTER TABLE inbox_reply_deadletter ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => {
          if (err && !/duplicate column/i.test(err.message)) {
            logger.warn('inbox_reply_deadletter 补 owner_key 列失败', {
              error: err.message,
            });
          }
          resolve();
        }
      );
    });
    await new Promise<void>((resolve, reject) => {
      db!.run(
        `INSERT INTO inbox_reply_deadletter (inbox_id, channel_name, target, content, failed_at, owner_key) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          inboxItem.id,
          inboxItem.channelId ?? '',
          inboxItem.channelConversationId ?? inboxItem.channelSessionId ?? '',
          _formatReplyMessage(inboxItem),
          Date.now(),
          ownerKey,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  } catch (err) {
    logger.warn('Failed to write dead letter', {
      inboxId: inboxItem.id,
      error: String(err),
    });
  } finally {
    try {
      db?.close();
    } catch {
      // 已关闭 / 关闭中：忽略
    }
  }
}
