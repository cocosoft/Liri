/**
 * read_project_file 工具
 *
 * 在项目 sandbox 中读取文件。AI 在项目上下文中使用此工具读取用户放入项目文件夹的文件。
 * 路径安全校验：仅允许读取 sandboxPath 内的文件，防止路径穿越。
 *
 * MIT License - Copyright (c) 2026 Liri
 */

import type { Tool } from '../types/Tool';
import { createToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { resolveDataDir } from '@modules/core/paths';
import { createProjectStore } from '../../workspace/ProjectStore.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';
import { readFileSync, existsSync, realpathSync } from 'fs';
import { resolve, join, normalize } from 'path';

const logger = new Logger({
  module: 'tools:read_project_file',
  level: LogLevel.INFO,
});

// P4-1: Store 单例化
let _workItemStore: WorkItemStore | null = null;
let _projectStore: ReturnType<typeof createProjectStore> | null = null;
function getStores() {
  if (!_workItemStore || !_projectStore) {
    const dataDir = resolveDataDir();
    _workItemStore = new WorkItemStore(dataDir);
    _projectStore = createProjectStore(dataDir, _workItemStore);
  }
  return { projectStore: _projectStore };
}

export class ReadProjectFileTool {
  static create(): Tool {
    return {
      name: 'read_project_file',
      description:
        '读取项目文件夹中的文件内容。传入项目 ID 和相对路径，返回文件内容。仅允许读取项目 sandbox 内的文件。',
      params: [
        {
          name: 'projectId',
          type: 'string',
          description: '项目 ID',
          required: true,
        },
        {
          name: 'relativePath',
          type: 'string',
          description: '相对于项目文件夹的文件路径',
          required: true,
        },
      ],
      aliases: ['read_project'],
      isEnabled: () => true,
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,

      execute: async (
        input: Record<string, unknown>,
        _context: ToolUseContext
      ) => {
        const otel = getOTelTracing();
        const span = otel.startSpan('ReadProjectFileTool.execute');
        try {
          const projectId = String(input.projectId || '');
          const relativePath = String(input.relativePath || '');

          span.setAttribute('projectId', projectId);

          if (!projectId || !relativePath) {
            span.setStatus({ code: SpanStatusCode.OK });
            return createToolResult(null, {
              newMessages: [
                {
                  role: 'assistant' as const,
                  content: '缺少 projectId 或 relativePath 参数',
                },
              ],
            });
          }

          const { projectStore } = getStores();

          const project = projectStore.get(projectId);
          if (!project) {
            span.setStatus({ code: SpanStatusCode.OK });
            return createToolResult(null, {
              newMessages: [
                {
                  role: 'assistant' as const,
                  content: `项目 ${projectId} 不存在`,
                },
              ],
            });
          }

          const sandboxPath = project.sandboxPath;
          if (!sandboxPath) {
            span.setStatus({ code: SpanStatusCode.OK });
            return createToolResult(null, {
              newMessages: [
                { role: 'assistant' as const, content: '项目未配置文件夹路径' },
              ],
            });
          }

          // 路径安全校验：resolve + normalize + realpath
          const rawPath = resolve(sandboxPath, normalize(relativePath));
          if (!existsSync(rawPath)) {
            span.setStatus({ code: SpanStatusCode.OK });
            return createToolResult(
              JSON.stringify({ error: '文件不存在', path: relativePath }),
              {
                newMessages: [
                  {
                    role: 'assistant' as const,
                    content: `文件不存在: ${relativePath}`,
                  },
                ],
              }
            );
          }

          const realPath = realpathSync(rawPath);
          const realSandbox = realpathSync(sandboxPath);
          if (
            !realPath.startsWith(realSandbox + '\\') &&
            !realPath.startsWith(realSandbox + '/')
          ) {
            span.setStatus({ code: SpanStatusCode.OK });
            return createToolResult(null, {
              newMessages: [
                {
                  role: 'assistant' as const,
                  content: '安全拒绝：文件路径超出项目文件夹范围',
                },
              ],
            });
          }

          const content = readFileSync(realPath, 'utf-8');
          const MAX_SIZE = 50 * 1024; // 50KB 限制
          const truncated =
            content.length > MAX_SIZE
              ? content.slice(0, MAX_SIZE) +
                `\n\n... (文件过大，已截断，完整大小: ${content.length} 字节)`
              : content;

          span.setStatus({ code: SpanStatusCode.OK });
          return createToolResult(truncated);
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          void handleError(error, {
            module: 'tools:read_project_file',
            action: 'execute',
          });
          const msg = error instanceof Error ? error.message : '未知错误';
          logger.error('读取项目文件失败', { error: msg });
          return createToolResult(null, {
            newMessages: [
              { role: 'assistant' as const, content: `读取文件失败: ${msg}` },
            ],
          });
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
