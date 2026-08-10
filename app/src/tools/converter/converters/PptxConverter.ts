import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\converter\converters\PptxConverter');

let _depError: Error | null = null;
let _AdmZip: any = null;
try {
  _AdmZip = require('adm-zip');
} catch (e) {
  _depError = e as Error;
}

export class PptxConverter extends BaseConverter {
  override readonly name = 'pptx';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.pptx'];
  override readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'adm-zip',
          format: 'pptx',
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

    const slideEntries = zip
      .getEntries()
      .filter((e: any) => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort((a: any, b: any) => {
        const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0', 10);
        const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0', 10);
        return numA - numB;
      });

    const parts: string[] = [];

    for (const entry of slideEntries) {
      const slideNum = entry.entryName.match(/slide(\d+)/)?.[1] || '?';
      const xml = entry.getData().toString('utf-8');

      const textContents = this.extractTextFromSlide(xml);
      if (textContents.length > 0) {
        parts.push(`## 幻灯片 ${slideNum}\n\n${textContents.join('\n\n')}`);
      }
    }

    if (parts.length === 0) {
      return { markdown: '*空演示文稿*' };
    }

    return { markdown: parts.join('\n\n') };
  }

  private extractTextFromSlide(xml: string): string[] {
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) {
        texts.push(text);
      }
    }

    return texts;
  }
}
