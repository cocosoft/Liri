/**
 * read_vfs 工具 —— AI-VFS 统一命名空间的读取系统调用（只读试点）。
 *
 * 路径形态：`<scheme>://<authority>[/<path>]`（如 `dev_docs://配置与安全/sandbox.md`）。
 * 未注册 scheme ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地文件系统，CS03）。
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

const logger = getLogger('tools:read_vfs');

/** 统一失败出口：`handleError` + `createToolResult(null, { success:false, error })` 口径 */
async function failVfs(error: unknown): Promise<ToolResult> {
  await handleError(error, { module: 'tools:read_vfs', action: 'execute' });
  const code = error instanceof AppError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.error('read_vfs 执行失败', { error: message, errorCode: code });
  return createToolResult(null, {
    success: false,
    error: code ? `[${code}] ${message}` : message,
    metadata: { errorCode: code },
  });
}

export class ReadVfsTool {
  static create(): Tool {
    return {
      name: 'read_vfs',
      description:
        '读取 AI-VFS 挂载点中的文件内容。路径形如 <scheme>://<authority>/<path>，例如 dev_docs://配置与安全/sandbox.md。未注册的 scheme 会明确失败，不会回退到本地文件系统。',
      params: [
        {
          name: 'path',
          type: 'string',
          description: 'VFS 路径，形如 dev_docs://目录/文件.md',
          required: true,
        },
        {
          name: 'offset',
          type: 'number',
          description: '起始行（0 起，可选）',
          required: false,
        },
        {
          name: 'limit',
          type: 'number',
          description: '最多返回的行数（可选）',
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
        const span = otel.startSpan('ReadVfsTool.execute');
        try {
          const vfsPath = parseVfsPath(String(input.path ?? ''));
          const driver = vfsMountRegistry.resolve(vfsPath.scheme);
          if (!driver) {
            throw vfsError(
              'VFS_UNKNOWN_MOUNT',
              `未注册的挂载点: "${vfsPath.scheme}"`
            );
          }

          const hasRange =
            input.offset !== undefined || input.limit !== undefined;
          const result = await driver.read(
            vfsPath,
            hasRange
              ? {
                  offset: Number(input.offset ?? 0),
                  limit: Number(input.limit ?? 0),
                }
              : undefined
          );

          span.setStatus({ code: SpanStatusCode.OK });
          // 2026-10-08：显式 `success: true` —— 全仓工具约定（81 文件 / 313 处）成功时设该字段；
          // 此前只设 `success:false`、成功时缺失 ⇒ 与口径不一致，且对按 `if (!result.success)`
          // 判定的消费方是**潜在误判**（`success?: boolean` 在 core 契约中可选）。
          return createToolResult(JSON.stringify(result), { success: true });
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
