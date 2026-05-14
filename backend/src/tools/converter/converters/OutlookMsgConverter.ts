import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { htmlToMarkdown } from '../utils/HtmlMarkdownify';

let _depError: Error | null = null;
let _parseMsgBuffer: any = null;
try {
  const outlookParser = require('outlook-email-parser');
  _parseMsgBuffer = outlookParser.parseMsgBuffer;
} catch (e) {
  _depError = e as Error;
}

export class OutlookMsgConverter extends BaseConverter {
  override readonly name = 'outlook_msg';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.msg'];
  override readonly supportedMimeTypes = [
    'application/vnd.ms-outlook',
    'application/x-msg',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'outlook-email-parser',
          format: 'msg',
          note: '运行：npm install outlook-email-parser',
        },
        cause: _depError,
      });
    }

    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    // 验证 OLE2 magic bytes (D0CF11E0A1B11AE1)
    if (
      buffer.length < 8 ||
      buffer[0] !== 0xd0 ||
      buffer[1] !== 0xcf ||
      buffer[2] !== 0x11 ||
      buffer[3] !== 0xe0
    ) {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: { format: 'msg', note: '无效的 MSG 文件：无法识别 OLE2 格式' },
      });
    }

    let email: any;
    try {
      email = _parseMsgBuffer(buffer);
    } catch (e) {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: { format: 'msg', note: '无法解析 MSG 文件' },
        cause: e as Error,
      });
    }

    const lines: string[] = ['# Email Message\n'];

    if (email.subject) lines.push(`**主题:** ${email.subject}`);
    if (email.from) {
      const fromStr =
        typeof email.from === 'object'
          ? [email.from.name, email.from.email].filter(Boolean).join(' <') +
            (email.from.email ? '>' : '')
          : email.from;
      lines.push(`**发件人:** ${fromStr}`);
    }
    if (email.to) lines.push(`**收件人:** ${email.to}`);
    if (email.cc) lines.push(`**抄送:** ${email.cc}`);
    if (email.sentDate) lines.push(`**发送时间:** ${email.sentDate}`);

    lines.push('\n## 正文\n');

    if (email.htmlContent) {
      const md = htmlToMarkdown(email.htmlContent);
      lines.push(md);
    } else if (email.textContent) {
      lines.push(email.textContent);
    }

    if (email.attachments && email.attachments.length > 0) {
      lines.push('\n## 附件\n');
      for (const att of email.attachments) {
        lines.push(`- **${att.filename}** (${att.size || 0} 字节)`);
      }
    }

    return {
      markdown: lines.join('\n'),
      title: email.subject || undefined,
    };
  }
}
