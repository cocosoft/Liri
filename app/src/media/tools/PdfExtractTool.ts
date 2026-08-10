// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { extractPdfPages } from '../pdf/PdfPageExtractor';
import type { PdfExtractOptions } from '../pdf/PdfPageExtractor';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import fs from 'fs';

const logger = getLogger('media:tool:pdf-extract');

export function createPdfExtractTool(): Tool {
  return {
    name: 'media:pdf:extract',
    description: 'Extract pages from a PDF file as images',
    params: [
      {
        name: 'input',
        type: 'string',
        description: 'Input PDF path',
        required: true,
      },
      {
        name: 'startPage',
        type: 'number',
        description: 'Start page number (1-based)',
        required: false,
      },
      {
        name: 'endPage',
        type: 'number',
        description: 'End page number (inclusive)',
        required: false,
      },
      {
        name: 'dpi',
        type: 'number',
        description: 'DPI for output images (default 100)',
        required: false,
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output format (jpeg, png, default jpeg)',
        required: false,
      },
    ],
    aliases: ['pdf_extract', 'pdf_extract_pages'],
    searchTips: ['pdf', 'extract', 'pages', 'image'],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<MediaToolResult> {
      const startTime = Date.now();
      const inPath = input.input as string;

      const safeInput = resolveSafePath(inPath);
      if (!safeInput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeInput.error,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: safeInput.error!,
          progress: [],
          metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `pdf_extract_${Date.now()}`,
          toolName: 'media:pdf:extract',
          timestamp: Date.now(),
        };
      }

      if (!fs.existsSync(safeInput.path!)) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: MEDIA_ERROR_MESSAGES[MediaErrorCode.FILE_NOT_FOUND],
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: MEDIA_ERROR_MESSAGES[MediaErrorCode.FILE_NOT_FOUND],
          progress: [],
          metadata: { errorCode: MediaErrorCode.FILE_NOT_FOUND },
          executionId: `pdf_extract_${Date.now()}`,
          toolName: 'media:pdf:extract',
          timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {};
        if (input.startPage !== undefined)
          options.startPage = input.startPage as number;
        if (input.endPage !== undefined)
          options.endPage = input.endPage as number;
        if (input.dpi !== undefined) options.dpi = input.dpi as number;
        if (input.format !== undefined) options.format = input.format as string;

        const pages = await extractPdfPages(
          safeInput.path!,
          options as PdfExtractOptions
        );

        const totalSize = pages.reduce((sum, p) => {
          try {
            return sum + fs.statSync(p.imagePath).size;
          } catch {
            return sum;
          }
        }, 0);

        logger.info('PDF pages extracted', {
          input: safeInput.path,
          pageCount: pages.length,
        });
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: JSON.stringify(pages),
          errorOutput: '',
          progress: [],
          metadata: {
            inputPath: safeInput.path,
            pageCount: pages.length,
            pages,
          },
          executionTime: Date.now() - startTime,
          outputPath: pages[0]?.imagePath,
          outputSize: totalSize,
          executionId: `pdf_extract_${Date.now()}`,
          toolName: 'media:pdf:extract',
          timestamp: Date.now(),
          content: `PDF 已提取 ${pages.length} 页`,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errorCode = errMsg.includes('不存在')
          ? MediaErrorCode.FILE_NOT_FOUND
          : errMsg.includes('密码') || errMsg.includes('损坏')
            ? MediaErrorCode.FILE_CORRUPTED
            : MediaErrorCode.PROCESS_FAILED;

        await handleError(err, {
          module: 'media:tool:pdf-extract',
          action: 'execute',
          context: { input: safeInput.path },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: errMsg,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: errMsg,
          progress: [],
          metadata: { errorCode },
          executionId: `pdf_extract_${Date.now()}`,
          toolName: 'media:pdf:extract',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:pdf:extract',
        description: 'Extract pages from a PDF file as images',
        params: [
          {
            name: 'input',
            type: 'string',
            description: 'Input PDF path',
            required: true,
          },
          {
            name: 'startPage',
            type: 'number',
            description: 'Start page number (1-based)',
            required: false,
          },
          {
            name: 'endPage',
            type: 'number',
            description: 'End page number (inclusive)',
            required: false,
          },
          {
            name: 'dpi',
            type: 'number',
            description: 'DPI for output images (default 100)',
            required: false,
          },
          {
            name: 'format',
            type: 'string',
            description: 'Output format (jpeg, png, default jpeg)',
            required: false,
          },
        ],
        aliases: ['pdf_extract', 'pdf_extract_pages'],
        searchTips: ['pdf', 'extract', 'pages', 'image'],
        enabled: true,
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
