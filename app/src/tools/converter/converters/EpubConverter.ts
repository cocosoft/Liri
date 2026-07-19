import { HtmlConverter } from './HtmlConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:converter:converters:EpubConverter',
  level: LogLevel.INFO,
});

let _depError: Error | null = null;
let _AdmZip: any = null;
try {
  _AdmZip = require('adm-zip');
} catch (e) {
  _depError = e as Error;
}

export class EpubConverter extends HtmlConverter {
  override readonly name = 'epub';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.epub'];
  override readonly supportedMimeTypes = [
    'application/epub',
    'application/epub+zip',
    'application/x-epub+zip',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'adm-zip',
          format: 'epub',
          note: '运行：npm install adm-zip',
        },
        cause: _depError,
      });
    }

    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    const zip = new _AdmZip(buffer);

    const metadata = this.extractMetadata(zip);
    const spineContent = this.extractSpineContent(zip);

    const parts: string[] = [];

    if (metadata.title || metadata.authors.length > 0) {
      const metaLines: string[] = [];
      if (metadata.title) metaLines.push(`**标题:** ${metadata.title}`);
      if (metadata.authors.length > 0)
        metaLines.push(`**作者:** ${metadata.authors.join(', ')}`);
      if (metadata.language) metaLines.push(`**语言:** ${metadata.language}`);
      if (metadata.publisher)
        metaLines.push(`**出版者:** ${metadata.publisher}`);
      if (metadata.date) metaLines.push(`**日期:** ${metadata.date}`);
      if (metadata.description) metaLines.push(`\n${metadata.description}`);
      parts.push(metaLines.join('\n'));
    }

    if (spineContent) {
      parts.push(spineContent);
    }

    if (parts.length === 0) {
      return { markdown: '*空演示文稿*' };
    }

    return {
      markdown: parts.join('\n\n'),
      title: metadata.title || undefined,
    };
  }

  private extractMetadata(zip: any): EpubMetadata {
    const meta: EpubMetadata = {
      title: '',
      authors: [],
      language: '',
      publisher: '',
      date: '',
      description: '',
    };

    try {
      const containerEntry = zip
        .getEntries()
        .find((e: any) => e.entryName === 'META-INF/container.xml');
      if (!containerEntry) return meta;

      const containerXml = containerEntry.getData().toString('utf-8');
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!opfPathMatch) return meta;

      const opfPath = opfPathMatch[1];
      const opfEntry = zip
        .getEntries()
        .find((e: any) => e.entryName === opfPath);
      if (!opfEntry) return meta;

      const opfXml = opfEntry.getData().toString('utf-8');

      const extractTag = (tag: string): string => {
        const m = opfXml.match(
          new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
        );
        return m ? m[1].trim() : '';
      };

      const extractAllTags = (tag: string): string[] => {
        const results: string[] = [];
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = regex.exec(opfXml)) !== null) {
          results.push(m[1].trim());
        }
        return results;
      };

      meta.title = extractTag('dc:title') || extractTag('title');
      meta.authors =
        extractAllTags('dc:creator').length > 0
          ? extractAllTags('dc:creator')
          : extractAllTags('creator');
      meta.language = extractTag('dc:language') || extractTag('language');
      meta.publisher = extractTag('dc:publisher') || extractTag('publisher');
      meta.date = extractTag('dc:date') || extractTag('date');
      meta.description =
        extractTag('dc:description') || extractTag('description');
    } catch (err) {
      // 元数据解析失败时静默处理

      logger.warn('Operation skipped', {
        context: '元数据解析失败时静默处理',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return meta;
  }

  private extractSpineContent(zip: any): string {
    try {
      const containerEntry = zip
        .getEntries()
        .find((e: any) => e.entryName === 'META-INF/container.xml');
      if (!containerEntry) return '';

      const containerXml = containerEntry.getData().toString('utf-8');
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!opfPathMatch) return '';

      const opfPath = opfPathMatch[1];
      const basePath = opfPath.includes('/')
        ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
        : '';

      const opfEntry = zip
        .getEntries()
        .find((e: any) => e.entryName === opfPath);
      if (!opfEntry) return '';

      const opfXml = opfEntry.getData().toString('utf-8');

      const hrefMap: Record<string, string> = {};
      const itemRegex = /<item[^>]*id="([^"]*)"[^>]*href="([^"]*)"[^>]*\/?>/gi;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(opfXml)) !== null) {
        hrefMap[itemMatch[1]] = itemMatch[2];
      }

      const spineIds: string[] = [];
      const spineRegex = /<itemref[^>]*idref="([^"]*)"[^>]*\/?>/gi;
      let spineMatch: RegExpExecArray | null;
      while ((spineMatch = spineRegex.exec(opfXml)) !== null) {
        spineIds.push(spineMatch[1]);
      }

      const parts: string[] = [];
      const entryNames = zip.getEntries().map((e: any) => e.entryName);

      for (const spineId of spineIds) {
        const href = hrefMap[spineId];
        if (!href) continue;

        const fullPath = basePath ? `${basePath}${href}` : href;

        const entry = zip
          .getEntries()
          .find((e: any) => e.entryName === fullPath);
        if (!entry) continue;

        const ext = href.toLowerCase().split('.').pop();
        if (ext !== 'html' && ext !== 'xhtml' && ext !== 'htm') continue;

        const content = entry.getData().toString('utf-8');
        const md = this.convertString(content);
        if (md.trim()) {
          parts.push(md.trim());
        }
      }

      return parts.join('\n\n');
    } catch {
      return '';
    }
  }
}

interface EpubMetadata {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  date: string;
  description: string;
}
