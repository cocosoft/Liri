import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { htmlToMarkdown } from '../utils/HtmlMarkdownify';

let _depError: Error | null = null;
let _XMLParser: any = null;
try {
  _XMLParser = require('fast-xml-parser');
} catch (e) {
  _depError = e as Error;
}

export class RssConverter extends BaseConverter {
  override readonly name = 'rss';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.rss', '.atom', '.xml'];
  override readonly supportedMimeTypes = [
    'application/rss+xml',
    'application/atom+xml',
    'application/rss',
    'application/atom',
    'text/xml',
    'application/xml',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'fast-xml-parser',
          format: 'rss',
          note: '运行：npm install fast-xml-parser',
        },
        cause: _depError,
      });
    }

    const text =
      typeof context.content === 'string'
        ? context.content
        : context.content.toString('utf-8');

    const parser = new _XMLParser.XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    let doc: any;
    try {
      doc = parser.parse(text);
    } catch {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: { format: 'rss', note: '无法解析 XML' },
      });
    }

    if (doc.rss) {
      return this.convertRss(doc.rss);
    } else if (doc.feed) {
      return this.convertAtom(doc.feed);
    } else {
      throw AppError.fromCode(ErrorCodes.UNSUPPORTED_FORMAT, {
        context: {
          format: 'rss',
          note: '无法识别的 Feed 格式（仅支持 RSS 和 Atom）',
        },
      });
    }
  }

  private convertRss(rss: any): ConversionResult {
    const channel = rss.channel;
    if (!channel) {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: { format: 'rss', note: 'RSS Feed 中缺少 channel 元素' },
      });
    }

    const channelTitle = channel.title || '';
    const channelDescription = channel.description || '';
    const items = Array.isArray(channel.item)
      ? channel.item
      : channel.item
        ? [channel.item]
        : [];

    const lines: string[] = [];

    if (channelTitle) lines.push(`# ${channelTitle}`);
    if (channelDescription) lines.push(channelDescription);

    for (const item of items) {
      const title = item.title || '';
      const description = item.description || '';
      const pubDate = item.pubDate || '';
      const content = item['content:encoded'] || '';

      if (title) lines.push(`\n## ${title}`);
      if (pubDate) lines.push(`发布于: ${pubDate}`);
      if (content) {
        lines.push(this.parseContent(content));
      } else if (description) {
        lines.push(this.parseContent(description));
      }
    }

    return { markdown: lines.join('\n'), title: channelTitle || undefined };
  }

  private convertAtom(feed: any): ConversionResult {
    const title = feed.title || '';
    const subtitle = feed.subtitle || '';
    const entries = Array.isArray(feed.entry)
      ? feed.entry
      : feed.entry
        ? [feed.entry]
        : [];

    const lines: string[] = [];

    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(subtitle);

    for (const entry of entries) {
      const entryTitle = entry.title || '';
      const entrySummary = entry.summary || '';
      const entryUpdated = entry.updated || '';
      const entryContent = entry.content || '';

      if (entryTitle) {
        const titleText =
          typeof entryTitle === 'string'
            ? entryTitle
            : entryTitle['#text'] || '';
        lines.push(`\n## ${titleText}`);
      }
      if (entryUpdated) lines.push(`更新于: ${entryUpdated}`);
      if (entryContent) {
        const contentText =
          typeof entryContent === 'string'
            ? entryContent
            : entryContent['#text'] || '';
        lines.push(this.parseContent(contentText));
      } else if (entrySummary) {
        const summaryText =
          typeof entrySummary === 'string'
            ? entrySummary
            : entrySummary['#text'] || '';
        lines.push(this.parseContent(summaryText));
      }
    }

    return { markdown: lines.join('\n'), title: title || undefined };
  }

  private parseContent(content: string): string {
    if (!content) return '';
    if (content.includes('<') && content.includes('>')) {
      try {
        return htmlToMarkdown(content);
      } catch {
        return content;
      }
    }
    return content;
  }
}
