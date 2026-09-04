// MIT License
// Copyright (c) 2026 190615273@qq.com

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { resolveDataDir } from '@modules/core/paths';
import { configManager } from '@modules/config';
import { PlanDrivenLoop } from '@modules/core';
import type { PlanDrivenLoopResult } from '@modules/core';
import type { AIProvider } from '@modules/ai';
import { registerPlanLoop, unregisterPlanLoop } from '../planAbortRegistry.js';
import { createChatManagerTAORDeps } from '@modules/query';
import type { TAORLoop } from '@modules/query';
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
  /** 可选：任务分解 LLM Provider（PlanDrivenLoop 转正 2026-09-01；不提供则 TaskDecomposer 简单分解单子任务） */
  getDecomposerProvider?: () => Promise<AIProvider | null>;
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
      // P0-E（2026-08-14）：PDCA 任务标识提前定义（两个路径共用），用于过程消息回写
      const taskId = `pdca_${Date.now().toString(36)}`;

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
          // P0-E：百分比档位节流——仅在进度跨越 25%/50%/75%/完成 时回写一条对话消息，
          // 长任务最多 4 条（跳过 0% 首条），既保证 PDCA 过程可见又不刷屏。
          // 频率说明：onStepProgress 每步仅回调 1~2 次（markStepRunning + 步骤结束），
          // 本身为低频；档位节流在此基础上进一步限制消息条数，无性能/卡顿风险。
          let lastReportedBucket = -1;
          // 转正（2026-09-01）：注入任务分解 Provider——分解失败/未提供时 TaskDecomposer
          // 自动降级为简单分解（单子任务），不阻断 PlanDrivenLoop 路径
          const decomposerProvider =
            (await this.deps.getDecomposerProvider?.()) ?? undefined;
          const planLoop = new PlanDrivenLoop({
            taorLoop,
            deps,
            sessionId,
            enableAutoDecompose: true,
            decomposerProvider,
            onStepProgress: (progress) => {
              // 详细日志：记录每次进度回调的原始数据 + 档位计算（total/isDone/bucket/lastReportedBucket）
              const total = progress.total || progress.completed;
              const isDone = progress.completed >= total;
              const bucket = isDone
                ? 4
                : Math.min(3, Math.floor((progress.completed / total) * 4));
              logger.info('PlanDrivenLoop 进度回调', {
                sessionId,
                ...progress,
                computed: {
                  total,
                  isDone,
                  bucket,
                  lastReportedBucket,
                  // 对比校验：自算百分比与原始 percent 应一致（同源公式），偏差非 0 说明计算链路有分歧
                  derivedPct:
                    total > 0
                      ? Math.round((progress.completed / total) * 100)
                      : 0,
                  pctDiff:
                    progress.percent !== undefined
                      ? Math.round(
                          (progress.completed / (total > 0 ? total : 1)) * 100
                        ) - progress.percent
                      : null,
                  pctAligned:
                    progress.percent !== undefined &&
                    Math.round(
                      (progress.completed / (total > 0 ? total : 1)) * 100
                    ) === progress.percent,
                },
              });
              try {
                if (total <= 0) {
                  logger.warn('PlanDrivenLoop 进度跳过：total<=0', {
                    sessionId,
                    total,
                    completed: progress.completed,
                  });
                  return;
                }
                // 跳过 0% 首条（markStepRunning 触发，completed=0 时无进展意义）
                if (progress.completed <= 0) return;
                if (bucket <= lastReportedBucket) return;
                lastReportedBucket = bucket;
                logger.info('PlanDrivenLoop 档位切换，触发进度消息回写', {
                  sessionId,
                  bucket,
                  completed: progress.completed,
                  total,
                  isDone,
                  pct: Math.round((progress.completed / total) * 100),
                });
                const pct = Math.round((progress.completed / total) * 100);
                const failedNote =
                  progress.failed > 0 ? `，${progress.failed} 步失败` : '';
                const summary = isDone
                  ? `PDCA 执行完成：${progress.completed}/${total} 步${failedNote}`
                  : `已完成 ${progress.completed}/${total} 步（进度 ${pct}%）${failedNote}`;
                this.deps.persistMessage(
                  sessionId,
                  this.deps.messageService.createAssistantMessage(
                    `${isDone ? '✅' : '🔁'} ${summary}`,
                    {
                      sessionId,
                      metadata: {
                        taskId,
                        isTaskMessage: true,
                        taskType: 'pdca-progress',
                      },
                    }
                  )
                );
              } catch {
                // 进度回写失败不影响循环（@ignore-catch）
              }
            },
          });
          const message = userMessage || description;
          // 4.0-2 N1（2026-09-04）：PDL 快速路径注册任务实体（checkpoint）——
          // /v1/pdca/list 权威源=checkpoint 目录 + 内存 orchestrator；此前 PDL 无实体，
          // 编排视图看不到快速路径运行。注册后单源可见（pdca:* 事件已双路发出）。
          const { writePdcaCheckpoint } = await import(
            '../../tasks/PdcaWorkItemBridge'
          );
          const startedAt = new Date().toISOString();
          writePdcaCheckpoint(taskId, {
            taskId,
            phase: 'execute',
            status: 'running',
            sessionId,
            projectId,
            description: description.slice(0, 200),
            startedAt,
          });
          try {
            const result = await planLoop.run(message);
            writePdcaCheckpoint(taskId, {
              taskId,
              phase: 'execute',
              status: 'completed',
              sessionId,
              projectId,
              description: description.slice(0, 200),
              completedAt: new Date().toISOString(),
              startedAt,
              stepCount: result.stepCount,
              completedSteps: result.completedSteps,
              failedSteps: result.failedSteps,
            });
            logger.info('PlanDrivenLoop 执行完成', {
              sessionId,
              decomposed: result.decomposed,
              stepCount: result.stepCount,
              completedSteps: result.completedSteps,
              failedSteps: result.failedSteps,
              totalDurationMs: result.totalDurationMs,
            });
          } catch (e) {
            writePdcaCheckpoint(taskId, {
              taskId,
              phase: 'execute',
              status: 'failed',
              sessionId,
              projectId,
              description: description.slice(0, 200),
              failedAt: new Date().toISOString(),
              startedAt,
            });
            handleError(e, {
              module: 'chat:manager',
              action: 'planDrivenLoop_execute',
              context: { sessionId },
            });
          } finally {
            unregisterPlanLoop(sessionId, planLoop);
          }
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

      try {
        // 关联到项目 pdcaIds（父任务登记；阶段链 checkpoint 由 StageOrchestrator 持久化）
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

        // D1（M7，2026-08-13）：隐性模式改按阶段策略——需求阶段产出 PRD 后 stage_approval
        // 审批，approve 才进设计（"先商量后执行"真正落地）。父 checkpoint 承载阶段链状态。
        const { StageOrchestrator, buildStagePrompt, collectStageArtifact } =
          await import('../../tasks/StageOrchestrator');
        const { getOrCreateOrchestrator } =
          await import('../../tasks/LongRunningTaskOrchestrator');

        // §5 P1: 任务消息回写原始对话会话
        const onTaskMessage = (
          sid: string,
          msgs: Array<{ role: string; content: string }>
        ) => {
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
        };

        // D3 消费（偏差 2 闭环）：从 RequirementTracker 查询该项目已注册需求，
        // 取最近一条 requirementId 关联到阶段链——ImplicitEngineHook 已注册
        // requirementId（requirements.json），此处让阶段链真正消费（prompt 注入
        // → 产物 → 交付清单全程携带，需求→产物证据可追溯）。
        let requirementId: string | undefined;
        try {
          const { createRequirementTracker } =
            await import('../../project/RequirementTracker');
          const reqs = createRequirementTracker(projectId).list();
          requirementId =
            reqs.length > 0 ? reqs[reqs.length - 1].id : undefined;
        } catch {
          /* 无需求登记时不关联（阶段链正常运行） */
        }

        const stageOrch = StageOrchestrator.create(
          taskId,
          description,
          sessionId,
          {
            runStage: async (stage, chain) => {
              const child = getOrCreateOrchestrator(stage.pdcaTaskId);
              // B5（2026-09-04）：仅注入每步独立工厂——原同时 setTAORLoop(共享) +
              // setTAORLoopFactory，executeSingleStep 优先 factory(taskId)（taskId≠sessionId），
              // 共享实例实际被忽略形成双轨；并行安全由 factory 保证。
              child.setTAORLoopFactory(this.deps.taorLoopFactory);
              await child.runFullPdca(
                buildStagePrompt(stage, chain),
                chain.sessionId,
                {
                  requirePlanApproval: false,
                  onTaskMessage,
                }
              );
              return {
                artifact: collectStageArtifact(child),
                // D4（M4）：阶段边界显式回写 token（成本护栏数据源）
                tokens: child.getTokenUsage(),
              };
            },
          },
          {
            // D4（M4）：全局成本护栏配置（PDCA_BUDGET_LIMIT_TOKENS / PDCA_BUDGET_POLICY）
            budgetLimitTokens: (() => {
              const raw = configManager.env('PDCA_BUDGET_LIMIT_TOKENS');
              const val = raw && !isNaN(Number(raw)) ? Number(raw) : 0;
              return Math.max(0, val);
            })(),
            budgetPolicy:
              configManager.env('PDCA_BUDGET_POLICY') === 'warn'
                ? 'warn'
                : 'terminate',
          },
          // D3 消费（偏差 2）：需求追踪 ID 贯穿阶段链
          requirementId
        );

        // 4.0-1（2026-09-04）：await 到阶段链完成（同快速路径——锁覆盖整个执行期）
        await stageOrch
          .run()
          .then((s) => {
            logger.info('StageOrchestrator 阶段链状态', {
              taskId,
              sessionId,
              phase: s.phase,
              currentStage: s.currentStage,
            });
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
