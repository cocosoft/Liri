import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_GENERIC_FILE_FORMAT } from '../engine/types';
import { htmlToMarkdown } from '../utils/HtmlMarkdownify';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

export class HtmlConverter extends BaseConverter {
  override readonly name: string = 'html';
  override readonly priority: number = PRIORITY_GENERIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.html', '.htm', '.xhtml'];
  override readonly supportedMimeTypes = ['text/html', 'application/xhtml+xml'];

  async convert(context: ConversionContext): Promise<ConversionResult> {
    const html =
      typeof context.content === 'string'
        ? context.content
        : context.content.toString('utf-8');

    if (!html.trim()) {
      return { markdown: '' };
    }

    const title = this.extractTitle(html);

    try {
      const markdown = this.convertString(html);
      logger.info(`HTML 转换完成`, { length: markdown.length, title });
      return { markdown, title };
    } catch (e) {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        cause: e instanceof Error ? e : undefined,
        context: { contentLength: html.length },
      });
    }
  }

  protected convertString(html: string): string {
    return htmlToMarkdown(html);
  }

  private extractTitle(html: string): string | undefined {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      return h1Match[1].replace(/<[^>]*>/g, '').trim();
    }
    return undefined;
  }
}
