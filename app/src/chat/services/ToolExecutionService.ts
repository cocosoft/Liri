// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ToolExecutionService — 工具执行服务
 *
 * P3（08-09）：从 ChatManager 提取 executeTool + _executeToolInternal，
 * 降低 ChatManager 上帝类复杂度。
 *
 * 依赖注入：所有 ChatManager 实例依赖通过构造函数注入，服务本身无状态。
 */

import fs from 'fs';
import { join } from 'path';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { ErrorHandler } from '@modules/core';
import { convergenceDetector } from '../services/ConvergenceDetector.js';
import { eventNotificationService } from '../services/EventNotificationService.js';
import { toolResultRegistry } from '../../tool/ToolResultRegistry.js';
import { resolveDataDir, resolveProjectRoot } from '@modules/core/paths';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
import { withToolTimeout } from './ToolTimeoutWrapper.js';
import type { ToolCall, ToolResult, ToolIntegration } from '../types/tool.js';
import type { ChatSession } from '../types/session.js';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { RollbackIntegration, FileOperation } from '@modules/security';

const logger = getLogger('chat:toolExecution');

/* ===================================================================
 *  ToolExecutionDeps — 服务依赖接口
 * =================================================================== */

export interface ToolExecutionDeps {
  getToolRegistry: () => unknown;
  getToolIntegration: () => ToolIntegration | null;
  getPermissionManager: () => unknown;
  imageContextService: ImageContextService;
  rollbackIntegrations: Map<string, RollbackIntegration>;
  sessionGateway: {
    getSession(sessionId: string): Promise<unknown>;
  };
  chatSessions: Map<string, ChatSession>;
  currentSessionId: string;
  enableErrorHandler: boolean;
  submitToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    toolCallId: string,
    approvalReason?: string
  ): Promise<boolean>;
  getSessionWorkspacePath(sessionId?: string): string | null | undefined;
  getSessionWorkspaceId(sessionId?: string): string | undefined;
  isCommandApproved(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): Promise<boolean>;
}

/* ===================================================================
 *  ToolExecutionService
 * =================================================================== */

export class ToolExecutionService {
  constructor(public readonly deps: ToolExecutionDeps) {}

  /* ===============================================================
   *  execute() — 工具执行入口（原 ChatManager.executeTool）
   * =============================================================== */

  async execute(
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：opts 增加 onProgress（工具细粒度进度回调）
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ): Promise<ToolResult> {
    const otel = getOTelTracing();
    const toolSpan = otel.startSpan(`chat.executeTool.${toolCall.name}`, {
      'tool.name': toolCall.name,
    });
    try {
      // Phase 2: ErrorHandler 双路径
      if (opts?.useErrorHandler && this.deps.enableErrorHandler) {
        try {
          const handled = await ErrorHandler.handleAsync(
            () =>
              withToolTimeout(
                () => this._executeInternal(toolCall, opts?.onProgress),
                toolCall
              ),
            { recoveryStrategy: 'retry', maxRetries: 2 }
          );
          return handled.success && handled.result
            ? handled.result
            : {
                toolCallId: toolCall.id ?? '',
                toolName: toolCall.name,
                error: handled.error
                  ? String(handled.error)
                  : 'Tool execution failed',
              };
        } catch (err) {
          await handleError(err, {
            module: 'chat:toolExecution',
            action: 'executeTool_errorHandler_fallback',
          });
          logger.warn('ErrorHandler failed, falling back to direct execution', {
            error: err instanceof Error ? err.message : String(err),
          });
          return withToolTimeout(
            () => this._executeInternal(toolCall, opts?.onProgress),
            toolCall
          );
        }
      }
      const result = await withToolTimeout(
        () => this._executeInternal(toolCall, opts?.onProgress),
        toolCall
      );
      // Phase 2: 收敛检测
      try {
        convergenceDetector.recordToolCall(
          toolCall.sessionId ?? '',
          toolCall.name,
          !result.error,
          toolCall.arguments as Record<string, unknown> | undefined
        );
      } catch (err) {
        logger.debug('convergenceDetector.recordToolCall skipped', {
          toolName: toolCall.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    } catch (err) {
      await handleError(err, {
        module: 'chat:toolExecution',
        action: 'executeTool_fallback',
      });
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      toolSpan.end();
    }
  }

  /* ===============================================================
   *  _executeInternal() — 工具执行核心逻辑（原 ChatManager._executeToolInternal）
   * =============================================================== */

  private async _executeInternal(
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：透传 onProgress 到 registry.executeTool → tool.execute
    onProgress?: (progress: {
      toolUseID: string;
      data: Record<string, unknown>;
    }) => void
  ): Promise<ToolResult> {
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
    };

    // ── 本地查询工具 ──
    if (normalizedToolCall.name === 'get_tool_result') {
      const targetId = normalizedToolCall.arguments.tool_call_id as string;
      const stored = toolResultRegistry.findByCallId(targetId);
      logger.info('LLM 查询工具结果', {
        toolCallId: toolCall.id,
        targetId,
        found: !!stored,
      });
      if (!stored) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: { found: false, toolCallId: targetId },
          error: undefined,
        };
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { found: true, toolCall: stored },
        error: undefined,
      };
    }

    if (normalizedToolCall.name === 'list_tool_calls') {
      const targetRound = normalizedToolCall.arguments.round as
        | number
        | undefined;
      const sessionId =
        (normalizedToolCall.arguments.sessionId as string) ||
        this.deps.currentSessionId ||
        '';
      let calls: Array<{
        toolCallId: string;
        toolName: string;
        round: number;
        hasError: boolean;
        timestamp: number;
      }>;
      if (targetRound && sessionId) {
        calls = toolResultRegistry
          .listByRound(sessionId, targetRound)
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }));
      } else if (sessionId) {
        calls = toolResultRegistry.listBySession(sessionId).map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          round: c.round,
          hasError: !!c.result.error,
          timestamp: c.timestamp,
        }));
      } else {
        calls = toolResultRegistry
          .listAll()
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }))
          .slice(0, 50);
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: {
          toolCalls: calls,
          total: calls.length,
          sessionId: sessionId || undefined,
        },
        error: undefined,
      };
    }

    // ── 权限检查 ──
    if (this.deps.getPermissionManager()) {
      const pm = this.deps.getPermissionManager() as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>,
          context?: { sessionId?: string }
        ) => Promise<{
          allowed: boolean;
          reason?: string;
          decision?: { behavior: string; reason?: string };
          submittedToInbox?: boolean;
        }>;
      };
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments,
        { sessionId: toolCall.sessionId }
      );

      if (!permissionResult.allowed) {
        if (permissionResult.decision?.behavior === 'ask') {
          const approvedHit = await this.deps.isCommandApproved(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId
          );
          if (!approvedHit) {
            if (permissionResult.submittedToInbox === true) {
              const approvalResult = {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批，已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
              } as const;
              eventNotificationService.emitCustomEvent('tool:completed', {
                toolName: normalizedToolCall.name,
                sessionId: toolCall.sessionId,
                toolCallId: toolCall.id,
                resultData: approvalResult,
              });
              return {
                toolCallId: toolCall.id,
                toolName: normalizedToolCall.name,
                result: approvalResult,
                error: undefined,
              };
            }
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `需要用户确认: ${permissionResult.reason || 'Tool requires approval'}`,
            };
          }
        } else {
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result: null,
            error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
          };
        }
      }
    }

    // 排查 J-1.4：权限通过（含放行缓存命中）后继续执行——记录 sessionId 是否透传（BashTool 放行缓存依赖）
    logger.info('executeTool: 权限通过，继续执行', {
      toolName: normalizedToolCall.name,
      toolCallId: toolCall.id,
      sessionId: toolCall.sessionId,
    });

    // ── 回滚：文件操作前追踪 ──
    if (
      normalizedToolCall.name === FILE_WRITE_TOOL_NAME ||
      normalizedToolCall.name === FILE_EDIT_TOOL_NAME
    ) {
      const filePath = normalizedToolCall.arguments?.file_path as
        | string
        | undefined;
      if (filePath && toolCall.sessionId) {
        const integration = this.deps.rollbackIntegrations.get(
          toolCall.sessionId
        );
        if (integration) {
          const op: FileOperation = { path: filePath, type: 'modified' };
          integration.onToolBeforeExecute(op).catch((err) => {
            logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
            handleError(err, {
              module: 'chat:toolExecution',
              action: 'rollback:onToolBeforeExecute',
            }).catch(() => {});
          });
        }

        this.deps.sessionGateway
          .getSession(toolCall.sessionId)
          .then((rawSess) => {
            const sess = rawSess as ChatSession | null | undefined;
            const parentId = sess?.metadata?.parentSessionId as
              | string
              | undefined;
            if (parentId) {
              const parentIntegration =
                this.deps.rollbackIntegrations.get(parentId);
              if (parentIntegration) {
                const op: FileOperation = { path: filePath, type: 'modified' };
                parentIntegration.onToolBeforeExecute(op).catch((err) => {
                  logger.debug('子Agent操作继承失败', {
                    error: String(err),
                    parentSessionId: parentId,
                  });
                });
              }
            }
          })
          .catch(() => {
            // 非关键路径
          });
      }
    }

    // ── 图像路径校验 ──
    const IMAGE_INPUT_TOOLS = new Set(['image_analysis', 'image']);
    const IMAGE_TOOL_NAMES = new Set([
      ...IMAGE_INPUT_TOOLS,
      'image_svg_generate',
      'canvas',
    ]);
    if (IMAGE_INPUT_TOOLS.has(normalizedToolCall.name) && toolCall.sessionId) {
      const args = normalizedToolCall.arguments;
      let inputPath = (args.inputPath || args.file_path || args.path) as
        | string
        | undefined;

      if (!inputPath && normalizedToolCall.name === 'canvas') {
        const elements = args.elements as Array<{ src?: string }> | undefined;
        if (Array.isArray(elements) && elements.length > 0 && elements[0].src) {
          inputPath = elements[0].src;
        }
      }

      if (!inputPath) {
        const ctx = this.deps.imageContextService.getImageContext(
          toolCall.sessionId
        );
        if (ctx) {
          if (normalizedToolCall.name === 'image') {
            inputPath =
              ctx.lastEditedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastAnalyzedImage?.filePath;
          } else {
            inputPath =
              ctx.lastAnalyzedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastEditedImage?.filePath;
          }
          if (inputPath) {
            logger.info('工具调用 inputPath 为空，从 imageContext 自动补全', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              autoFilledPath: inputPath,
            });
            normalizedToolCall.arguments = { ...args, inputPath };
          }
        }
      }

      if (inputPath) {
        let knownPaths = this.deps.imageContextService.getKnownImagePaths(
          toolCall.sessionId
        );

        try {
          const session = this.deps.chatSessions.get(toolCall.sessionId);
          const projectId = session?.metadata?.projectId as string | undefined;
          if (projectId) {
            const { createProjectStore } =
              await import('../../workspace/ProjectStore.js');
            const { WorkItemStore } =
              await import('../../workspace/WorkItemStore.js');
            const store = createProjectStore(
              resolveDataDir(),
              new WorkItemStore(resolveDataDir())
            );
            const project = store.get(projectId);
            if (project?.sandboxPath && fs.existsSync(project.sandboxPath)) {
              const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
              const collect = (dir: string, depth: number): string[] => {
                if (depth > 3) return [];
                let out: string[] = [];
                let entries: import('fs').Dirent[] = [];
                try {
                  entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch {
                  return out;
                }
                for (const e of entries) {
                  if (out.length >= 200) break;
                  const full = join(dir, e.name);
                  if (e.isDirectory()) {
                    if (e.name.startsWith('_')) continue;
                    out = out.concat(collect(full, depth + 1));
                  } else if (
                    e.isFile() &&
                    IMAGE_EXTS.some((x) => e.name.toLowerCase().endsWith(x))
                  ) {
                    out.push(full);
                  }
                }
                return out;
              };
              knownPaths = knownPaths.concat(collect(project.sandboxPath, 0));
            }
          }
        } catch {
          // @ignore-catch
        }

        if (knownPaths.length > 0 && !knownPaths.includes(inputPath)) {
          const closestPath = this.deps.imageContextService.findClosestPath(
            inputPath,
            knownPaths
          );

          if (closestPath) {
            logger.warn('工具调用路径不匹配，自动修正为最接近的已知路径', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              correctedPath: closestPath,
            });
            normalizedToolCall.arguments = { ...args, inputPath: closestPath };
          } else {
            logger.error('工具调用路径不在已知集合中，拒绝执行', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              knownPaths,
            });
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `Invalid path: ${inputPath} is not in known image paths. Available paths: ${knownPaths.join(', ')}`,
            };
          }
        }
      }
    }

    // ── 工具执行 ──
    if (this.deps.getToolRegistry()) {
      try {
        const context = {
          toolUseId: normalizedToolCall.id,
          sessionId: toolCall.sessionId,
          options: {
            cwd:
              this.deps.getSessionWorkspacePath(toolCall.sessionId) ??
              resolveProjectRoot(),
            workspaceId: this.deps.getSessionWorkspaceId(toolCall.sessionId),
            env: process.env as Record<string, string>,
          },
        };

        const registry = this.deps.getToolRegistry() as unknown as {
          executeTool: (
            params: { toolName: string; input: Record<string, unknown> },
            context: {
              toolUseId: string;
              options: Record<string, unknown>;
            },
            // 2026-08-24 进度链路打通：registry.executeTool 透传 onProgress
            onProgress?: (progress: {
              toolUseID: string;
              data: Record<string, unknown>;
            }) => void
          ) => Promise<{
            result?: unknown;
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
            status?: string;
            requireApproval?: boolean;
            approvalReason?: string;
          }>;
        };
        const toolResult = await registry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context,
          onProgress
        );

        // 工具返回"需要审批"
        if (
          (toolResult as { requireApproval?: boolean }).requireApproval ===
            true ||
          (toolResult as { status?: string }).status === 'requires_approval'
        ) {
          const approvalReason = (toolResult as { approvalReason?: string })
            .approvalReason;
          const submitted = await this.deps.submitToolApproval(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId,
            toolCall.id,
            approvalReason
          );
          if (submitted) {
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批（${
                  approvalReason || '高风险操作'
                }），已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
              },
              error: undefined,
            };
          }
          const rawError =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : toolResult.metadata?.error
                ? String(toolResult.metadata.error)
                : undefined;
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result:
              (toolResult as { output?: string }).output ||
              toolResult.data ||
              toolResult.result,
            error: rawError,
          };
        }

        // 检查错误
        let error: string | undefined;
        if (toolResult.error) {
          error =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : JSON.stringify(toolResult.error);
        } else if (toolResult.metadata?.error) {
          error =
            typeof toolResult.metadata.error === 'string'
              ? toolResult.metadata.error
              : JSON.stringify(toolResult.metadata.error);
        }

        // 注册图像工具输出路径
        const resultData = (toolResult.data || toolResult.result) as
          | Record<string, unknown>
          | undefined;
        if (resultData && !error && toolCall.sessionId) {
          const extractedPaths =
            this.deps.imageContextService.extractImagePathsFromResult(
              normalizedToolCall.name,
              resultData
            );
          if (extractedPaths.length > 0) {
            this.deps.imageContextService.registerImagePaths(
              toolCall.sessionId,
              extractedPaths
            );
          }

          this.deps.imageContextService.updateImageContext(
            toolCall.sessionId,
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            resultData
          );

          if (
            (normalizedToolCall.name === 'glob' ||
              normalizedToolCall.name === 'FileSearch') &&
            Array.isArray(resultData) &&
            toolCall.sessionId
          ) {
            const searchPath =
              (normalizedToolCall.arguments?.path as string) || process.cwd();
            this.deps.imageContextService.confirmedPaths.addDirectoryListing(
              searchPath,
              resultData as string[]
            );
          }

          if (
            normalizedToolCall.name === 'image_generate' ||
            normalizedToolCall.name === 'image_display' ||
            normalizedToolCall.name === 'video_display' ||
            normalizedToolCall.name === 'audio_play' ||
            normalizedToolCall.name === 'create_project'
          ) {
            eventNotificationService.emitCustomEvent('tool:completed', {
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              toolCallId: toolCall.id,
              images: (resultData as Record<string, unknown>).images,
              resultData,
            });
          }
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data || toolResult.result,
          error,
          metadata: toolResult.metadata as Record<string, unknown> | undefined,
        };
      } catch (error) {
        handleError(error, {
          module: 'chat:toolExecution',
          action: '工具执行失败',
          context: {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
          },
        }).catch(() => {});
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (this.deps.getToolIntegration()) {
      try {
        return this.deps.getToolIntegration()!.executeTool(toolCall);
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      throw new AppError(
        'No tool integration or tool registry initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }
}
