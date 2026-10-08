/**
 * stat_vfs 工具 —— AI-VFS 统一命名空间的元数据系统调用（只读试点）。
 *
 * 路径形态：`<scheme>://<authority>[/<path>]`。未注册 scheme ⇒ `VFS_UNKNOWN_MOUNT`。
 * 出参：`{ kind, size, mtime, mimeType?, mount, readOnly }`。
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

const logger = getLogger('tools:stat_vfs');

/** 统一失败出口：`handleError` + `createToolResult(null, { success:false, error })` 口径 */
async function failVfs(error: unknown): Promise<ToolResult> {
  await handleError(error, { module: 'tools:stat_vfs', action: 'execute' });
  const code = error instanceof AppError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.error('stat_vfs 执行失败', { error: message, errorCode: code });
  return createToolResult(null, {
    success: false,
    error: code ? `[${code}] ${message}` : message,
    metadata: { errorCode: code },
  });
}

export class StatVfsTool {
  static create(): Tool {
    return {
      name: 'stat_vfs',
      description:
        '查询 AI-VFS 挂载点中某个路径的元数据（类型 / 大小 / 修改时间 / MIME / 挂载点 / 是否只读）。路径形如 dev_docs://配置与安全/sandbox.md。',
      params: [
        {
          name: 'path',
          type: 'string',
          description: 'VFS 路径，形如 dev_docs://目录/文件.md',
          required: true,
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
        const span = otel.startSpan('StatVfsTool.execute');
        try {
          const vfsPath = parseVfsPath(String(input.path ?? ''));
          const driver = vfsMountRegistry.resolve(vfsPath.scheme);
          if (!driver) {
            throw vfsError(
              'VFS_UNKNOWN_MOUNT',
              `未注册的挂载点: "${vfsPath.scheme}"`
            );
          }

          const result = await driver.stat(vfsPath);

          span.setStatus({ code: SpanStatusCode.OK });
          // 2026-10-08：显式 `success: true`（对齐全仓工具约定；见 ReadVfsTool 同处注释）
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
