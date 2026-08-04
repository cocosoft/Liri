import { HtmlConverter } from './HtmlConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
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

/** mammoth 解析超时：大文件/损坏 docx 可能长时间卡住，超时后抛出明确错误 */
const PARSE_TIMEOUT_MS = 30_000;

/** 带超时的 Promise 包装 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          `${label} 超时（${ms / 1000}s），文件可能过大或损坏`,
          ErrorCategory.RESOURCE,
          ErrorSeverity.HIGH,
          'PARSE_TIMEOUT'
        )
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
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

    const result = await withTimeout<{ value: string }>(
      _mammoth.convertToHtml({ buffer }) as Promise<{ value: string }>,
      PARSE_TIMEOUT_MS,
      'docx 解析'
    );

    const markdown = this.convertString(result.value);

    return {
      markdown,
      title: context.fileInfo.path.replace(/\.docx$/i, ''),
    };
  }
}
