/**
 * write_project_file 工具
 *
 * 向项目 sandbox 写入文件。AI 产出文件（报告、代码、分析等）时自动调用。
 * 路径安全校验：仅允许写入 sandboxPath 内的文件，防止路径穿越。
 *
 * MIT License - Copyright (c) 2026 Liri
 */

import type { Tool } from '../types/Tool';
import { createToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { resolveDataDir } from '@modules/core/paths';
import { createProjectStore } from '../../workspace/ProjectStore.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';
import { writeFileSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { resolve, normalize, dirname, basename, extname, join } from 'path';

const logger = getLogger('tools:write_project_file');

// P0-1 方案一 1b：交付类扩展名 —— 落盘后自动登记为项目「成果」
const DELIVERABLE_EXTENSIONS = new Set([
  '.docx',
  '.pptx',
  '.pdf',
  '.html',
  '.xlsx',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
]);

/**
 * 判断是否应为交付物（自动登记成果）。
 * 排除：临时/隐藏文件（路径任一段以 `_` 开头，如 _chk*.py、_pptx_preview/、_temp_*）。
 */
function isDeliverablePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((seg) => seg.startsWith('_'))) return false;
  return DELIVERABLE_EXTENSIONS.has(extname(relativePath).toLowerCase());
}

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

export class WriteProjectFileTool {
  static create(): Tool {
    return {
      name: 'write_project_file',
      description:
        '向项目文件夹写入文件。传入项目 ID、相对路径和文件内容。AI 产出物自动保存到项目文件夹。仅允许写入项目 sandbox 内的文件。',
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
          description: '相对于项目文件夹的文件路径（如 分析报告.md）',
          required: true,
        },
        {
          name: 'content',
          type: 'string',
          description: '要写入的文件内容',
          required: true,
        },
      ],
      aliases: ['write_project', 'save_to_project'],
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => false,
      isConcurrencySafe: () => true,

      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const otel = getOTelTracing();
        const span = otel.startSpan('WriteProjectFileTool.execute');
        try {
          const projectId = String(input.projectId || '');
          const relativePath = String(input.relativePath || '');
          const content = String(input.content || '');

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

          // 方案二 2b：单段交付类文件（无目录前缀）自动落入 output/ 目录，
          // 与提示词目录约定一致，避免交付物散落在项目根目录
          let targetRelative = relativePath;
          if (isDeliverablePath(relativePath) && !/[\\/]/.test(relativePath)) {
            targetRelative = join('output', relativePath);
          }

          // 路径安全校验
          const rawPath = resolve(sandboxPath, normalize(targetRelative));

          // 确保 sandbox 存在（P0-3: 不存在则自动创建，与上传接口行为对齐；
          // 自动建项目 delaySandbox 场景首次写入时在此落点创建）
          if (!existsSync(sandboxPath)) {
            mkdirSync(sandboxPath, { recursive: true });
            logger.info('自动创建项目文件夹', {
              projectId,
              sandboxPath,
            });
          }

          // realpath 校验（sandbox 必须存在才能调用 realpath）
          const realSandbox = realpathSync(sandboxPath);

          // 如果目标文件已存在，检查是否在 sandbox 内
          if (existsSync(rawPath)) {
            const realTarget = realpathSync(rawPath);
            if (
              !realTarget.startsWith(realSandbox + '\\') &&
              !realTarget.startsWith(realSandbox + '/')
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
          } else {
            // 新文件：先创建父目录，再逐级 realpath 防 symlink 逃逸
            const parentDir = dirname(rawPath);
            if (!existsSync(parentDir)) {
              mkdirSync(parentDir, { recursive: true });
            }
            // 逐级向上校验各级目录均在 sandbox 内
            let checkDir = parentDir;
            while (true) {
              if (existsSync(checkDir)) {
                const realCheck = realpathSync(checkDir);
                if (
                  !realCheck.startsWith(realSandbox + '\\') &&
                  !realCheck.startsWith(realSandbox + '/')
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
              }
              const next = dirname(checkDir);
              if (next === checkDir || next.length < realSandbox.length) break;
              checkDir = next;
            }
          }

          writeFileSync(rawPath, content, 'utf-8');

          logger.info('项目文件已写入', { projectId, path: targetRelative });

          // P0-1 方案一 1b：交付类文件自动登记为项目「成果」，让成果面板立即可见
          try {
            if (isDeliverablePath(targetRelative)) {
              const { ProjectArtifactStore } =
                await import('../../project/ProjectArtifactStore.js');
              const artifactStore = new ProjectArtifactStore(
                join(resolveDataDir(), 'projects')
              );
              artifactStore.save({
                // 以「write + projectId + 相对路径」为稳定 id，重复写同路径走 upsert 更新
                id: `write:${projectId}:${targetRelative}`,
                projectId,
                kind: 'output',
                sessionId: context.sessionId,
                title: basename(targetRelative),
                content: targetRelative,
                createdAt: new Date().toISOString(),
              });
            }
          } catch (e) {
            logger.warn('成果自动登记失败', {
              projectId,
              path: targetRelative,
              error: String(e),
            });
          }

          span.setStatus({ code: SpanStatusCode.OK });
          return createToolResult(
            // 方案六 P2-2：返回绝对沙箱路径 + 字节数，供 AI 落盘后校验（防误报交付）
            JSON.stringify({
              path: targetRelative,
              sandboxPath,
              size: Buffer.byteLength(content, 'utf-8'),
            }),
            {
              newMessages: [
                {
                  role: 'assistant' as const,
                  content: `文件已保存到项目文件夹: ${targetRelative}`,
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
            module: 'tools:write_project_file',
            action: 'execute',
          });
          const msg = error instanceof Error ? error.message : '未知错误';
          logger.error('写入项目文件失败', { error: msg });
          return createToolResult(null, {
            newMessages: [
              { role: 'assistant' as const, content: `写入文件失败: ${msg}` },
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
