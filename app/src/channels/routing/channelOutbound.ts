// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 渠道出站投递（自 `messageRouter.ts` **内聚抽取**，2026-10-09 C3-S3）。
// 语义逐字不变：文本出站失败**仍抛出**（由调用方外层 catch 承接）；文件出站失败不抛错。

import { getLogger } from '@modules/monitoring';
import { messageTraceBuffer } from '../monitoring/MessageTraceBuffer';
import { sendOutboundFiles } from './outboundFileRouter';

const logger = getLogger('channels:routing');

export interface ChannelOutboundInput {
  responseContent: string;
  target: string;
  traceId: string;
  messageId: string;
  onOutbound?: (content: string, target: string) => Promise<void>;
  onOutboundFile?: (filePath: string, target: string) => Promise<void>;
}

/**
 * ⑥ 出站回调：发送文本回复（失败抛出）+ 提取并发送本地文件（失败不抛错，补文本反馈）。
 * `responseContent` 为空或未绑定 `onOutbound` ⇒ 直接返回（无出站）。
 */
export async function deliverChannelOutbound(
  input: ChannelOutboundInput
): Promise<void> {
  const { responseContent, target, traceId, messageId, onOutbound } = input;
  if (!responseContent || !onOutbound) return;

  const { onOutboundFile } = input;
  logger.info(`[TRACE] ${traceId} 阶段开始: outbound`, {
    messageId,
    target,
    responseLength: responseContent.length,
  });
  const outboundStartMs = Date.now();
  try {
    await onOutbound(responseContent, target);
    messageTraceBuffer.addStage(
      traceId,
      'outbound',
      'ok',
      target,
      Date.now() - outboundStartMs
    );
  } catch (outboundErr) {
    messageTraceBuffer.addStage(
      traceId,
      'outbound',
      'fail',
      String(outboundErr).slice(0, 200),
      Date.now() - outboundStartMs
    );
    throw outboundErr;
  }
  logger.info(`[TRACE] ${traceId} 阶段完成: outbound`, {
    messageId,
    target,
    outboundDurationMs: Date.now() - outboundStartMs,
  });

  // 2026-08-20 spec qq-file-transfer：回复文本中含本地文件路径时
  // 追加文件消息发送（multipart 上传 QQ 媒体库）。文本已送达为事实，
  // 文件失败不抛错，补发一条文本反馈。
  if (onOutboundFile) {
    await sendOutboundFiles(
      responseContent,
      target,
      traceId,
      onOutboundFile,
      onOutbound
    );
  }
}
