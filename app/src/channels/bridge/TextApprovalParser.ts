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
 * TextApprovalParser — 纯文本渠道的内容匹配审批解析器
 *
 * 用于不支持 InteractiveCard 的渠道（微信、QQ 等），
 * 通过检测用户回复的关键词来判断审批意图。
 *
 * 仅当会话有 pending Inbox 项时启用，防止误触发。
 */

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = getLogger('channels:textApproval');

/** 审批意图 */
export type ApprovalIntent = 'approve' | 'reject' | null;

/** 中文 + 英文审批关键词 */
const APPROVE_KEYWORDS = [
  '同意',
  '确认',
  '好的',
  '可以',
  '行',
  '批准',
  'approve',
  'yes',
  'ok',
  'accept',
  'confirm',
  'agree',
];

const REJECT_KEYWORDS = [
  '拒绝',
  '不同意',
  '不行',
  '取消',
  '驳回',
  'reject',
  'no',
  'deny',
  'cancel',
  'decline',
  'refuse',
];

/**
 * 检测消息是否为审批回复
 *
 * @param content 用户消息内容（trim 后）
 * @returns 'approve' | 'reject' | null
 */
export function detectApprovalIntent(content: string): ApprovalIntent {
  const trimmed = content.trim();

  // 上下文守卫：审批回复通常是极短的消息（"同意"、"好的"、"不行"）
  // 长消息（>20字）几乎不可能是审批回复，避免正常对话误触发
  if (trimmed.length > 20) {
    return null;
  }

  // 精确匹配优先（单字/短语完全一致）
  for (const kw of APPROVE_KEYWORDS) {
    if (
      trimmed === kw ||
      trimmed.startsWith(kw + ' ') ||
      trimmed.startsWith(kw + '，')
    ) {
      return 'approve';
    }
  }

  for (const kw of REJECT_KEYWORDS) {
    if (
      trimmed === kw ||
      trimmed.startsWith(kw + ' ') ||
      trimmed.startsWith(kw + '，')
    ) {
      return 'reject';
    }
  }

  return null;
}

/**
 * 执行文本审批
 *
 * 当检测到审批意图时，调用 inboxManager.reply() 处理审批。
 *
 * @param inboxItemId 待审批的 Inbox 项 ID
 * @param intent 审批意图
 * @returns 是否成功处理
 */
export async function processTextApproval(
  inboxItemId: string,
  intent: 'approve' | 'reject'
): Promise<boolean> {
  const otel = getOTelTracing();
  const span = otel.startSpan('textApproval.process', {
    'inbox.itemId': inboxItemId,
    'inbox.intent': intent,
  });

  try {
    const { inboxManager } = await import('@modules/runtime/InboxManager.js');

    const reply = intent === 'approve' ? 'approve' : 'reject';
    const result = await inboxManager.reply(inboxItemId, reply);

    if (result) {
      logger.info('Text approval processed', {
        inboxItemId,
        intent,
        status: result.status,
      });
      span.setAttribute('inbox.status', result.status);
      otel.endSpan(span, SpanStatusCode.OK);
      return true;
    }

    logger.info('Text approval skipped (item already processed)', {
      inboxItemId,
      intent,
    });
    otel.endSpan(span, SpanStatusCode.OK, 'already_processed');
    return false;
  } catch (err) {
    await handleError(err, {
      module: 'channels:textApproval',
      action: 'processTextApproval',
      context: { inboxItemId, intent },
    });
    otel.recordError(span, err instanceof Error ? err : new Error(String(err)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(err));
    return false;
  }
}
