import { HtmlConverter } from './HtmlConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\converter\converters\DocxConverter',
  level: LogLevel.INFO,
});

let _depError: Error | null = null;
let _mammoth: any = null;
try {
  _mammoth = require('mammoth');
} catch (e) {
  _depError = e as Error;
}

export class DocxConverter extends HtmlConverter {
  override readonly name = 'docx';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.docx'];
  override readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'mammoth',
          format: 'docx',
          note: '运行：npm install mammoth',
        },
        cause: _depError,
      });
    }

    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    const result = await _mammoth.convertToHtml({ buffer });

    const markdown = this.convertString(result.value);

    return {
      markdown,
      title: context.fileInfo.path.replace(/\.docx$/i, ''),
    };
  }
}
