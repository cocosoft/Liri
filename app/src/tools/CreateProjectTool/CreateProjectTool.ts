/**
 * create_project 工具
 *
 * 允许 AI 在对话中直接创建项目，用户说"帮我建一个XX项目"时调用。
 * 复用 ProjectStore.create() 的统一底层。
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

const logger = new Logger({
  module: 'tools:create_project',
  level: LogLevel.INFO,
});

// P4-1: Store 单例化 — 避免每次 execute 都 new
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

export class CreateProjectTool {
  static create(): Tool {
    return {
      name: 'create_project',
      description:
        '创建一个新项目，用于跟踪复杂任务。当用户明确表达"创建项目/管理任务/追踪进度"意图时调用。',
      params: [
        {
          name: 'name',
          type: 'string',
          description: '项目名称',
          required: true,
        },
        {
          name: 'description',
          type: 'string',
          description: '项目描述（可选，AI 自动从对话摘要）',
          required: false,
        },
      ],
      aliases: ['new_project'],
      searchHint: 'create project workspace new',
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => false,
      isConcurrencySafe: () => true,

      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const otel = getOTelTracing();
        const span = otel.startSpan('CreateProjectTool.execute');
        try {
          const name = String(input.name || '未命名项目');
          const description = String(input.description || '');
          // P4-2: 从会话上下文取 workspaceId，fallback 到 'default'
          const workspaceId = context.sessionId || 'default';

          const { projectStore } = getStores();

          const project = projectStore.create({
            workspaceId,
            name,
            description,
          });

          span.setAttribute('projectId', project.id);

          logger.info('项目已创建', {
            projectId: project.id,
            name,
            workspaceId,
          });

          span.setStatus({ code: SpanStatusCode.OK });
          return createToolResult(
            JSON.stringify({
              projectId: project.id,
              name: project.name,
              sandboxPath: project.sandboxPath,
            }),
            {
              newMessages: [
                {
                  role: 'assistant' as const,
                  content: `项目「${name}」已创建。右侧面板会自动跟踪进度。`,
                },
              ],
            }
          );
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          void handleError(error, {
            module: 'tools:create_project',
            action: 'execute',
          });
          const msg = error instanceof Error ? error.message : '未知错误';
          logger.error('创建项目失败', { error: msg });
          return createToolResult(null, {
            newMessages: [
              {
                role: 'assistant' as const,
                content: `创建项目失败: ${msg}`,
              },
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
