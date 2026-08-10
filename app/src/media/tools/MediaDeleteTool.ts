// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaDeleteTool — 删除单个媒体文件（需审批）
 */

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { mediaStore } from '../store/MediaStore';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('media:tool:delete');

export function createMediaDeleteTool(): Tool {
  return {
    name: 'media:delete',
    description: 'Delete a media file (requires approval)',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the file to delete',
        required: true,
      },
    ],
    aliases: ['media_delete', 'file_delete'],
    searchTips: ['media', 'delete', 'remove'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<MediaToolResult> {
      const startTime = Date.now();
      const filePath = input.filePath as string;

      const safe = resolveSafePath(filePath);
      if (!safe.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safe.error,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: safe.error!,
          progress: [],
          metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `media_delete_${Date.now()}`,
          toolName: 'media:delete',
          timestamp: Date.now(),
        };
      }

      try {
        // ── 审批检查 ──
        return {
          status: ToolExecutionStatus.REQUIRES_APPROVAL,
          requireApproval: true,
          approvalReason: `将删除文件: ${safe.path}`,
          executionTime: Date.now() - startTime,
          output: `⚠ 将删除文件 ${safe.path}，需要审批确认。`,
          errorOutput: '',
          progress: [],
          metadata: { filePath: safe.path, action: 'delete_pending_approval' },
          executionId: `media_delete_${Date.now()}`,
          toolName: 'media:delete',
          timestamp: Date.now(),
          content: `文件删除等待审批: ${safe.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:delete',
          action: 'execute',
          context: { filePath: safe.path },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `media_delete_${Date.now()}`,
          toolName: 'media:delete',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:delete',
        description: 'Delete a media file (requires approval)',
        params: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Path to the file to delete',
            required: true,
          },
        ],
        aliases: ['media_delete'],
        searchTips: ['media', 'delete'],
        enabled: true,
        readOnly: false,
        destructive: true,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
