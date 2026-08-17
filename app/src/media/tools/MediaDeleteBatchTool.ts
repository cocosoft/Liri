// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaDeleteBatchTool — 批量删除媒体文件（需审批）
 */

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { mediaStore } from '../store/MediaStore';
import { isToolCallApproved } from '@modules/permission';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('media:tool:deleteBatch');

export function createMediaDeleteBatchTool(): Tool {
  return {
    name: 'media:deleteBatch',
    description: 'Batch delete multiple media files (requires approval)',
    params: [
      {
        name: 'filePaths',
        type: 'string',
        description: 'JSON array of file paths to delete',
        required: true,
      },
    ],
    aliases: ['media_delete_batch', 'file_delete_batch'],
    searchTips: ['media', 'delete', 'batch', 'remove'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      context: ToolUseContext
    ): Promise<MediaToolResult> {
      const startTime = Date.now();
      let paths: string[];

      try {
        paths = JSON.parse(input.filePaths as string) as string[];
        if (!Array.isArray(paths) || paths.length === 0) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: 'filePaths must be a non-empty JSON array of file paths',
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: '',
            progress: [],
            metadata: {},
            executionId: `media_delete_batch_${Date.now()}`,
            toolName: 'media:deleteBatch',
            timestamp: Date.now(),
          };
        }
      } catch {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'Invalid JSON for filePaths parameter',
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `media_delete_batch_${Date.now()}`,
          toolName: 'media:deleteBatch',
          timestamp: Date.now(),
        };
      }

      // 路径安全校验
      const safePaths: string[] = [];
      for (const p of paths) {
        const safe = resolveSafePath(p);
        if (!safe.valid) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: `Path rejected: ${p} — ${safe.error}`,
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: safe.error!,
            progress: [],
            metadata: {
              errorCode: MediaErrorCode.PATH_INSECURE,
              rejectedPath: p,
            },
            executionId: `media_delete_batch_${Date.now()}`,
            toolName: 'media:deleteBatch',
            timestamp: Date.now(),
          };
        }
        safePaths.push(safe.path!);
      }

      try {
        // N1 修复（两阶段执行）：先查审批缓存——已批准则真正执行批量删除；
        // 未批准返回 REQUIRES_APPROVAL 提交审批卡（原实现无条件返回，永远不删除）。
        if (
          context.sessionId &&
          isToolCallApproved(context.sessionId, 'media:deleteBatch', input)
        ) {
          const results = mediaStore.deleteBatch(safePaths);
          const deletedCount = results.filter((r) => r.deleted).length;
          logger.info('media:deleteBatch 已执行删除', {
            count: safePaths.length,
            deletedCount,
          });
          return {
            status: ToolExecutionStatus.SUCCESS,
            executionTime: Date.now() - startTime,
            output: `已删除 ${deletedCount}/${safePaths.length} 个文件`,
            errorOutput: '',
            progress: [],
            metadata: {
              filePaths: safePaths,
              count: safePaths.length,
              deletedCount,
              action: 'deleted_batch',
            },
            executionId: `media_delete_batch_${Date.now()}`,
            toolName: 'media:deleteBatch',
            timestamp: Date.now(),
            content: `已批量删除 ${deletedCount}/${safePaths.length} 个文件`,
          };
        }

        // ── 统一审批（无论文件数量）──
        return {
          status: ToolExecutionStatus.REQUIRES_APPROVAL,
          requireApproval: true,
          approvalReason: `将删除 ${safePaths.length} 个媒体文件`,
          executionTime: Date.now() - startTime,
          output: `⚠ 将删除 ${safePaths.length} 个文件，需要审批确认。`,
          errorOutput: '',
          progress: [],
          metadata: {
            filePaths: safePaths,
            count: safePaths.length,
            action: 'delete_batch_pending_approval',
          },
          executionId: `media_delete_batch_${Date.now()}`,
          toolName: 'media:deleteBatch',
          timestamp: Date.now(),
          content: `批量删除等待审批: ${safePaths.length} 个文件`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:deleteBatch',
          action: 'execute',
          context: { count: safePaths.length },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `media_delete_batch_${Date.now()}`,
          toolName: 'media:deleteBatch',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:deleteBatch',
        description: 'Batch delete media files (requires approval)',
        params: [
          {
            name: 'filePaths',
            type: 'string',
            description: 'JSON array of file paths',
            required: true,
          },
        ],
        aliases: ['media_delete_batch'],
        searchTips: ['media', 'delete', 'batch'],
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
