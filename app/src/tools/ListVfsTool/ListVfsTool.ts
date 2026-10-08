/**
 * list_vfs 工具 —— AI-VFS 统一命名空间的目录列举系统调用（只读试点）。
 *
 * 路径形态：`<scheme>://<authority>[/<path>]`。未注册 scheme ⇒ `VFS_UNKNOWN_MOUNT`。
 *
 * MIT License - Copyright (c) 2026 Liri
 */

import type { Tool } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import { createToolResult, type ToolResult } from '../types/ToolResult';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { AppError, handleError } from '@modules/error';
import { parseVfsPath, vfsError, vfsMountRegistry } from '@modules/vfs';

const logger = getLogger('tools:list_vfs');

/** 统一失败出口：`handleError` + `createToolResult(null, { success:false, error })` 口径 */
async function failVfs(error: unknown): Promise<ToolResult> {
  await handleError(error, { module: 'tools:list_vfs', action: 'execute' });
  const code = error instanceof AppError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.error('list_vfs 执行失败', { error: message, errorCode: code });
  return createToolResult(null, {
    success: false,
    error: code ? `[${code}] ${message}` : message,
    metadata: { errorCode: code },
  });
}

export class ListVfsTool {
  static create(): Tool {
    return {
      name: 'list_vfs',
      description:
        '列举 AI-VFS 挂载点目录下的条目。路径形如 <scheme>://<authority>/<path>，例如 dev_docs://配置与安全。未注册的 scheme 会明确失败，不会回退到本地文件系统。',
      params: [
        {
          name: 'path',
          type: 'string',
          description:
            'VFS 目录路径，形如 dev_docs://目录（用 dev_docs:// 表示挂载根）',
          required: true,
        },
        {
          name: 'recursive',
          type: 'boolean',
          description: '是否递归列举子目录（默认 false）',
          required: false,
          default: false,
        },
        {
          name: 'limit',
          type: 'number',
          description: '返回的最大条目数（默认 200）',
          required: false,
        },
      ],
      isEnabled: () => true,
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,

      execute: async (
        input: Record<string, unknown>,
        _context: ToolUseContext
      ) => {
        const otel = getOTelTracing();
        const span = otel.startSpan('ListVfsTool.execute');
        try {
          const vfsPath = parseVfsPath(String(input.path ?? ''));
          const driver = vfsMountRegistry.resolve(vfsPath.scheme);
          if (!driver) {
            throw vfsError(
              'VFS_UNKNOWN_MOUNT',
              `未注册的挂载点: "${vfsPath.scheme}"`
            );
          }

          const entries = await driver.list(vfsPath, {
            recursive: input.recursive === true,
            limit: input.limit !== undefined ? Number(input.limit) : 0,
          });

          span.setStatus({ code: SpanStatusCode.OK });
          return createToolResult(
            JSON.stringify({ entries, count: entries.length })
          );
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          return await failVfs(error);
        } finally {
          span.end();
        }
      },

      getInfo: function () {
        return {
          name: this.name,
          description: this.description,
          params: this.params,
          aliases: this.aliases,
          enabled: this.isEnabled(),
          readOnly: this.isReadOnly(),
          destructive: this.isDestructive?.() || false,
          concurrencySafe: this.isConcurrencySafe(),
          deferred: false,
          alwaysLoad: true,
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}
