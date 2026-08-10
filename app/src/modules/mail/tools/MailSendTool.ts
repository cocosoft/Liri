/**
 * 邮件发送工具 — 注册到 ToolManager，供 AI Agent 调用
 */

import type { Tool, ToolParam } from '../../../tools/types/Tool';
import type { ToolResult } from '../../../tools/types/ToolResult';
import { ToolExecutionStatus } from '../../../tools/types/ToolResult';
import type { ToolUseContext } from '../../../tools/types/ToolUseContext';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('mail:send');

/** 工具参数定义 */
const SEND_PARAMS: ToolParam[] = [
  { name: 'to', type: 'string', description: '收件人邮箱地址', required: true },
  { name: 'subject', type: 'string', description: '邮件主题', required: true },
  {
    name: 'body',
    type: 'string',
    description: '邮件正文 (Markdown)',
    required: true,
  },
  {
    name: 'cc',
    type: 'string',
    description: '抄送（逗号分隔）',
    required: false,
  },
  {
    name: 'attachments',
    type: 'string',
    description: '附件路径（逗号分隔）',
    required: false,
  },
];

export function createMailSendTool(): Tool {
  return {
    name: 'mail:send',
    description:
      'Send an email via SMTP. Requires email account to be configured first.',
    params: SEND_PARAMS,
    aliases: ['email_send', 'send_email'],
    searchTips: ['mail', 'send', 'email'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> {
      const startTime = Date.now();
      const to = (input.to as string) || '';
      const subject = (input.subject as string) || '';
      const body = (input.body as string) || '';
      const cc = (input.cc as string) || '';
      const attachments = (input.attachments as string) || '';

      if (!to || !subject || !body) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'to, subject, body are required',
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `mail_send_${Date.now()}`,
          toolName: 'mail:send',
          timestamp: Date.now(),
        };
      }

      try {
        const { EmailTool } =
          await import('../../../../packages/office/email/EmailTool');
        const emailTool = new EmailTool();
        const result = await emailTool.send({
          to: to.split(',').map((s) => s.trim()),
          subject,
          body,
          attachments: attachments
            ? attachments.split(',').map((s) => ({ path: s.trim() }))
            : undefined,
        });

        return {
          status: ToolExecutionStatus.SUCCESS,
          result,
          output: JSON.stringify(result),
          errorOutput: '',
          progress: [],
          metadata: { to, subject, messageId: result.messageId },
          executionTime: Date.now() - startTime,
          executionId: `mail_send_${Date.now()}`,
          toolName: 'mail:send',
          timestamp: Date.now(),
          content: `邮件已发送: ${subject} → ${to}`,
        };
      } catch (error) {
        logger.warn('邮件发送失败', { error: String(error) });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(error),
          progress: [],
          metadata: {},
          executionId: `mail_send_${Date.now()}`,
          toolName: 'mail:send',
          timestamp: Date.now(),
        };
      }
    },

    getInfo() {
      return {
        name: 'mail:send',
        description: this.description,
        params: SEND_PARAMS,
        aliases: ['email_send', 'send_email'],
        searchTips: ['mail', 'send', 'email'],
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
