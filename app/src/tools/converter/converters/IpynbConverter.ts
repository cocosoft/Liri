import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

export class IpynbConverter extends BaseConverter {
  override readonly name = 'ipynb';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.ipynb'];
  override readonly supportedMimeTypes = ['application/json'];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    const text =
      typeof context.content === 'string'
        ? context.content
        : context.content.toString('utf-8');

    let notebook: any;
    try {
      notebook = JSON.parse(text);
    } catch {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: {
          format: 'ipynb',
          note: '无法解析 JSON 格式的 Notebook 文件',
        },
      });
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      throw AppError.fromCode(ErrorCodes.CONVERSION_FAILED, {
        context: { format: 'ipynb', note: 'Notebook 文件中缺少 cells 数组' },
      });
    }

    const parts: string[] = [];
    let title: string | undefined;

    for (const cell of notebook.cells) {
      const cellType = cell.cell_type || '';
      const source = Array.isArray(cell.source)
        ? cell.source.join('')
        : cell.source || '';

      if (!source) continue;

      if (cellType === 'markdown') {
        parts.push(source);

        if (!title) {
          const titleMatch = source.match(/^#\s+(.+)/m);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
        }
      } else if (cellType === 'code') {
        parts.push(
          '```' + (cell.language || 'python') + '\n' + source + '\n```'
        );
      } else if (cellType === 'raw') {
        parts.push('```\n' + source + '\n```');
      }
    }

    title = notebook.metadata?.title || title;

    return {
      markdown: parts.join('\n\n'),
      title,
    };
  }
}
