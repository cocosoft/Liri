// MIT License
// Copyright (c) 2026 190615273@qq.com

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { resolveDataDir } from '@modules/core/paths';
import { PlanDrivenLoop } from '../../core/loop/PlanDrivenLoop.js';
import type { PlanDrivenLoopResult } from '../../core/loop/PlanDrivenLoop.js';
import { createChatManagerTAORDeps } from '../../query/ChatManagerTAORAdapter.js';
import type { TAORLoop } from '../../query/TAORLoop.js';
import type { ChatSession } from '../types/session.js';
import { MessageService } from '../services/MessageService.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';
import { createProjectStore } from '../../workspace/ProjectStore.js';

const logger = getLogger('chat:pdcaLauncher');

export interface PdcaLauncherDeps {
  /** 是否启用 PlanDrivenLoop */
  enablePlanDrivenLoop: boolean;
  /** TAORLoop 工厂 */
  taorLoopFactory: (sessionId: string) => TAORLoop;
  /** 构建 TAOR 上下文 */
  buildTAORContext: (
    sessionId: string,
    toolDefinitions: any[],
    options?: any
  ) => any;
  /** 会话 map */
  sessionMap: Map<string, ChatSession>;
  /** 消息服务 */
  messageService: MessageService;
  /** 持久化消息 */
  persistMessage: (sessionId: string, message: any) => void;
}

/**
 * PDCA 启动器
 * 提取自 ChatManager._launchImplicitPdca（L2964-L3079，115 行）
 *
 * 职责：在项目上下文中，自动启动 PlanDrivenLoop 或 PDCA 编排器
 */
export class PdcaLauncher {
  constructor(private deps: PdcaLauncherDeps) {}

  async launch(
    projectId: string,
    description: string,
    sessionId: string,
    userMessage?: string,
    /**
     * S3（P1-5 §5 S3）：快速路径分流决策（ChatManager._shouldUsePlanDrivenLoop 两层过滤后）
     * 未传入时回退 deps.enablePlanDrivenLoop 静态开关。
     */
    useFastPath?: boolean
  ): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:pdcaLaunch', {
      'session.id': sessionId,
      'project.id': projectId,
    });

    try {
      // RC-E（08-09）+ S3（2026-08-13）：PlanDrivenLoop 快速路径（两层分流由 ChatManager 决策）
      if (useFastPath ?? this.deps.enablePlanDrivenLoop) {
        try {
          const taorLoop = this.deps.taorLoopFactory(sessionId);
          const taorContext = this.deps.buildTAORContext(
            sessionId,
            [],
            undefined
          );
          const deps = createChatManagerTAORDeps(taorContext);
          const planLoop = new PlanDrivenLoop({
            taorLoop,
            deps,
            sessionId,
            enableAutoDecompose: true,
            onStepProgress: (progress) => {
              logger.info('PlanDrivenLoop 进度', { sessionId, ...progress });
            },
          });
          const message = userMessage || description;
          void planLoop
            .run(message)
            .then((result: PlanDrivenLoopResult) => {
              logger.info('PlanDrivenLoop 执行完成', {
                sessionId,
                decomposed: result.decomposed,
                stepCount: result.stepCount,
                completedSteps: result.completedSteps,
                failedSteps: result.failedSteps,
                totalDurationMs: result.totalDurationMs,
              });
            })
            .catch((e) => {
              handleError(e, {
                module: 'chat:manager',
                action: 'planDrivenLoop_execute',
                context: { sessionId },
              });
            });
          return;
        } catch (err) {
          handleError(err, {
            module: 'chat:manager',
            action: 'planDrivenLoop_start',
            context: { sessionId },
          });
          // 回退到原有 PDCA 路径
        }
      }

      const taskId = `pdca_${Date.now().toString(36)}`;

      try {
        // 写入检查点
        const { writePdcaCheckpoint } =
          await import('../../tasks/PdcaWorkItemBridge');
        writePdcaCheckpoint(taskId, {
          taskId,
          status: 'started',
          description,
          sessionId,
          workspaceId: projectId,
          autoLaunched: true,
        });

        // 关联到项目 pdcaIds
        try {
          const dataDir = resolveDataDir();
          const wiStore = new WorkItemStore(dataDir);
          const pjStore = createProjectStore(dataDir, wiStore);
          if (!pjStore.listPdcaIds(projectId).includes(taskId)) {
            pjStore.addPdca(projectId, taskId);
          }
        } catch {
          /* skip */
        }

        // 启动编排器（隐性模式：不需要审批，不打断用户）
        const { getOrCreateOrchestrator } =
          await import('../../tasks/LongRunningTaskOrchestrator');
        const orchestrator = getOrCreateOrchestrator(taskId);
        // RC-C 修复（08-09）：注入 TAORLoop 使真实工具执行分支可达
        const taskTaorLoop = this.deps.taorLoopFactory(sessionId);
        orchestrator.setTAORLoop(taskTaorLoop);
        void orchestrator
          .runFullPdca(description, sessionId, {
            requirePlanApproval: false,
            // §5 P1: 任务消息回写原始对话会话
            onTaskMessage: (sid, msgs) => {
              if (!this.deps.sessionMap.has(sid)) return;
              for (const m of msgs) {
                this.deps.persistMessage(
                  sid,
                  this.deps.messageService.createAssistantMessage(m.content, {
                    sessionId: sid,
                    metadata: { taskId, isTaskMessage: true },
                  })
                );
              }
            },
          })
          .catch((e) => {
            handleError(e, {
              module: 'chat:manager',
              action: 'implicitPdca_execute',
              context: { taskId, projectId },
            });
          });
      } catch {
        /* 隐性 PDCA 启动失败不影响主流程 */
      }
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }
}
