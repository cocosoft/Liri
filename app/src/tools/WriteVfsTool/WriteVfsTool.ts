/**
 * write_vfs 工具 —— AI-VFS 统一命名空间的写入系统调用（只读试点）。
 *
 * 路径形态：`<scheme>://<authority>[/<path>]`。
 * `capabilities.write === false` 的挂载点（如只读的 `dev_docs://`）⇒ **fail-closed** 拒绝
 * `VFS_READ_ONLY_MOUNT`（不静默降级，CS03）。
 *
 * MIT License - Copyright (c) 2026 Liri
 */

import type { Tool } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import { createToolResult, type ToolResult } from '../types/ToolResult';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { AppError, handleError } from '@modules/error';
import {
  parseVfsPath,
  vfsError,
  vfsMountRegistry,
  type VfsWriteInput,
} from '@modules/vfs';

const logger = getLogger('tools:write_vfs');

/** 统一失败出口：`handleError` + `createToolResult(null, { success:false, error })` 口径 */
async function failVfs(error: unknown): Promise<ToolResult> {
  await handleError(error, { module: 'tools:write_vfs', action: 'execute' });
  const code = error instanceof AppError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logger.error('write_vfs 执行失败', { error: message, errorCode: code });
  return createToolResult(null, {
    success: false,
    error: code ? `[${code}] ${message}` : message,
    metadata: { errorCode: code },
  });
}

/** 归一化写入模式（默认 create） */
function resolveWriteMode(value: unknown): VfsWriteInput['mode'] {
  return value === 'overwrite' || value === 'append' ? value : 'create';
}

export class WriteVfsTool {
  static create(): Tool {
    return {
      name: 'write_vfs',
      description:
        '向 AI-VFS 挂载点写入文件。路径形如 <scheme>://<authority>/<path>。若挂载点声明的能力为只读（如 dev_docs://），会明确拒绝并返回 VFS_READ_ONLY_MOUNT。',
      params: [
        {
          name: 'path',
          type: 'string',
          description: 'VFS 路径，形如 dev_docs://目录/文件.md',
          required: true,
        },
        {
          name: 'content',
          type: 'string',
          description: '写入的文本内容',
          required: false,
        },
        {
          name: 'mode',
          type: 'string',
          description: '写入模式：create / overwrite / append（默认 create）',
          required: false,
          enum: ['create', 'overwrite', 'append'],
          default: 'create',
        },
      ],
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => true,
      isConcurrencySafe: () => false,

      execute: async (
        input: Record<string, unknown>,
        _context: ToolUseContext
      ) => {
        const otel = getOTelTracing();
        const span = otel.startSpan('WriteVfsTool.execute');
        try {
          const vfsPath = parseVfsPath(String(input.path ?? ''));
          const driver = vfsMountRegistry.resolve(vfsPath.scheme);
          if (!driver) {
            throw vfsError(
              'VFS_UNKNOWN_MOUNT',
              `未注册的挂载点: "${vfsPath.scheme}"`
            );
          }
          // 能力声明为只写不可达 ⇒ fail-closed 明确拒绝（不静默降级）
          if (!driver.capabilities.write) {
            throw vfsError(
              'VFS_READ_ONLY_MOUNT',
              `挂载点 ${vfsPath.scheme}:// 为只读，不支持写入`
            );
          }

          const result = await driver.write(vfsPath, {
            content: typeof input.content === 'string' ? input.content : '',
            mode: resolveWriteMode(input.mode),
          });

          span.setStatus({ code: SpanStatusCode.OK });
          return createToolResult(JSON.stringify(result));
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
