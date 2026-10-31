// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PdcaLaunchCoordinator —— PDCA 自动启动簇（ChatManager 拆分批 U-22/S1）
 *
 * **来源**：从 `ChatManager.ts` 外移「自动建项目 → PDCA launch → 决策轨迹落盘」整簇
 * （`_escalateToPdcaViaBareSession` / `onLongTaskSignal` / `_maybeLaunchPdca` /
 * `_persistPatternDecision` / `_persistPdcaSnapshot` / `_autoCreateProject` /
 * `_extractKeywords` / `_jaccardSimilarity`）。
 *
 * **职责（单一：把「本轮该不该起 PDCA」落成动作）**：
 *   ① 长任务信号升级（裸会话 ⇒ 建项目 ⇒ launch）
 *   ② 研究 / 验证模式分流（`selectPattern` → `instantiatePattern`）
 *   ③ 决策轨迹（SSE 事件 + `task_audit_log` + `assistant/pdca_workflow` 快照）
 *
 * **行为等价**：日志 module 名保持 `chat:manager`；launch 锁、分流顺序、`.catch` 兜底语义
 * 逐字未变（仅把 `this.` 换成注入的 deps）。
 *
 * **注入依赖**（`PdcaLaunchDeps`，全 getter/闭包 ⇒ 无字段初始化顺序陷阱）。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { getLogger } from '@modules/monitoring';
import { patternFeatureFlag, selectPattern } from '@modules/query/patterns';
import { feature as coreFeature } from '@openliri/kernel';
import { instantiatePattern, verifierConfigForRecipe } from '@modules/query';
import type { ChatSession } from '@modules/session/types/session.js';
import type { LiriEvent, LiriEventData } from '@modules/session/types/events';

import { hasResearchIntent, hasVerifyIntent } from '../taskIntent';
import { shouldEscalateLongTask } from '../longTaskEscalation';
import { createProjectStore } from '../../workspace/ProjectStore.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';
import { resolveDataDir } from '@modules/environment';
import { eventNotificationService } from '../services/EventNotificationService.js';
import type { PdcaLauncher } from '../launchers/PdcaLauncher';

const logger = getLogger('chat:manager');

/**
 * 项目名/描述防护（2026-10-31 P1-4）：系统提示类文本（`你是 …` / `You are …` 模板句）
 * **不得**成为项目名 —— 真机事故里垃圾项目名就是 AlwaysOn 提示词原文。
 */
const SYSTEM_PROMPT_LIKE_RE = /^\s*(你是|You are)/i;

/** 项目名最大字符数（超出截断，避免把整段提示词落库） */
const MAX_PROJECT_NAME_CHARS = 60;

function looksLikeSystemPrompt(text: string | undefined): boolean {
  return Boolean(text && SYSTEM_PROMPT_LIKE_RE.test(text));
}

/** 归一化项目名：空/系统提示类 ⇒ 回退；超长 ⇒ 截断 */
function sanitizeProjectName(
  raw: string | undefined,
  fallback: string
): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text || looksLikeSystemPrompt(text)) return fallback;
  return text.length > MAX_PROJECT_NAME_CHARS
    ? `${text.slice(0, MAX_PROJECT_NAME_CHARS)}…`
    : text;
}

/** TAORLoop 上本簇唯一使用的接缝（self_verify 配方落点） */
export interface VerifierConfigSink {
  applyVerifierConfig(config: ReturnType<typeof verifierConfigForRecipe>): void;
}

export interface PdcaLaunchDeps {
  /** 会话级 launch 锁（宿主持有；防同会话重复卡片） */
  launchingSessions: Set<string>;
  /** PDCA launcher（惰性装配，可能为 null） */
  getPdcaLauncher: () => PdcaLauncher | null;
  /** 分流判定：PDL 快速路径门 */
  shouldUsePlanDrivenLoop: (message: string) => boolean;
  /** Code Mode 判定（长任务信号闸门） */
  shouldUseCodeMode: (message: string) => boolean;
  /** 取/建该会话的 TAORLoop（self_verify 配方落点） */
  getOrCreateTAORLoop: (sessionId: string) => VerifierConfigSink;
  /** 事件 seq 分配（宿主唯一入口） */
  getStreamTailSeq: (sessionId: string) => Promise<number>;
  /** 事件写入（宿主唯一入口） */
  appendStreamEvent: (sessionId: string, event: LiriEvent) => Promise<unknown>;
  /** 持久化会话 metadata（projectId 落盘） */
  persistSessionMetadata: (session: ChatSession) => Promise<void>;
  /** 最近 N 条用户文本 */
  recentUserText: (session: ChatSession, n?: number) => string;
  /** 最后一条 assistant 文本 */
  lastAssistantText: (session: ChatSession) => string;
  /**
   * BUG-A（2026-10-27）：最近一条 assistant 消息是否为「空输出兜底」投影。
   * 未注入 ⇒ 视为 false（测试替身/无 UI 场景保持旧行为）。
   */
  isLastAssistantOutputFallback?: (session: ChatSession) => boolean;
  /**
   * LRO-11（2026-10-26）：给用户一条**可见**消息（"仍在普通对话循环"等执行模式告知）。
   * 未注入 ⇒ 只记日志（测试替身/无 UI 场景保持旧行为）。
   */
  notifyUser?: (
    sessionId: string,
    text: string,
    metadata?: Record<string, unknown>
  ) => void;
}

export class PdcaLaunchCoordinator {
  /** LRO-11：已提示过"仍在普通对话循环"的会话（每会话一次，防刷屏） */
  private readonly _longTaskHinted = new Set<string>();

  constructor(private readonly deps: PdcaLaunchDeps) {}

  /**
   * D3（2026-09-25，`.trae/specs/long-task-routing.md` §3.6）：**运行中长任务信号**触发的升级入口
   * （由 `streamMessageFlow` 在回合收尾时经 `host.onLongTaskSignal` 调用）。
   *
   * 闸门（纯判定 `shouldEscalateLongTask`，与既有裸会话分支同口径）：长任务信号 + 裸会话
   * （无 projectId/workspaceId）+ **轮次闸 ≥2 轮** + 非 Code Mode（互斥，CM-6）。
   */
  async onLongTaskSignal(
    session: ChatSession,
    fact: { pendingTodoCount: number; consumedTurns: number }
  ): Promise<void> {
    const lastUserContent = this.deps.recentUserText(session, 3);
    const userMessageCount = (
      session.messages?.filter((m) => m.role === 'user') ?? []
    ).length;
    const shouldEscalate = shouldEscalateLongTask({
      longTask: true,
      hasProjectContext: Boolean(
        session.metadata?.projectId ?? session.metadata?.workspaceId
      ),
      codeMode: this.deps.shouldUseCodeMode(lastUserContent),
      userMessageCount,
    });
    if (!shouldEscalate) {
      logger.debug('pdca:long_task_signal_skipped', {
        sessionId: session.id,
        pendingTodoCount: fact.pendingTodoCount,
        consumedTurns: fact.consumedTurns,
        userMessageCount,
      });
      // LRO-11（2026-10-26）：**用户可见**告知"仍在普通对话循环"——此前只在日志里，
      // 用户会以为长任务已被编排接管。仅对"项目会话"提示（裸会话会走升级分支），
      // 且每会话只提示一次（防每回合刷屏）。
      if (
        (session.metadata?.projectId ?? session.metadata?.workspaceId) &&
        !this._longTaskHinted.has(session.id)
      ) {
        this._longTaskHinted.add(session.id);
        this.deps.notifyUser?.(
          session.id,
          `🧭 检测到长任务信号（未完成待办 ${fact.pendingTodoCount} 个 / 已耗 ${fact.consumedTurns} 轮），` +
            '但本次仍将在**普通对话循环**中继续（项目会话不自动升级）。' +
            '若需要分步执行与逐步验收，请用 `/goal start <描述>`。',
          { taskType: 'pdca-mode' }
        );
      }
      return;
    }
    logger.info('pdca:long_task_signal_escalation', {
      sessionId: session.id,
      pendingTodoCount: fact.pendingTodoCount,
      consumedTurns: fact.consumedTurns,
      userMessageCount,
    });
    await this.escalateViaBareSession({
      session,
      // BUG-A（2026-10-27）：兜底文案是**系统文案**而非模型产出 ⇒ 用用户任务原句作描述
      //（判定走结构化标记，禁止文案匹配 —— CS02）。
      assistantContent:
        (this.deps.isLastAssistantOutputFallback?.(session) ?? false)
          ? lastUserContent
          : this.deps.lastAssistantText(session),
      lastUserContent,
      // LRO-11：信号已证明是长任务 ⇒ 不允许被"消息长度 ≤60"判成单步直执行
      forceDecompose: true,
    });
  }

  /**
   * 裸会话 ⇒ PDCA 编排升级（**单一动作入口**）：建项目 → `maybeLaunch`。
   */
  async escalateViaBareSession(params: {
    session: ChatSession;
    assistantContent: string;
    lastUserContent: string;
    /** LRO-11：长任务信号升级 ⇒ 强制分解 */
    forceDecompose?: boolean;
  }): Promise<void> {
    const { session, assistantContent, lastUserContent } = params;
    const goalSummary = lastUserContent
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);
    const projectId = await this.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 1,
      goalSummary,
    });
    if (projectId) {
      this.maybeLaunch(session, assistantContent, projectId, lastUserContent, {
        forceDecompose: params.forceDecompose,
      });
    }
  }

  /**
   * P0-1（2026-09-06，A1）：PDCA launch 统一出口（同轮串联）。
   *
   * 含：会话级 launch 锁（防重复卡片）、分流决策 trace（SSE + task_audit_log）、
   * `_pdcaLauncher.launch` 双路径（PDL 快速 / 阶段链）调用。
   */
  maybeLaunch(
    session: ChatSession,
    assistantContent: string,
    projectId: string,
    lastUserContent: string | undefined,
    /** LRO-11：长任务信号升级 ⇒ 强制分解 */
    opts?: { forceDecompose?: boolean }
  ): void {
    const launcher = this.deps.getPdcaLauncher();
    if (this.deps.launchingSessions.has(session.id)) {
      logger.warn('pdca:launch_skip_duplicate', {
        sessionId: session.id,
        projectId,
      });
      return;
    }
    this.deps.launchingSessions.add(session.id);
    // P0-3（2026-09-06，Teamwork）：研究模式分流——研究型意图 && COMPETITIVE_STRATEGY
    // feature 开启时优先走候选生成 + 对抗评审编排（launchResearch），不占用 PDCA 阶段链；
    // 与 Code Mode 互斥（研究任务由编排直接回复，不进 code_run 沙箱）。成本门控：feature 默认关。
    //
    // A1（2026-10-01，`.trae/specs/pattern-executable-assembly.md` §3.3）：模式规则收敛到
    // `selectPattern`（单一事实源）——本层不再重述「研究 → competitive_strategy」，只
    // ① 用任务特征构造 spec ② 读装配入口标识决定去向。
    const researchIntent = hasResearchIntent(lastUserContent || '');
    const verifyIntent = hasVerifyIntent(lastUserContent || '');
    const researchPattern = selectPattern({
      complexity: 'complex',
      research: researchIntent,
      verify: verifyIntent,
    });
    // A8 最后一公里（2026-10-04，`.trae/specs/pattern-assembly-runtime.md` §4.1）：
    // 装配描述不再由本层**裸读 assembler 字符串比较**，改经装配入口 `instantiatePattern`
    // 解析为可执行路由（未接线者显式 `unavailable`）。行为不变。
    const researchInstantiation = researchPattern
      ? instantiatePattern(researchPattern)
      : null;
    const patternFeature = researchPattern
      ? patternFeatureFlag(researchPattern.name)
      : undefined;
    const patternGateEnabled = patternFeature
      ? coreFeature(patternFeature)
      : true;
    let verifyApplied = false;
    if (
      patternGateEnabled &&
      researchInstantiation?.status === 'ready' &&
      researchInstantiation.route === 'verify'
    ) {
      const recipeVerifierConfig = verifierConfigForRecipe(
        researchInstantiation.recipe
      );
      this.deps
        .getOrCreateTAORLoop(session.id)
        .applyVerifierConfig(recipeVerifierConfig);
      verifyApplied = true;
      logger.info('pattern 配方应用（self_verify ⇒ 验证器配置）', {
        sessionId: session.id,
        verifyPolicy: researchInstantiation.recipe.verifyPolicy,
        budgetPolicy: researchInstantiation.recipe.budgetPolicy,
        verifier: recipeVerifierConfig,
      });
    }
    const researchMode =
      patternGateEnabled &&
      researchInstantiation?.status === 'ready' &&
      researchInstantiation.route === 'research';
    if (researchIntent || verifyIntent) {
      this.persistPatternDecision(session.id, {
        site: 'research_dispatch',
        selected: researchPattern?.name ?? null,
        ...(researchInstantiation
          ? researchInstantiation.status === 'ready'
            ? { status: 'ready' as const, route: researchInstantiation.route }
            : { status: 'unavailable' as const }
          : {}),
        ...(patternFeature
          ? {
              featureGate: {
                flag: patternFeature,
                enabled: patternGateEnabled,
              },
            }
          : {}),
        applied: researchMode || verifyApplied,
      }).catch((e: unknown) => {
        // @ignore-catch — 轨迹落盘失败不影响编排分流（CS03）
        logger.debug('pattern:decision_persist_failed', { error: String(e) });
      });
    }
    if (researchMode) {
      logger.info('研究模式分流（P0-3）', {
        sessionId: session.id,
        projectId,
        messagePreview: (lastUserContent || '').slice(0, 50),
      });
      import('../../tasks/PdcaLiveEvents')
        .then((m) => {
          void m.emitPdcaLiveEvent(
            'pdca:auto_launched',
            { sessionId: session.id, projectId },
            { decision: 'research', message: '研究模式：候选生成 + 对抗评审' }
          );
          return m.emitPdcaLiveEvent(
            'pdca:decision',
            { sessionId: session.id, projectId },
            {
              decision: 'research',
              reasons: ['research-intent', 'competitive-feature'],
              message: '研究型任务命中研究模式（候选生成 + 对抗评审）',
            }
          );
        })
        .then(() =>
          this.persistPdcaSnapshot(
            session,
            projectId,
            'research',
            '研究模式：候选生成 + 对抗评审',
            ['research-intent', 'competitive-feature']
          )
        )
        .catch(() => {
          // @ignore-catch — 研究分流 trace 失败不影响编排（CS03）
        });
      launcher!
        .launchResearch(
          projectId,
          assistantContent,
          session.id,
          lastUserContent
        )
        .catch(() => {
          /* 研究模式失败不阻塞消息流 */
        })
        .finally(() => {
          this.deps.launchingSessions.delete(session.id);
        });
      return;
    }
    // OBS（M3a）：分流决策 trace——记录走 PDL 快速路径还是经典阶段链
    const usePlanDriven = this.deps.shouldUsePlanDrivenLoop(
      lastUserContent || ''
    );
    const decisionReasons = usePlanDriven
      ? ['simple', 'no-dangerous-tool']
      : ['complex-or-dangerous'];
    const decisionMsg = usePlanDriven
      ? '简单任务走 PlanDrivenLoop 快速路径'
      : '复杂/危险任务走经典 PDCA 阶段链';
    import('../../tasks/PdcaLiveEvents')
      .then((m) => {
        // B1（2026-09-06，P0-2）：自动启动信号——供前端 banner/执行模式徽标消费
        void m.emitPdcaLiveEvent(
          'pdca:auto_launched',
          { sessionId: session.id, projectId },
          {
            decision: usePlanDriven ? 'pdl' : 'stage-chain',
            message: decisionMsg,
          }
        );
        return m.emitPdcaLiveEvent(
          'pdca:decision',
          { sessionId: session.id, projectId },
          {
            decision: usePlanDriven ? 'pdl' : 'stage-chain',
            reasons: decisionReasons,
            message: decisionMsg,
          }
        );
      })
      // D-100（2026-10-31 修复）：原为 `new SqliteTaskStore()` 且**从未 `init()`**
      // ⇒ `writeAuditLogWithDetail` 走 `withDb` 抛 "SqliteTaskStore not initialized"（审计从未落库）。
      .then(() =>
        import('../../tasks/db/SqliteTaskStore').then(async (mod) =>
          (await mod.getSharedSqliteTaskStore()).writeAuditLogWithDetail({
            taskId: `session:${session.id}`,
            eventType: 'pdca_decision',
            oldStatus: null,
            newStatus: usePlanDriven ? 'pdl' : 'stage-chain',
            detail: JSON.stringify({
              reasons: decisionReasons,
              message: decisionMsg,
              projectId: projectId ?? null,
            }),
            timestamp: Date.now(),
          })
        )
      )
      .then(() =>
        this.persistPdcaSnapshot(
          session,
          projectId,
          usePlanDriven ? 'pdl' : 'stage-chain',
          decisionMsg,
          decisionReasons
        )
      )
      .catch(() => {
        // @ignore-catch — 决策 trace 失败不影响分流（CS03）
      });
    launcher!
      .launch(
        projectId,
        assistantContent,
        session.id,
        lastUserContent || undefined,
        // S3（P1-5 §5 S3）：两层分流决策（复杂度门 + 危险工具 + message 粒度 hash 10%）
        usePlanDriven,
        // LRO-11：长任务信号升级 ⇒ 强制分解（压过消息长度门）
        opts
      )
      .catch(() => {
        /* 隐性引擎失败不阻塞消息流 */
      })
      .finally(() => {
        this.deps.launchingSessions.delete(session.id);
      });
  }

  /**
   * 编排模式**决策轨迹**落 session 事件（log-only，**不入消息 surface**）。
   *
   * 与 `persistPdcaSnapshot` 同法：seq 由 `tailSeq` 分配、写入走**唯一入口** `appendStreamEvent`。
   */
  private async persistPatternDecision(
    sessionId: string,
    data: LiriEventData<'pattern/decision'>
  ): Promise<void> {
    const ts = await this.deps.getStreamTailSeq(sessionId);
    await this.deps.appendStreamEvent(sessionId, {
      type: 'pattern/decision',
      seq: ts + 1,
      time: Date.now(),
      sessionId,
      data,
    } as LiriEvent);
  }

  /**
   * P2-A（2026-09-17）：PDCA 自动启动 → 聊天正文内嵌卡片（只存启动快照）。
   */
  private async persistPdcaSnapshot(
    session: ChatSession,
    projectId: string | undefined,
    decision: 'pdl' | 'stage-chain' | 'research',
    message: string,
    reasons?: string[]
  ): Promise<void> {
    const ts = await this.deps.getStreamTailSeq(session.id);
    await this.deps.appendStreamEvent(session.id, {
      type: 'assistant/pdca_workflow',
      seq: ts + 1,
      time: Date.now(),
      sessionId: session.id,
      data: {
        decision,
        stage: 'plan',
        status: 'started',
        message,
        ...(projectId ? { projectId } : {}),
        ...(reasons ? { reasons } : {}),
      },
    } as LiriEvent);
  }

  /**
   * P0: 自动建项目 — 检测到 goal + deliverables 时静默创建项目。
   * 返回值 = projectId（成功新建/关联）或 null（失败）；失败仅告警，不阻塞消息流（CS03）。
   *
   * 2026-10-31 P1（会话/项目隔离缺陷 R1）：归属写入**一律带守卫**，禁止无守卫覆写。
   * 真机事故：`proj_1793402819293_54c217`（项目名 = 系统提示词原文）把 3 个不同目录的会话
   * 全部改写成同一个 projectId。守卫见下 ①-⑤。
   */
  async autoCreateProject(
    session: ChatSession,
    workspaceId: string | undefined,
    result: { hasGoal: boolean; deliverables: number; goalSummary?: string }
  ): Promise<string | null> {
    try {
      // 守卫 ①（P1-5）：无产出物 ⇒ 不建项目（避免把"只有目标"的一轮当成项目）
      if (!(result.deliverables > 0)) {
        logger.warn('P0 自动建项目跳过：本轮无产出物', {
          sessionId: session.id,
          deliverables: result.deliverables,
        });
        return null;
      }

      const dataDir = resolveDataDir();
      const workItemStore = new WorkItemStore(dataDir);
      const projectStore = createProjectStore(dataDir, workItemStore);

      // 已有归属与会话工作区（守卫用）：metadata 优先，其次调用方传入
      const existingProjectId =
        typeof session.metadata?.projectId === 'string' &&
        session.metadata.projectId.trim()
          ? session.metadata.projectId
          : undefined;
      const metadataWorkspaceId =
        typeof session.metadata?.workspaceId === 'string' &&
        session.metadata.workspaceId.trim()
          ? session.metadata.workspaceId
          : undefined;
      const bindingWorkspaceId = workspaceId ?? metadataWorkspaceId;

      // 项目名：优先使用引擎提取的 goal 摘要，否则用产出物数生成默认名
      // 守卫 ②（P1-4）：系统提示类文本（「你是 …」模板句）不得成为项目名；超长截断
      const fallbackName = `项目 ${result.deliverables} 个产出`;
      const projectName = sanitizeProjectName(result.goalSummary, fallbackName);
      const descriptionText =
        result.goalSummary && !looksLikeSystemPrompt(result.goalSummary)
          ? result.goalSummary
          : `自动创建：${result.deliverables} 个产出物`;
      const newKeywords = this.extractKeywords(projectName);
      if (newKeywords.size > 0) {
        const existingProjects = projectStore.list(
          bindingWorkspaceId ?? 'default'
        );
        const matched = existingProjects.find((p) => {
          // 2026-10-31：**名称也参与匹配** —— 原实现读 `p.description ?? p.name`，而
          // `ProjectStore.create` 的 `description` 默认是**空串**（不是 `undefined`）⇒
          // 只填了 name 的项目永远按空描述匹配（相似度恒 0），跨会话去重形同失效。
          const pKeywords = this.extractKeywords(
            `${p.name} ${p.description ?? ''}`
          );
          return this.jaccardSimilarity(newKeywords, pKeywords) >= 0.6;
        });
        if (matched) {
          // 守卫 ③（P1-2）：已有归属且与命中项不一致 ⇒ **不覆盖**，保留原归属
          if (existingProjectId && existingProjectId !== matched.id) {
            logger.warn('项目归属冲突，保留原归属', {
              sessionId: session.id,
              existing: existingProjectId,
              incoming: matched.id,
            });
            return existingProjectId;
          }
          // 守卫 ④（P1-1）：会话工作区与命中项目不一致 ⇒ 不跨工作区关联
          if (
            bindingWorkspaceId &&
            matched.workspaceId !== bindingWorkspaceId
          ) {
            logger.warn('项目归属冲突，保留原归属', {
              sessionId: session.id,
              existing: existingProjectId ?? null,
              incoming: matched.id,
              workspaceId: bindingWorkspaceId,
              projectWorkspaceId: matched.workspaceId,
            });
            return existingProjectId ?? null;
          }
          if (existingProjectId === matched.id) return existingProjectId;
          // 命中已有项目：关联 session，不新建
          if (!session.metadata) {
            (session as unknown as Record<string, unknown>).metadata = {};
          }
          session.metadata.projectId = matched.id;
          logger.info('P0 跨会话去重 — 关联到已有项目', {
            existingProjectId: matched.id,
            sessionId: session.id,
          });
          // P0-D: 持久化 projectId 到 gateway 存储，防止重启后丢失
          await this.deps.persistSessionMetadata(session);
          return matched.id;
        }
      }

      // 守卫 ⑤（P1-3）：未命中任何项目但会话已有归属 ⇒ 不新建（避免"每轮多一个项目"）
      if (existingProjectId) {
        logger.warn('已有项目归属，跳过自动新建', {
          sessionId: session.id,
          existing: existingProjectId,
        });
        return existingProjectId;
      }

      const project = projectStore.create({
        workspaceId: bindingWorkspaceId ?? 'default',
        name: projectName,
        description: descriptionText,
        delaySandbox: true,
      });

      // 关联 session 到新项目
      if (!session.metadata) {
        (session as unknown as Record<string, unknown>).metadata = {};
      }
      session.metadata.projectId = project.id;

      // P0-D: 持久化 projectId 到 gateway 存储，防止重启后丢失
      await this.deps.persistSessionMetadata(session);

      // S5b: 项目上下文文件由 ProjectStore.create() 统一写入
      // P0: 迁移已有 context/artifacts 到新项目目录
      try {
        const {
          mkdirSync,
          copyFileSync,
          existsSync: _exists,
        } = await import('fs');
        const projDir = join(dataDir, 'projects', project.id);
        mkdirSync(projDir, { recursive: true });

        // P0 context 迁移：复制 ImplicitEngineHook 已写入的 rules/artifacts
        // S2 上线前：物理复制（S2 后改为 items.db 引用）
        if (workspaceId) {
          const srcDir = join(homedir(), '.pyapp', 'projects', workspaceId);
          for (const file of ['rules.md', 'artifacts.json']) {
            const srcPath = join(srcDir, file);
            const dstPath = join(projDir, file);
            if (_exists(srcPath) && !_exists(dstPath)) {
              copyFileSync(srcPath, dstPath);
            }
          }
        }
      } catch {
        /* 写上下文文件失败不影响主流程 */
      }

      logger.info('P0 自动建项目', {
        projectId: project.id,
        sessionId: session.id,
        deliverables: result.deliverables,
      });

      // P0 增强：通知前端导航到新项目
      const autoCreatedPayload = {
        projectId: project.id,
        name: project.name,
        sandboxPath: project.sandboxPath,
      };
      logger.info('P0 自动建项目事件：emitCustomEvent 发出', {
        event: 'project:auto_created',
        ...autoCreatedPayload,
      });
      eventNotificationService.emitCustomEvent(
        'project:auto_created',
        autoCreatedPayload
      );
      // P0b-3: 同步广播到全局 SSE 事件总线，前端 worktree 同步创建
      try {
        const { broadcastEvent } = await import('@modules/infrastructure');
        await broadcastEvent('project:auto_created', autoCreatedPayload);
        logger.info('P0 自动建项目事件：SSE 广播完成', autoCreatedPayload);
      } catch (e) {
        logger.warn('P0 自动建项目 SSE 广播失败', {
          error: (e as Error)?.message ?? String(e),
        });
        /* SSE 广播失败不影响主流程 */
      }
      return project.id;
    } catch (e) {
      logger.warn('P0 自动建项目失败', {
        error: (e as Error)?.message ?? String(e),
      });
      return null;
    }
  }

  /** P0 跨会话去重：提取关键词集合（归一化后分词） */
  private extractKeywords(text: string): Set<string> {
    if (!text) return new Set();
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 10);
    return new Set(normalized);
  }

  /** P3-2: Jaccard 相似度 — 替代精确 hash 匹配，语义相近项目可被识别 */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const k of a) {
      if (b.has(k)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
  }
}
