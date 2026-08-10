// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { qrCodeManager } from '../qr/QRCodeManager';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import fs from 'fs';

const logger = getLogger('media:tool:qr-decode');

export function createQRDecodeTool(): Tool {
  return {
    name: 'media:qr:decode',
    description: 'Decode a QR code from an image file',
    params: [
      {
        name: 'input',
        type: 'string',
        description: 'Image path containing QR code',
        required: true,
      },
    ],
    aliases: ['qr_decode', 'qr_read'],
    searchTips: ['qr', 'decode', 'barcode', 'scan'],
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
          executionId: `qr_dec_${Date.now()}`,
          toolName: 'media:qr:decode',
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
          executionId: `qr_dec_${Date.now()}`,
          toolName: 'media:qr:decode',
          timestamp: Date.now(),
        };
      }

      try {
        const decoded = await qrCodeManager.decode(safeInput.path!);
        if (decoded === null) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: MEDIA_ERROR_MESSAGES[MediaErrorCode.PROCESS_FAILED],
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: MEDIA_ERROR_MESSAGES[MediaErrorCode.PROCESS_FAILED],
            progress: [],
            metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `qr_dec_${Date.now()}`,
            toolName: 'media:qr:decode',
            timestamp: Date.now(),
          };
        }

        logger.info('QR code decoded', {
          input: safeInput.path,
          length: decoded.length,
        });
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: decoded,
          errorOutput: '',
          progress: [],
          metadata: { inputPath: safeInput.path },
          executionTime: Date.now() - startTime,
          executionId: `qr_dec_${Date.now()}`,
          toolName: 'media:qr:decode',
          timestamp: Date.now(),
          content: decoded,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:qr-decode',
          action: 'execute',
          context: { input: safeInput.path },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `qr_dec_${Date.now()}`,
          toolName: 'media:qr:decode',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:qr:decode',
        description: 'Decode a QR code from an image file',
        params: [
          {
            name: 'input',
            type: 'string',
            description: 'Image path containing QR code',
            required: true,
          },
        ],
        aliases: ['qr_decode', 'qr_read'],
        searchTips: ['qr', 'decode', 'barcode', 'scan'],
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
