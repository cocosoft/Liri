import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { JupyterNotebookConverter } from '../../notebook/JupyterNotebookConverter.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\converter\converters\IpynbConverter');

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

    // P1-1: 复用 JupyterNotebookConverter 解析标准 nbformat，消除重复的 cell_type/source 解析
    const nb = JupyterNotebookConverter.fromJupyter(notebook);
    const parts: string[] = [];
    let title: string | undefined;

    for (const cell of nb.cells) {
      if (cell.type === 'markdown') {
        const content = (cell as any).content || '';
        if (!content) continue;
        parts.push(content);

        if (!title) {
          const titleMatch = content.match(/^#\s+(.+)/m);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
        }
      } else {
        const codeCell = cell as any;
        const code = codeCell.code || '';
        if (!code) continue;
        const isRaw = codeCell.metadata?.originalCellType === 'raw';
        const language = isRaw ? '' : codeCell.language || 'python';
        parts.push('```' + language + '\n' + code + '\n```');
      }
    }

    title = notebook.metadata?.title || title;

    return {
      markdown: parts.join('\n\n'),
      title,
    };
  }
}
