/**
 * inboundEvents.ts — QQ 入站事件处理族
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §41）：**只搬不改**（含全部原注释与
 * 日志文案）——`this.` 引用改为 `this.deps.`（宿主经 `deps` 注入同一实例/回调），
 * 取值与语义不变。
 *
 * 覆盖 4 类入站事件（`AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` /
 * `GROUP_AT_MESSAGE_CREATE` / `DIRECT_MESSAGE_CREATE`）+ 富媒体附件下载注册。
 * ⚠️ 当前 `handleDispatch` **仅派发 C2C 私聊**（其余三类为 BYPASS 注释态，预存行为），
 * 本模块按原样保留全部四类处理函数。
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { MessageContext } from '@modules/channels/types';
import type {
  RegisterFileInput,
  RegisterFileResult,
} from '@modules/services/file/types';
import type { QQDedupGuard } from './dedupGuard';
import type { QQPassiveReplyTracker } from './passiveReplyTracker';
import type {
  QQAtMessageCreatePayload,
  QQAttachment,
  QQC2cMessageCreatePayload,
  QQGroupAtMessageCreatePayload,
  QQDirectMessageCreatePayload,
} from './types';

/** QQ 提及正则（@bot） */
const MENTION_PATTERN = /<@!\d+>/g;

/**
 * 宿主注入依赖：状态簇为**同一实例**（保日志 module 字段与去重/被动回复状态一致），
 * `handleIncomingMessage` / `handleInboundFile` 为 `BaseChannelPlugin` 的 protected 方法
 * ⇒ 以回调形式注入（避免反向 import 宿主）。
 */
export interface QQInboundDeps {
  logger: Logger;
  dedupGuard: QQDedupGuard;
  passiveReply: QQPassiveReplyTracker;
  handleIncomingMessage: (message: MessageContext) => Promise<void>;
  handleInboundFile: (
    input: Omit<RegisterFileInput, 'source'> & {
      source?: RegisterFileInput['source'];
    }
  ) => Promise<RegisterFileResult>;
}

export class QQInboundEvents {
  constructor(private readonly deps: QQInboundDeps) {}

  /**
   * 处理 AT_MESSAGE_CREATE 事件（频道内 @机器人 的消息）
   */
  handleAtMessageCreate(data: QQAtMessageCreatePayload): void {
    if (this.deps.dedupGuard.isDuplicate(data.id)) {
      this.deps.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    const cleanContent = data.content.replace(MENTION_PATTERN, '').trim();

    // 跨事件去重
    if (
      this.deps.dedupGuard.isCrossEventDuplicate(
        cleanContent || data.content,
        data.author.id
      )
    ) {
      this.deps.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 跨事件去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    // 内容级去重兜底（纯内容哈希，不依赖 senderId）
    if (this.deps.dedupGuard.isContentDuplicate(cleanContent || data.content)) {
      this.deps.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 内容级去重已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.deps.logger.info('[TRACE] QQ AT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      senderName: data.author.username,
      content: cleanContent.slice(0, 100),
      guildId: data.guild_id,
      channelId: data.channel_id,
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.guild_id,
      conversationId: data.channel_id,
      messageId: data.id,
      messageType: 'text',
      content: cleanContent || data.content,
      timestamp: Date.now(),
      isDirectMessage: false,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.deps.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'AT_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 处理 C2C_MESSAGE_CREATE 事件（用户私聊消息）
   * conversationId 格式: "c2c:{openid}"，用于后续出站路由到 /v2/users/{openid}/messages
   */
  async handleC2cMessageCreate(data: QQC2cMessageCreatePayload): Promise<void> {
    if (this.deps.dedupGuard.isDuplicate(data.id)) {
      this.deps.logger.info('[TRACE] QQ C2C_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.deps.logger.info('[TRACE] QQ C2C_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      content: data.content.slice(0, 100),
      isDirectMessage: true,
      attachmentCount: data.attachments?.length ?? 0,
    });

    // 富媒体附件（2026-08-20 spec qq-file-transfer）：下载注册 FileRegistry，
    // await 完成使 AI 处理时文件已落盘、提示文本可携带真实保存路径
    let content = data.content;
    let messageType: MessageContext['messageType'] = 'text';
    const media = this.pickMediaAttachment(data.attachments);
    if (media) {
      const attachmentKind = media.content_type === 1 ? '图片' : '文件';
      messageType = media.content_type === 1 ? 'image' : 'file';
      const filename = media.filename || `qq_attachment_${data.id}`;
      if (media.url) {
        try {
          const saved = await this.downloadQQAttachment(media, data.id);
          content =
            (data.content ? `${data.content}\n` : '') +
            `[用户发送了${attachmentKind}: ${filename}` +
            (media.size ? ` (${media.size}字节)` : '') +
            `，已保存到 ${saved}，可用 file_read 读取]`;
        } catch (dlErr) {
          await handleError(dlErr, {
            module: 'channels:qq',
            action: 'QQ附件下载失败',
            context: { messageId: data.id, filename },
          });
          content = `[用户发送了${attachmentKind}: ${filename}，但下载失败，请告知用户重发]`;
        }
      } else {
        content = `[用户发送了${attachmentKind}: ${filename}，但事件未携带下载链接]`;
      }
    }

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      conversationId: `c2c:${data.author.id}`,
      messageId: data.id,
      messageType,
      content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    // AC-5：记录被动回复上下文（5 分钟窗口内出站携带 msg_id/msg_seq）
    this.deps.passiveReply.recordPassiveReplyContext(
      `c2c:${data.author.id}`,
      data.id
    );

    this.deps.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'C2C_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 从附件列表中取第一个富媒体附件（图片/视频/语音/文件）
   * QQ 事件约定：文本附件不携带 url，富媒体附件才有 CDN 临时链接
   */
  pickMediaAttachment(
    attachments: QQAttachment[] | undefined
  ): QQAttachment | undefined {
    return attachments?.find((a) => a.content_type >= 1 && a.content_type <= 4);
  }

  /**
   * 下载 QQ CDN 附件并注册到 FileRegistry（2026-08-20 spec qq-file-transfer）
   * CDN URL 有时效（分钟级），须在收到事件后立即调用
   *
   * @returns FileRegistry 保存路径（供 AI file_read）
   */
  private async downloadQQAttachment(
    attachment: QQAttachment,
    messageId: string
  ): Promise<string> {
    if (!attachment.url) {
      throw new Error('附件缺少下载 URL');
    }
    const filename = attachment.filename || `qq_attachment_${messageId}`;

    this.deps.logger.info('[TRACE] QQ 附件下载开始', {
      messageId,
      filename,
      size: attachment.size,
      contentType: attachment.content_type,
    });

    const resp = await fetch(attachment.url);
    if (!resp.ok) {
      throw new Error(`附件下载失败: HTTP ${resp.status}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    const result = await this.deps.handleInboundFile({
      originalName: filename,
      content: buffer,
      sourceId: messageId,
      mimeType: resp.headers.get('content-type') || undefined,
      description: 'QQ 通道入站附件',
    });

    this.deps.logger.info('[TRACE] QQ 附件下载注册完成', {
      messageId,
      filename,
      savedPath: result.savedPath,
      bytes: buffer.length,
      action: result.action,
    });
    return result.savedPath;
  }

  /**
   * 处理 GROUP_AT_MESSAGE_CREATE 事件（群聊 @机器人 的消息）
   * conversationId 格式: "group:{group_openid}"，用于后续出站路由到 /v2/groups/{group_openid}/messages
   */
  handleGroupAtMessageCreate(data: QQGroupAtMessageCreatePayload): void {
    if (this.deps.dedupGuard.isDuplicate(data.id)) {
      this.deps.logger.info(
        '[TRACE] QQ GROUP_AT_MESSAGE_CREATE 重复消息已跳过',
        {
          messageId: data.id,
        }
      );
      return;
    }

    const cleanContent = data.content.replace(MENTION_PATTERN, '').trim();

    // 跨事件去重
    if (
      this.deps.dedupGuard.isCrossEventDuplicate(
        cleanContent || data.content,
        data.author.id
      )
    ) {
      this.deps.logger.info(
        '[TRACE] QQ GROUP_AT_MESSAGE_CREATE 跨事件去重已跳过',
        {
          messageId: data.id,
        }
      );
      return;
    }

    // 内容级去重兜底（纯内容哈希，不依赖 senderId）
    if (this.deps.dedupGuard.isContentDuplicate(cleanContent || data.content)) {
      this.deps.logger.info(
        '[TRACE] QQ GROUP_AT_MESSAGE_CREATE 内容级去重已跳过',
        {
          messageId: data.id,
        }
      );
      return;
    }

    this.deps.logger.info('[TRACE] QQ GROUP_AT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      groupOpenid: data.group_openid,
      content: cleanContent.slice(0, 100),
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.group_openid,
      conversationId: `group:${data.group_openid}`,
      messageId: data.id,
      messageType: 'text',
      content: cleanContent || data.content,
      timestamp: Date.now(),
      isDirectMessage: false,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    // AC-5：记录被动回复上下文（5 分钟窗口内出站携带 msg_id/msg_seq）
    this.deps.passiveReply.recordPassiveReplyContext(
      `group:${data.group_openid}`,
      data.id
    );

    this.deps.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'GROUP_AT_MESSAGE_CREATE 处理异常',
      });
    });
  }

  /**
   * 处理 DIRECT_MESSAGE_CREATE 事件（频道私信）
   */
  handleDirectMessageCreate(data: QQDirectMessageCreatePayload): void {
    if (this.deps.dedupGuard.isDuplicate(data.id)) {
      this.deps.logger.info('[TRACE] QQ DIRECT_MESSAGE_CREATE 重复消息已跳过', {
        messageId: data.id,
      });
      return;
    }

    this.deps.logger.info('[TRACE] QQ DIRECT_MESSAGE_CREATE 开始处理', {
      messageId: data.id,
      senderId: data.author.id,
      guildId: data.guild_id,
      content: data.content.slice(0, 100),
    });

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.guild_id,
      conversationId: `c2c:${data.author.id}`,
      messageId: data.id,
      messageType: 'text',
      content: data.content,
      timestamp: Date.now(),
      isDirectMessage: true,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.deps.handleIncomingMessage(message).catch((error) => {
      handleError(error, {
        module: 'channels:qq',
        action: 'DIRECT_MESSAGE_CREATE 处理异常',
      });
    });
  }
}
