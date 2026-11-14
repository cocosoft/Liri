// MIT License
// Copyright (c) 2026 190615273@qq.com

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { getOTelTracing } from '@openliri/infra/monitoring/otel';
import { resolveDataDir } from '@openliri/infra/environment';
import { configManager } from '@openliri/infra/config';
import { PlanDrivenLoop } from '@modules/tasks';
// P0-1（2026-11-10，demand 准入门）：PDL 快路径的交付留存（与 LRO 同一实现）
import { persistDemandDeliveryText } from '@modules/tasks';
import type {
  PlanDrivenLoopResult,
  PlanDrivenLoopConfig,
  // P2（2026-11-04，方案 §3.3）：阶段链继承的任务策略快照类型
  TaskPolicySnapshot,
} from '@modules/tasks';
import type { AIProvider, ChatMessage } from '@modules/ai';
import { registerPlanLoop, unregisterPlanLoop } from '../planAbortRegistry.js';
import { createChatManagerTAORDeps } from '@modules/query';
// P2-2（2026-11-06）：计划源合成（短指令 + 助手计划正文）
import { buildPdcaPlanSource } from './planSource';
import { pitfallRegistry } from '@modules/tasks';
// A7（2026-10-01）：研究编排改经 query 侧唯一装配点（不再直接构造编排器实例）
import { runResearchOrchestration } from '@modules/query';
import type { ResearchCallModel } from '@modules/query';
import type { TAORLoop } from '@modules/query';
import type { ChatSession } from '@modules/session/types/session.js';
import { MessageService } from '../services/MessageService.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';
import { createProjectStore } from '../../workspace/ProjectStore.js';
// T2-8 / `✅-17`（2026-10-13）：编排域只读投影（形态 A）
import { publishOrchestrationProjection } from '@openliri/infra/state/engine/orchestrationProjection';

const logger = getLogger('chat:pdcaLauncher');

/**
 * #28（2026-10-30）：正文是否像"被序列化的工具结果"（`{"data":…,"success":…}`）。
 *
 * 仅用于**写入侧兜底**：正常叙述文本极少以 `{` 开头且整体可 `JSON.parse`。
 * 命中即跳过回写（并 warn），避免原始 JSON 直达用户气泡。
 */
export function looksLikeSerializedJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** T2-8 只读一致性观测：已告警过的会话（一次性，避免长程编排重复噪声） */
const warnedNoParentExecution = new Set<string>();

export interface PdcaLauncherDeps {
  /** 是否启用 PlanDrivenLoop */
  enablePlanDrivenLoop: boolean;
  /** TAORLoop 工厂（S1/PR9：可选轮次预算乘子 + 私有实例，扩容续跑/级联中止用） */
  taorLoopFactory: (
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
  ) => TAORLoop;
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
  /** 可选：PlanDrivenLoop 工厂（P2-C 测试注入；默认内部 new PlanDrivenLoop） */
  planLoopFactory?: (config: PlanDrivenLoopConfig) => PlanDrivenLoop;
  /**
   * P2-2（2026-11-06）：会话工作区解析（与工具 cwd **同源**）。
   *
   * 用途：PDL 步骤 prompt 里告知模型"所有文件读写以此目录为准"，避免模型声称
   * "没有文件路径/工具"而空转（真机 step1 5 秒即 blocked）。可选：未注入 ⇒ 不注入该行。
   */
  getSessionWorkspacePath?: (sessionId: string) => string | undefined;
}

/**
 * LRO-11（2026-10-26）：**执行模式提示文案**（纯函数，供单测）。
 *
 * 真机实证：用户无法从界面判断"编排接管了没有、是不是只跑了单步"，于是把 900+ 次
 * 工具调用的普通循环误认为"长任务已被编排"。此文案在**真正执行前**落一条会话消息。
 */
export function formatPdcaModeHint(
  mode: 'simple' | 'decomposed' | 'direct'
): string {
  if (mode === 'simple') {
    return (
      '🧭 已用编排接管：本次为**单步快速路径**（未分步）。\n' +
      '若需要严格分步与逐步验收，可用 `/goal start <描述>` 走经典阶段链。'
    );
  }
  if (mode === 'decomposed') {
    return '🧭 已用编排接管：本次**分步执行**（每步独立验收）。';
  }
  return '🧭 已用编排接管：本次**直执行**（任务分解未成功，降级为单步）。';
}

/**
 * P0-5（2026-11-06）：任务**终态回执**文案（纯函数，供单测）。
 *
 * 为什么需要：P0-4 把任务步骤消息默认从用户会话中分离（`isTaskMessage`），
 * 于是「任务完成 / 未达成 / 中止 / 等审批」也一并被隐藏 —— 用户只看到任务悄无声息地结束
 * （即 P0-5 的原始症状）。终态回执是**一条结论**，不是步骤消息 ⇒ 不设 `isTaskMessage`，
 * 保留在用户会话；步骤细节仍在编排面板与 `?includeTask=1` 审计视图里。
 */
export function formatPdcaTerminalNotice(input: {
  /** 终态档位（`awaitingApproval=true` 时不使用） */
  outcome?: 'completed' | 'partial' | 'aborted' | 'budget' | 'failed';
  /**
   * `true` = 任务停在「等待阶段审批」。
   *
   * 用布尔而非状态词汇（如 `awaiting_approval`）：本参数只是**回执呈现档位**，不是状态机状态；
   * 写成状态词汇会被 `lint:state-ratchet` 当成新的状态字面量出现点（需登记）。
   */
  awaitingApproval?: boolean;
  /**
   * 暂停来源（仅 `awaitingApproval=true` 时使用）：
   * - `stage`（缺省）= 阶段链在等**阶段审批**；
   * - `tool` = PDL 快路径的工具调用在等**用户批准**（审批卡片）。
   *
   * 为什么必须区分：两者恢复方式不同（编排面板 / 审批卡片），统一写成"等待阶段审批"
   * 会让用户在编排面板里找一个不存在的确认入口（会话 `session_mwdcivrue74d4838ff`）。
   */
  approvalSource?: 'stage' | 'tool';
  completed: number;
  total: number;
  /** partial 时的未达成数 */
  failed?: number;
  /** 依赖阻断未执行数 */
  blocked?: number;
  /** failed 时的原因（调用方已截断） */
  error?: string;
  /** 计量单位（步 / 阶段） */
  unit?: string;
}): string {
  const unit = input.unit ?? '步';
  const progress = `${input.completed}/${input.total} ${unit}完成`;
  const extra: string[] = [];
  if ((input.failed ?? 0) > 0 && input.outcome !== 'failed') {
    extra.push(`${input.failed} ${unit}未达成`);
  }
  if ((input.blocked ?? 0) > 0) {
    extra.push(`${input.blocked} ${unit}因依赖阻断未执行`);
  }
  const suffix = extra.length > 0 ? `（${extra.join('，')}）` : '';
  if (input.awaitingApproval) {
    if (input.approvalSource === 'tool') {
      return `⏸ 编排任务暂停：等待**工具审批**（${progress}${suffix}）。请在审批卡片（或收件箱）处理后继续；批准后会自动续跑，剩余步骤不会被执行。`;
    }
    return `⏸ 编排任务暂停：等待阶段审批（${progress}${suffix}）。请在编排面板确认后继续。`;
  }
  switch (input.outcome ?? 'completed') {
    case 'completed':
      return `✅ 编排任务完成：${progress}${suffix}。步骤详情见编排面板。`;
    case 'partial':
      return `⚠️ 编排任务未完全达成：${progress}${suffix}。步骤详情见编排面板。`;
    case 'aborted':
      return `⏹ 编排任务已中止：${progress}${suffix}。重新发送需求可继续。`;
    case 'budget':
      return `⚠️ 编排任务因预算耗尽结束：${progress}${suffix}。步骤详情见编排面板。`;
    case 'failed':
      return `❌ 编排任务执行失败${input.error ? `：${input.error}` : ''}。可重新发送需求重试。`;
    default:
      return `⚠️ 编排任务结束：${progress}${suffix}。`;
  }
}

/**
 * PDCA 启动器
 * 提取自 ChatManager._launchImplicitPdca（L2964-L3079，115 行）
 *
 * 职责：在项目上下文中，自动启动 PlanDrivenLoop 或 PDCA 编排器
 */
export class PdcaLauncher {
  constructor(private deps: PdcaLauncherDeps) {}

  /**
   * LRO-11：回写"本次执行模式"的**用户可见**消息（失败不影响编排）。
   *
   * 与 `onStepProgress` 的档位消息同通道（`isTaskMessage` + `taskType`），前端按类型渲染。
   */
  private _persistModeHint(
    sessionId: string,
    taskId: string,
    mode: 'simple' | 'decomposed' | 'direct'
  ): void {
    try {
      this.deps.persistMessage(
        sessionId,
        this.deps.messageService.createAssistantMessage(
          formatPdcaModeHint(mode),
          {
            sessionId,
            metadata: {
              taskId,
              isTaskMessage: true,
              taskType: 'pdca-mode',
            },
          }
        )
      );
    } catch (error) {
      // @ignore-catch — 提示消息回写失败不影响编排执行
      logger.warn('PDCA 执行模式提示回写失败', {
        sessionId,
        taskId,
        mode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  /**
   * P0-5（2026-11-06）：写一条**用户可见**的任务终态回执（**不设** `isTaskMessage`）。
   *
   * 与 `_persistModeHint` / 步骤消息的区别：那些是任务分区消息（P0-4 默认从用户会话分离），
   * 而终态回执是用户需要看到的**结论**。写入失败不影响编排（CS03）。
   */
  private _persistTerminalNotice(
    sessionId: string,
    taskId: string,
    text: string
  ): void {
    try {
      this.deps.persistMessage(
        sessionId,
        this.deps.messageService.createAssistantMessage(text, {
          sessionId,
          metadata: { taskId, taskType: 'pdca-final' },
        })
      );
    } catch (error) {
      /* @ignore-catch — 回执写入失败不影响编排执行 */
      logger.warn('PDCA 终态回执写入失败', {
        sessionId,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async launch(
    projectId: string,
    description: string,
    sessionId: string,
    userMessage?: string,
    /**
     * S3（P1-5 §5 S3）：快速路径分流决策（ChatManager._shouldUsePlanDrivenLoop 两层过滤后）
     * 未传入时回退 deps.enablePlanDrivenLoop 静态开关。
     */
    useFastPath?: boolean,
    /**
     * LRO-11（2026-10-26）：长任务信号升级 ⇒ 强制分解（压过消息长度门），
     * 并向用户回写一条"本次执行模式"的可见提示。
     *
     * B2（2026-11-09）：`demand` = 会话处于许愿式自主度 —— 阶段审批自动放行
     * （`StageOrchestrator.autoApproveStages`），子编排器执行"验收标准前置"校验。
     */
    opts?: { forceDecompose?: boolean; demand?: boolean }
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
          const planLoopConfig: PlanDrivenLoopConfig = {
            taorLoop,
            // P0-1 真并行（2026-09-06）：注入每步独立 TAOR 实例工厂——无依赖步骤批次并行
            // 的前提（共享实例状态无法并发）；taorLoopFactory 未注入时 PDL 回退单实例串行
            taorLoopFactory: this.deps.taorLoopFactory,
            deps,
            sessionId,
            // P2-2（2026-11-06）：步骤 prompt 需要工作区路径（与工具 cwd 同源）
            workspacePath: this.deps.getSessionWorkspacePath?.(sessionId),
            // OBS/C3（2026-09-06）：注入任务/项目归属 → stage 事件携带 taskId，前端可定位 PdcaPipeline
            taskId,
            projectId,
            // Teamwork P2b（2026-09-06）：P0-2 预留 recordPitfall 空钩子接真——步骤终败落
            // pitfall 注册表（跨任务经验沉淀，P1-2）
            recordPitfall: (rec) => {
              pitfallRegistry.record({
                description: rec.description,
                error: rec.error,
                source: 'pdl',
                contextSig: rec.taskId,
              });
            },
            // Teamwork P2b（2026-09-06）：P1-2 读取注入点——decompose 首步前检索最近
            // pdl 失败经验注入 prompt（无记录则返回空，行为零变化）
            pitfallRetriever: () => {
              const hits = pitfallRegistry.queryRecent({
                source: 'pdl',
                limit: 2,
              });
              return hits.length === 0
                ? ''
                : hits
                    .map(
                      (h, i) =>
                        `- ${h.rawDescription}（${h.occurrenceCount} 次）：${h.error.slice(0, 150)}`
                    )
                    .join('\n');
            },
            enableAutoDecompose: true,
            decomposerProvider,
            // LRO-11（2026-10-26）：长任务信号压过长度门 + 把"本次执行模式"回写成
            // 一条用户可见消息（此前用户只能从 PDCA 徽标猜，看不出是不是单步直执行）。
            forceDecompose: opts?.forceDecompose,
            // P0-1 跟进（2026-11-10）：复杂度门只看**用户原话**（`message` 是"用户消息 +
            // 助手计划正文"的增强源，长度会把短目标顶过阈值 ⇒ 过度分解，真机 `pdca_mw9q1h08`）
            ...(userMessage ? { classificationSource: userMessage } : {}),
            // P0-1（2026-11-10，demand 准入门）：许愿式会话走 PDL 时，验收标准前置
            // 由分解结果承接（缺失即 `PLAN_CRITERIA_MISSING`，不再强制上阶段链）
            demand: opts?.demand === true,
            onModeDecided: (mode) => {
              this._persistModeHint(sessionId, taskId, mode);
            },
            onStepProgress: (progress) => {
              // 详细日志：记录每次进度回调的原始数据 + 档位计算（total/isDone/bucket/lastReportedBucket）
              const total = progress.total || progress.completed;
              // LRO-12（2026-10-26）：**报完成必须有产物支撑** —— 步骤全打勾但零产物时
              // `percent` 被产物门压住（`artifactGated`），不得据此宣布"PDCA 执行完成"。
              // 2026-11-02（根因修复）：**"步骤跑完" ≠ "目标达成"** —— 必须同时满足
              // 无失败/无未执行、达成步数=总步数、且未被产物门压住。此前只看
              // `percent >= 100`，导致 5 步全部自述"信息不足/阻塞"仍播报"执行完成"。
              const isDone =
                progress.percent >= 100 &&
                progress.failed === 0 &&
                progress.cancelled === 0 &&
                progress.completed === total &&
                !progress.artifactGated;
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
                  // 对比校验：LRO-12 后 `percent` 受产物门约束 ⇒ pctDiff>0 表示
                  // "有完成步零产物"（gate），**不再**是计算链路分歧；无产物门时仍应一致
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
                  pct: progress.percent,
                });
                // LRO-12（2026-10-26）：正文用**产物门后的 percent**（不再自算 completed/total）
                const pct = progress.percent;
                const failedNote =
                  progress.failed > 0 ? `，${progress.failed} 步未达成` : '';
                // 2026-11-02：因空转熔断/依赖阻断**未执行**的步骤也要如实出现
                const skippedNote =
                  progress.cancelled > 0
                    ? `，${progress.cancelled} 步未执行`
                    : '';
                // 步骤都打勾但零产物 ⇒ 如实说明"进度不计"，避免用户以为卡死
                const gatedNote = progress.artifactGated
                  ? '（本任务尚未产出任何产物，进度不计）'
                  : '';
                const summary = isDone
                  ? `PDCA 执行完成：${progress.completed}/${total} 步${failedNote}`
                  : `⚠️ PDCA 未完全达成：${progress.completed}/${total} 步达成${failedNote}${skippedNote}（进度 ${pct}%）${gatedNote}`;
                this.deps.persistMessage(
                  sessionId,
                  this.deps.messageService.createAssistantMessage(
                    `${isDone ? '✅ ' : ''}${summary}`,
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
              } catch (error) {
                // 进度回写失败不影响循环（@ignore-catch）——P2-C：空 catch 无日志，
                // 失败静默；补 warn 留痕，使进度回写故障可观测
                logger.warn('PDCA 进度回写失败', {
                  sessionId,
                  taskId,
                  completed: progress.completed,
                  total,
                  bucket,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            },
          };
          const planLoop = this.deps.planLoopFactory
            ? this.deps.planLoopFactory(planLoopConfig)
            : new PlanDrivenLoop(planLoopConfig);
          // P2-2（2026-11-06）：用户末条常是「按计划执行」这类短指令 —— 计划正文在
          // 助手消息里，必须一并交给分解器（原 `userMessage || description` 会整段丢弃）。
          const message = buildPdcaPlanSource(userMessage, description);
          if (userMessage && message !== userMessage) {
            logger.info('pdca:plan_source_enriched', {
              sessionId,
              userLength: userMessage.length,
              assistantLength: description.length,
              planSourceLength: message.length,
            });
          }
          // 4.0-2 N1（2026-09-04）：PDL 快速路径注册任务实体（checkpoint）——
          // /v1/pdca/list 权威源=checkpoint 目录 + 内存 orchestrator；此前 PDL 无实体，
          // 编排视图看不到快速路径运行。注册后单源可见（pdca:* 事件已双路发出）。
          const { writePdcaCheckpoint } =
            await import('../../tasks/PdcaWorkItemBridge');
          const startedAt = new Date().toISOString();
          await writePdcaCheckpoint(taskId, {
            taskId,
            phase: 'execute',
            status: 'running',
            sessionId,
            projectId,
            description: description.slice(0, 200),
            startedAt,
            // P0-1（2026-11-10）：demand 目标也可走 PDL 快路径 ⇒ 检查点自带自主度身份
            // （否则 `stats:demand` 指标 4 会把许愿式任务算成 interactive）
            ...(opts?.demand ? { demand: true } : {}),
          });
          try {
            // S3 前置（2026-09-05，4.0 审计 §9.8）：补齐 registerPlanLoop 调用点——
            // 此前 loopBySession 恒空，abortSessionPlans（req close → 会话中止）对
            // PDL 快路径为空操作；register 后 unregister 仍由下方 finally 兜底。
            registerPlanLoop(taskId, sessionId, planLoop);
            const result = await planLoop.run(message);
            // PR1（#1）：用户中止不抛错、run() 正常返回并携带 aborted 标志——
            // 据此写 'abort' 终态，禁止无条件标 completed（导出排查锚点，T0a 已复核）。
            const aborted = result.aborted === true;
            // PR8（#9）：预算耗尽（成本护栏中止）按 failed 收尾，不误标 completed
            const budgetExhausted = result.budgetExhausted === true;
            // P0-1（2026-11-10，真机 `pdca_mw9q1h08`）：有未达成步骤 / 因依赖阻断未执行的步骤
            // **同样不是完成** —— 此前无条件写 'completed'（真机 0/1 步完成却报 completed），
            // 既误导用户，也让 `stats:demand`（指标 4）把失败任务算成收敛。
            const incomplete =
              result.failedSteps > 0 || result.blockedSteps.length > 0;
            // 2026-11-13：等待工具审批是**暂停态**，既不是完成也不是失败
            const paused = result.pausedForApproval === true;
            await writePdcaCheckpoint(taskId, {
              taskId,
              // 相位复用 LRO 的待审批相位 ⇒ 留存策略与 UI 都能识别"在等用户"
              phase: paused ? 'stage_awaiting_approval' : 'execute',
              status: paused
                ? 'running'
                : aborted
                  ? 'abort'
                  : budgetExhausted || incomplete
                    ? 'failed'
                    : 'completed',
              sessionId,
              projectId,
              description: description.slice(0, 200),
              completedAt:
                paused || aborted || budgetExhausted || incomplete
                  ? undefined
                  : new Date().toISOString(),
              abortedAt: aborted ? new Date().toISOString() : undefined,
              failedAt:
                !paused && (budgetExhausted || (!aborted && incomplete))
                  ? new Date().toISOString()
                  : undefined,
              startedAt,
              stepCount: result.stepCount,
              completedSteps: result.completedSteps,
              failedSteps: result.failedSteps,
              // P0-1：终态快照同样自描述（每份快照不依赖前一次合并写）
              ...(opts?.demand ? { demand: true } : {}),
            });
            logger.info('PlanDrivenLoop 执行完成', {
              sessionId,
              decomposed: result.decomposed,
              stepCount: result.stepCount,
              completedSteps: result.completedSteps,
              failedSteps: result.failedSteps,
              pausedForApproval: paused,
              totalDurationMs: result.totalDurationMs,
            });
            // 13-P1-1 Step 2（2026-10-06，`任务计划-20261004.md` §20.6）：**阻断结果回灌模型**。
            // 取证（F8）：被阻断步骤原先只落 plan 步 `cancelled` + SSE 广播（**用户**可见），
            // 模型侧完全不可见 ⇒ 模型无法据此重规划。此处改以助手消息**落盘**（复用既有
            // pdca-progress 通道）—— 落盘后即进入后续轮次的模型上下文（§1.6 模型可见 ⇔ 已落盘）。
            if (result.blockedSteps.length > 0) {
              try {
                this.deps.persistMessage(
                  sessionId,
                  this.deps.messageService.createAssistantMessage(
                    `⛔ 依赖阻断：${result.blockedSteps.length} 步未执行\n${result.blockedSteps
                      .map((b) => `- ${b.description}：${b.reason}`)
                      .join('\n')}`,
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
              } catch (error) {
                // @ignore-catch：回灌消息写入失败**不得**改变任务终态（下方 catch 会把任务误标 failed）
                logger.warn('依赖阻断回灌消息写入失败', {
                  sessionId,
                  taskId,
                  blocked: result.blockedSteps.length,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
            // P0-5（2026-11-06）：终态回执放在**最后** —— P0-4 过滤任务步骤消息后，这是用户
            // 唯一能看到的「任务结束了、结果如何」的结论（步骤细节仍在编排面板）。
            const terminalText = formatPdcaTerminalNotice(
              paused
                ? {
                    awaitingApproval: true,
                    approvalSource: 'tool',
                    completed: result.completedSteps,
                    total: result.stepCount,
                    blocked: result.blockedSteps.length,
                  }
                : {
                    outcome: aborted
                      ? 'aborted'
                      : budgetExhausted
                        ? 'budget'
                        : result.failedSteps > 0
                          ? 'partial'
                          : 'completed',
                    completed: result.completedSteps,
                    total: result.stepCount,
                    failed: result.failedSteps,
                    blocked: result.blockedSteps.length,
                  }
            );
            this._persistTerminalNotice(sessionId, taskId, terminalText);
            // P0-1（2026-11-10）：demand 分流到 PDL 快路径后不再经过 LRO 回执 ⇒
            // B3 的 `artifacts/<taskId>/delivery.md` 在此补写（同一实现，单一口径）
            if (opts?.demand) {
              persistDemandDeliveryText({
                taskId,
                sessionId,
                phase: paused
                  ? 'stage_awaiting_approval'
                  : aborted
                    ? 'abort'
                    : budgetExhausted || result.failedSteps > 0
                      ? 'failed'
                      : 'completed',
                text: terminalText,
              });
            }
          } catch (e) {
            await writePdcaCheckpoint(taskId, {
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
            // P0-5：失败也必须给用户一条可见结论（原先只写日志/检查点）
            const failedText = formatPdcaTerminalNotice({
              outcome: 'failed',
              completed: 0,
              total: 0,
              error: (e instanceof Error ? e.message : String(e)).slice(0, 160),
            });
            this._persistTerminalNotice(sessionId, taskId, failedText);
            // P0-1（2026-11-10）：demand 失败同样留交付回执（与 LRO 的 abort/failed 同口径）
            if (opts?.demand) {
              persistDemandDeliveryText({
                taskId,
                sessionId,
                phase: 'failed',
                text: failedText,
              });
            }
          } finally {
            unregisterPlanLoop(taskId, planLoop);
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
        const {
          StageOrchestrator,
          buildStagePrompt,
          collectStageArtifact,
          readStageChildOutcome,
        } = await import('../../tasks/StageOrchestrator');
        const { getOrCreateOrchestrator } =
          await import('../../tasks/LongRunningTaskOrchestrator');

        // §5 P1: 任务消息回写原始对话会话
        const onTaskMessage = (
          sid: string,
          msgs: Array<{ role: string; content: string }>
        ) => {
          if (!this.deps.sessionMap.has(sid)) return;
          for (const m of msgs) {
            // #28（2026-10-30）：任务回写只承载**叙述文本**。
            // tool 消息已有真实工具块，不该再以 assistant 气泡出现；
            // 另外兜底拦掉"整包 JSON"（真机 144 条 `{"data":…}` 气泡的来源），
            // 避免上游任何一处仍在 JSON.stringify 工具结果时再次污染会话。
            if (m.role !== 'assistant') continue;
            if (looksLikeSerializedJson(m.content)) {
              logger.warn('任务消息回写跳过：正文疑似序列化 JSON', {
                sessionId: sid,
                taskId,
                preview: m.content.slice(0, 80),
              });
              continue;
            }
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
            await import('@modules/project/RequirementTracker');
          const reqs = createRequirementTracker(projectId).list();
          requirementId =
            reqs.length > 0 ? reqs[reqs.length - 1].id : undefined;
        } catch {
          /* 无需求登记时不关联（阶段链正常运行） */
        }

        // T2-8 / `✅-17`（2026-10-13，形态 A）：编排**入口**只读上报 `PREPARED`（**不**承载
        // "断言/锁定"裁决 —— 四原语严格只读）；并做**只读一致性观测**：原文的「断言父上下文已转入
        // PREPARED」降级为**观测不到活跃执行即一次性 warn 如实标注**（**绝不阻断**编排启动）。
        // 受 `STATE_PROJECTION_BROADCAST`（默认关）门控 ⇒ 关时零发布、零行为变更。
        publishOrchestrationProjection({
          primitive: 'PREPARED',
          sessionId,
          orchestrationId: taskId,
        });
        if (!warnedNoParentExecution.has(sessionId)) {
          try {
            const { getExecutionManager } =
              await import('@openliri/service/execution');
            if (!getExecutionManager().getBySession(sessionId)) {
              warnedNoParentExecution.add(sessionId);
              logger.warn(
                '编排入口未观测到父上下文活跃执行（只读观测，不阻断）',
                { sessionId, taskId }
              );
            }
          } catch (e) {
            // @ignore-catch — 只读观测失败绝不影响编排启动
            logger.debug('编排入口只读观测失败（忽略）', {
              sessionId,
              error: String(e),
            });
          }
        }

        // P2（2026-11-04，方案 §3.3）：阶段链共享的策略快照（首个阶段采样，后续继承）
        let chainPolicySnapshot: TaskPolicySnapshot | undefined;
        const stageOrch = StageOrchestrator.create(
          taskId,
          description,
          sessionId,
          {
            // P2（2026-11-04，方案 §3.3）：**阶段链只采样一次策略快照**，后续阶段继承。
            // 否则"第 2 阶段开始时"会重新读会话设置 ⇒ 用户中途改档仍会漂移。
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
                  // B2（2026-11-09）：demand 会话 —— 每个阶段子编排器同样执行
                  // "验收标准前置"校验（缺失即失败回执，不带病开工）
                  ...(opts?.demand ? { demand: true } : {}),
                  ...(chainPolicySnapshot
                    ? { policySnapshot: chainPolicySnapshot }
                    : {}),
                }
              );
              // 首个阶段完成采样后，后续阶段统一继承（子任务自身不重新采样）
              chainPolicySnapshot =
                child.getPolicySnapshot() ?? chainPolicySnapshot;
              // B13（2026-11-09，真机 `pdca_mw9gube7_design` / `pdca_mw9hbaiy_requirement`）：
              // 子 PDCA 挂起或失败时 `runFullPdca` 都**正常返回** ⇒ 必须显式上报，
              // 否则阶段链把未完成的阶段误判为"阶段完成"（父级假 `completed`）
              return {
                artifact: collectStageArtifact(child),
                // D4（M4）：阶段边界显式回写 token（成本护栏数据源）
                tokens: child.getTokenUsage(),
                ...readStageChildOutcome(child),
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
          requirementId,
          // B2（2026-11-09）：demand 会话跳过阶段审批（"计划待确认"），一气呵成到交付
          // B13（2026-11-09）：父级检查点同样写入 demand 身份（此前只有子阶段检查点带）
          {
            autoApproveStages: opts?.demand === true,
            demand: opts?.demand === true,
          }
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
            // P0-5（2026-11-06）：阶段链终态回执（用户可见）—— 完成 / 失败 / 等审批
            const doneStages = s.stages.filter(
              (stage) => stage.status === 'completed'
            ).length;
            this._persistTerminalNotice(
              sessionId,
              taskId,
              formatPdcaTerminalNotice({
                outcome:
                  s.phase === 'completed'
                    ? 'completed'
                    : s.phase === 'failed'
                      ? 'failed'
                      : undefined,
                awaitingApproval:
                  s.phase !== 'completed' && s.phase !== 'failed',
                completed: doneStages,
                total: s.stages.length,
                unit: '阶段',
                error: s.phase === 'failed' ? '阶段执行失败' : undefined,
              })
            );
          })
          .catch((e) => {
            handleError(e, {
              module: 'chat:manager',
              action: 'implicitPdca_execute',
              context: { taskId, projectId },
            });
            // P0-5：阶段链异常同样给用户一条可见结论
            this._persistTerminalNotice(
              sessionId,
              taskId,
              formatPdcaTerminalNotice({
                outcome: 'failed',
                completed: 0,
                total: 0,
                error: (e instanceof Error ? e.message : String(e)).slice(
                  0,
                  160
                ),
              })
            );
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

  /**
   * P0-3（2026-09-06，Teamwork）：研究模式——候选生成 + 对抗批评编排。
   *
   * 触发：ChatManager 分流（研究型意图 hasResearchIntent && feature COMPETITIVE_STRATEGY），
   * 复用本 launcher 的 TAOR deps 组装 callModel，组合既有模块不引新运行时：
   * 候选生成（ParallelAgentScheduler 多视角并行）→ 对抗批评（VerifierAgent 逐一）→
   * BEST_SELECTION 收敛；被驳候选 objection 保留并随结果回写（失败路线不丢弃）。
   * 结果以 assistant 消息回写会话（taskType 'research'），不占用 PDCA 阶段链。
   */
  async launchResearch(
    projectId: string,
    description: string,
    sessionId: string,
    userMessage?: string
  ): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:researchLaunch', {
      'session.id': sessionId,
      'project.id': projectId,
    });
    const taskId = `research_${Date.now().toString(36)}`;
    const report = (text: string) => {
      this.deps.persistMessage(
        sessionId,
        this.deps.messageService.createAssistantMessage(text, {
          sessionId,
          metadata: { taskId, isTaskMessage: true, taskType: 'research' },
        })
      );
    };
    try {
      report(
        '🔬 研究模式已启动：生成多视角候选方案并逐一对抗评审，被驳路线 objection 会保留。完成后结论将呈现于此。'
      );
      const taorContext = this.deps.buildTAORContext(sessionId, [], undefined);
      const taorDeps = createChatManagerTAORDeps(taorContext);
      // 研究编排的轻量 callModel：剥掉 TAOR deps 的 type 字段，只透传 content
      const callModel: ResearchCallModel = async function* (messages, signal) {
        for await (const chunk of taorDeps.callModel(
          messages as ChatMessage[],
          signal
        )) {
          if (chunk.content) yield { content: chunk.content };
        }
      };

      // A7（2026-10-01）：装配点收敛 —— 构造/默认值（perspectiveCount=2 成本护栏）
      // 归 `runResearchOrchestration`，本处只供上下文相关件（callModel + pitfall 落点）
      const result = await runResearchOrchestration(
        userMessage || description,
        new AbortController().signal,
        {
          callModel,
          // Teamwork P2b：REJECT 批评 → pitfall 注册表（P1-2 写点）
          recordPitfall: (rec) =>
            pitfallRegistry.record({
              description: rec.description,
              error: rec.error,
              source: 'verifier',
              contextSig: rec.contextSig ?? taskId,
            }),
        }
      );

      const objectionBlock = (label: string) =>
        result.rejected
          .map(
            (r) => `- 【${r.perspective}】${label}：${r.objections.join('；')}`
          )
          .join('\n');

      if (result.success && result.content.trim()) {
        report(result.content);
        if (result.rejected.length > 0) {
          report(
            `（对抗评审备注：${result.approved.length} 份候选通过，${result.rejected.length} 份被驳）\n被驳路线 objection 保留：\n${objectionBlock('被驳原因')}`
          );
        }
      } else if (result.rejected.length > 0) {
        report(
          `候选方案均未通过对抗评审。被驳路线 objection：\n${objectionBlock('被驳原因')}\n\n可调整任务表述后重试，或改用普通提问模式。`
        );
      } else {
        report(
          '候选生成失败（模型未返回有效候选），未进入对抗评审。可重试或改用普通提问模式。'
        );
      }
      logger.info('研究模式完成', {
        taskId,
        sessionId,
        candidateCount: result.stats.candidateCount,
        approvedCount: result.stats.approvedCount,
        rejectedCount: result.stats.rejectedCount,
      });
    } catch (err) {
      await handleError(err, {
        module: 'chat:pdcaLauncher',
        action: 'launchResearch',
        context: { taskId, projectId, sessionId },
      });
      report(
        `研究模式执行失败（${String(err).slice(0, 200)}）。已保留错误上下文，可重试。`
      );
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }
}
