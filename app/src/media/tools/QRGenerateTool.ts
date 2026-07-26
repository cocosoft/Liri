// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { qrCodeManager } from '../qr/QRCodeManager';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import fs from 'fs';

const logger = new Logger({ module: 'media:tool:qr-generate', level: LogLevel.INFO });

export function createQRGenerateTool(): Tool {
  return {
    name: 'media:qr:generate',
    description: 'Generate a QR code image from text',
    params: [
      { name: 'text', type: 'string', description: 'Text to encode in QR code', required: true },
      { name: 'output', type: 'string', description: 'Output image path', required: true },
      { name: 'size', type: 'number', description: 'QR code size in pixels', required: false },
      { name: 'format', type: 'string', description: 'Output format (png, svg)', required: false },
    ],
    aliases: ['qr_generate', 'qr_create'],
    searchTips: ['qr', 'generate', 'barcode'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<MediaToolResult> {
      const startTime = Date.now();
      const text = input.text as string;
      const outPath = input.output as string;

      if (!text || typeof text !== 'string') {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'text 参数不能为空',
          executionTime: Date.now() - startTime,
          output: '', errorOutput: 'text 参数不能为空',
          progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `qr_gen_${Date.now()}`, toolName: 'media:qr:generate', timestamp: Date.now(),
        };
      }

      const safeOutput = resolveSafePath(outPath);
      if (!safeOutput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeOutput.error,
          executionTime: Date.now() - startTime,
          output: '', errorOutput: safeOutput.error!,
          progress: [], metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `qr_gen_${Date.now()}`, toolName: 'media:qr:generate', timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {};
        if (input.size !== undefined) options.size = input.size as number;
        if (input.format !== undefined) options.format = input.format as string;

        const success = await qrCodeManager.generate(text, safeOutput.path!, options as any);
        if (!success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: MEDIA_ERROR_MESSAGES[MediaErrorCode.PROCESS_FAILED],
            executionTime: Date.now() - startTime,
            output: '', errorOutput: MEDIA_ERROR_MESSAGES[MediaErrorCode.PROCESS_FAILED],
            progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `qr_gen_${Date.now()}`, toolName: 'media:qr:generate', timestamp: Date.now(),
          };
        }

        const outputSize = fs.existsSync(safeOutput.path!) ? fs.statSync(safeOutput.path!).size : 0;
        logger.info('QR code generated', { output: safeOutput.path, size: outputSize });
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: JSON.stringify({ outputPath: safeOutput.path, outputSize }),
          errorOutput: '', progress: [],
          metadata: { outputPath: safeOutput.path },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize,
          executionId: `qr_gen_${Date.now()}`, toolName: 'media:qr:generate', timestamp: Date.now(),
          content: `QR 码已生成: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, { module: 'media:tool:qr-generate', action: 'execute', context: { text } });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '', errorOutput: String(err),
          progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `qr_gen_${Date.now()}`, toolName: 'media:qr:generate', timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:qr:generate',
        description: 'Generate a QR code image from text',
        params: [
          { name: 'text', type: 'string', description: 'Text to encode in QR code', required: true },
          { name: 'output', type: 'string', description: 'Output image path', required: true },
          { name: 'size', type: 'number', description: 'QR code size in pixels', required: false },
          { name: 'format', type: 'string', description: 'Output format (png, svg)', required: false },
        ],
        aliases: ['qr_generate'],
        searchTips: ['qr', 'generate', 'barcode'],
        enabled: true, readOnly: false, destructive: false, concurrencySafe: true,
        deferred: false, alwaysLoad: false, interruptBehavior: 'block',
      };
    },
  };
}
