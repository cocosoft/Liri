// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * StageOrchestrator — 阶段链编排器（D1/M7，StageOrchestrator 方案 §4.3）
 *
 * 2 阶段 MVP：requirement（需求分析，产出 PRD 后 stage_approval 审批）→ design（设计）。
 * 每阶段委托子 LongRunningTaskOrchestrator（runFullPdca）执行，阶段产物落父级 checkpoint，
 * 作为下一阶段输入基线。审批门：需求阶段产出 PRD → phase='stage_awaiting_approval'，
 * /goal approve {type:'stage'} → resumeAfterApproval → 进入 design。
 *
 * 父级 checkpoint 复用 PdcaWorkItemBridge（~/.pyapp/data/pdca/<taskId>.json），
 * stages[]/currentStage/phase 字段承载阶段链状态，/goal list 天然可见。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
} from './PdcaWorkItemBridge.js';
import { taskOrchestrator } from './TaskOrchestrator.js';
// 计划级失败状态（状态字面量唯一事实源；lint:state-ratchet）
import { PLAN_STATUS_FAILED } from './TaskOrchestrator.js';
import type { LongRunningTaskOrchestrator } from './LongRunningTaskOrchestrator.js';
// P1（2026-11-10）：阶段交付物的结构化投影（纯函数；不再把步骤描述当产物下传）
import {
  formatStageDeliverable,
  projectStageDeliverable,
} from './stageDeliverable.js';
// P2（2026-11-10）：阶段模板规模复用 PDL 的复杂度判定（同一阈值口径，避免两套判据漂移）
import { classifyTaskComplexity } from './PlanDrivenLoop.js';

const logger = getLogger('tasks:stageOrchestrator');

/**
 * P2（2026-11-10）：阶段模板规模 —— `trivial` 只要精简需求说明，`standard` 才要完整 PRD。
 *
 * 判定复用 `classifyTaskComplexity`（与 PDL 快速路径同一阈值口径，单一真源），
 * 由 `chain.description` 派生 ⇒ **无需落库**（确定性纯函数，恢复时结果一致）。
 */
export type StageScale = 'trivial' | 'standard';

export function resolveStageScale(description: string): StageScale {
  return classifyTaskComplexity(description) === 'simple'
    ? 'trivial'
    : 'standard';
}

/** 阶段 ID（MVP：requirement→design→delivery） */
export type StageId = 'requirement' | 'design' | 'delivery';

/** 阶段状态 */
export type StageStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

/** 单阶段记录 */
export interface StageRecord {
  id: StageId;
  name: string;
  /** 审批策略：requirement → stage_approval（产物待审批）；design → auto */
  approval: 'stage_approval' | 'auto';
  status: StageStatus;
  /** 本阶段子 PDCA 任务 ID（taskId_<stageId>） */
  pdcaTaskId: string;
  /** 本阶段产物（下一阶段输入基线） */
  artifact?: string;
}

/** 阶段链父级记录（StageChainRecord：LongTaskRecord 实际承载类型） */
export interface StageChainRecord {
  taskId: string;
  description: string;
  sessionId: string;
  currentStage: StageId;
  stages: StageRecord[];
  phase: 'running' | 'stage_awaiting_approval' | 'completed' | 'failed';
  /** D4（M4）：跨阶段 token 累计（阶段边界显式回写） */
  totalTokens: number;
  /** D4：成本护栏上限（0 = 不限制） */
  budgetLimitTokens: number;
  /** D4：超限策略——terminate 终止 / warn 警告继续 */
  budgetPolicy: 'terminate' | 'warn';
  /** D4：是否已触发超限 */
  budgetExhausted?: boolean;
  /** D6（M8）：用户验收标记（交付清单生成后置 true） */
  deliveryAccepted?: boolean;
  /** D6：交付清单（delivery 阶段产物） */
  deliveryManifest?: DeliveryManifest;
  /** D3/M8 消费（偏差 2 闭环）：需求追踪 ID（requirementTracker 注册的 req_<sha1>） */
  requirementId?: string;
  /**
   * B13（2026-11-09，真机实测）：父级记录自带 demand 身份。
   *
   * 此前只有子阶段 PDCA 检查点带 `demand`，顶层这条没有 ⇒
   * `stats:demand`（指标 4）按顶层读取时把 demand 任务算成 interactive。
   * 每份快照**自描述**，不依赖别的行推断。
   */
  demand?: boolean;
  updatedAt: string;
}

/** D6（M8）：交付清单（打包产物 + 部署说明 + 交付物 + 验收标记） */
export interface DeliveryManifest {
  taskId: string;
  description: string;
  sessionId: string;
  totalTokens: number;
  budgetLimitTokens: number;
  stages: Array<{
    id: StageId;
    name: string;
    status: StageStatus;
    artifactPreview: string;
  }>;
  /** 各阶段完整产物（交付物） */
  artifacts: Record<string, string>;
  /** 部署说明（MVP：阶段产物即交付物，部署说明为后续扩展） */
  deployNote: string;
  /** 用户验收标记（默认 pending，markDeliveryAccepted 置 accepted） */
  acceptance: 'pending' | 'accepted';
  /** D3 消费（偏差 2）：关联的需求追踪 ID（与 StageChainRecord.requirementId 一致） */
  requirementId?: string;
  deliveredAt: string;
}

/** 阶段定义表（顺序即执行顺序） */
export const STAGE_DEFS: Array<{
  id: StageId;
  name: string;
  approval: 'stage_approval' | 'auto';
}> = [
  { id: 'requirement', name: '需求分析', approval: 'stage_approval' },
  { id: 'design', name: '设计', approval: 'auto' },
  { id: 'delivery', name: '交付', approval: 'auto' },
];

/** 阶段执行结果（D4（M4）起含 token 用量，供阶段边界成本结算） */
export interface StageRunnerResult {
  /** 阶段产物文本（下阶段基线） */
  artifact: string;
  /** 本阶段 token 消耗（阶段边界累计到父级 totalTokens） */
  tokens: number;
  /**
   * B13（2026-11-09，真机 `pdca_mw9gube7_design`）：子 PDCA 因**工具审批**挂起
   * （`phase='stage_awaiting_approval'`，如 powershell 命令待人工确认）。
   *
   * 阶段链必须**同样停下**；此前把挂起当阶段成功 ⇒ 父级链一路 `completed`，
   * 实际交付并未完成（"假完成"，同时虚高 demand 收敛率）。
   */
  paused?: boolean;
  /**
   * B13（2026-11-09，真机 `pdca_mw9hbaiy_requirement`）：子 PDCA 终态为 **failed / abort**。
   *
   * `runFullPdca` 失败时**正常返回**（不抛错）⇒ 阶段链此前把失败阶段当成功继续，
   * 父级 `completed`（需求阶段已失败却报"任务完成"）。
   */
  failed?: boolean;
}

/** StageOrchestrator 外部依赖（子 PDCA 执行由调用方注入，保持编排器与执行解耦） */
export interface StageOrchestratorDeps {
  /** 执行单个阶段（运行子 PDCA），返回产物 + token 用量 */
  runStage: (
    stage: StageRecord,
    chain: StageChainRecord
  ) => Promise<StageRunnerResult>;
}

/** 成本护栏配置（D4） */
export interface StageBudgetOptions {
  /** token 上限（0 = 不限制） */
  budgetLimitTokens?: number;
  /** 超限策略：terminate 终止阶段链 / warn 警告继续 */
  budgetPolicy?: 'terminate' | 'warn';
}

/**
 * 默认阶段执行器：子 LongRunningTaskOrchestrator 独立运行阶段 PDCA
 * （child 用默认 executor 纯 LLM 执行；PdcaLauncher 可在其上叠加 TAORLoop 注入）。
 * 供 /goal resume/approve 等脱离 ChatManager 的恢复场景复用。
 */
export function createDefaultStageRunner(
  onTaskMessage?: (
    sessionId: string,
    msgs: Array<{ role: string; content: string }>
  ) => void
): StageOrchestratorDeps['runStage'] {
  return async (stage, chain) => {
    const { getOrCreateOrchestrator } =
      await import('./LongRunningTaskOrchestrator.js');
    const child = getOrCreateOrchestrator(stage.pdcaTaskId);
    await child.runFullPdca(buildStagePrompt(stage, chain), chain.sessionId, {
      requirePlanApproval: false,
      onTaskMessage,
    });
    return {
      artifact: collectStageArtifact(child),
      // D4（M4）：阶段边界显式回写 token（TAORLoopResult.totalTokens 累计）
      tokens: child.getTokenUsage(),
      ...readStageChildOutcome(child),
    };
  };
}

/**
 * B13（2026-11-09）：子 PDCA 的**非成功**结局（挂起 / 失败）⇒ 阶段链须同样停下。
 *
 * 两个阶段执行器（ChatManager 注入版 / 默认版）共用同一判据，避免各写一份而漂移。
 *
 * 2026-11-10 修复（真机 `pdca_mw9uuur1`）：失败可能**只体现在计划上** —— 子任务
 * `phase` 仍停在 `execute`，但计划里已有 failed 步 / `plan.status=failed`。此前只判
 * `phase` ⇒ 漏判 ⇒ 阶段链带着失败的需求阶段继续跑 design（父级一直 running）。
 */
export function readStageChildOutcome(child: {
  getStatus: () => {
    phase: string;
    plan?: {
      status?: string;
      steps?: ReadonlyArray<{ status?: string }>;
    };
  };
}): { paused?: true; failed?: true } {
  const status = child.getStatus();
  if (status.phase === 'stage_awaiting_approval') return { paused: true };
  if (status.phase === 'failed' || status.phase === 'abort')
    return { failed: true };
  const plan = status.plan;
  if (plan?.status === PLAN_STATUS_FAILED) return { failed: true };
  if ((plan?.steps ?? []).some((step) => step.status === 'failed')) {
    return { failed: true };
  }
  return {};
}

/** 阶段 prompt（产物基线注入：design 阶段携带 requirement PRD） */
export function buildStagePrompt(
  stage: StageRecord,
  chain: StageChainRecord
): string {
  if (stage.id === 'requirement') {
    // D3 消费（偏差 2）：阶段链关联需求追踪 ID，产物与需求证据可追溯
    const rid = chain.requirementId
      ? `\n需求追踪 ID: ${chain.requirementId}（产物须标注该 ID 作为需求证据）`
      : '';
    // P2（2026-11-10，真机 `pdca_mw9g2qzz`）：**模板按规模分型** —— 短目标却要求七章 PRD，
    // 只会把需求阶段撑成多步长文档（每步都是一整个 TAOR 循环）。阈值复用既有复杂度判定。
    if (resolveStageScale(chain.description) === 'trivial') {
      return `【需求分析】请产出**精简需求说明**（5–10 行，只写：目标 / 验收标准 / 约束），不要扩写成多章 PRD。
任务描述: ${chain.description}${rid}`;
    }
    return `【需求分析】请产出需求规格说明（PRD）。
任务描述: ${chain.description}${rid}`;
  }
  const baseline =
    chain.stages.find((s) => s.id === 'requirement')?.artifact ?? '';
  return `【设计】请基于以下需求规格说明（PRD）进行设计（产物作为实现阶段输入基线）。
需求规格说明（PRD）与已成立事实（禁止重复创建/重新实现）:
${baseline || chain.description}`;
}

/**
 * 从子编排器收集阶段交付物（P1，2026-11-10）。
 *
 * 语义变更：**不再拼步骤描述**。原实现把 `[步骤描述] 结果` 整段下传，下一阶段 planner
 * 会把"上一阶段的指令"读成待办、重复创建同一产物（真机 `pdca_mw9g2qzz`：requirement
 * 写过 `prd.md`，design 又写一遍，并把校验拆成 3 个独立步骤）。
 * 现按 `stageDeliverable` 投影为「目标 / 验收标准 / 产物台账 / 已成立事实」。
 */
export function collectStageArtifact(
  child: LongRunningTaskOrchestrator
): string {
  const status = child.getStatus() as { planId?: string };
  const plan = status.planId ? taskOrchestrator.getPlan(status.planId) : null;
  if (!plan) return '';
  const deliverable = projectStageDeliverable({
    goal: plan.description,
    steps: plan.steps,
  });
  const hasContent =
    deliverable.criteria.length > 0 ||
    deliverable.artifacts.length > 0 ||
    deliverable.facts.length > 0;
  return hasContent ? formatStageDeliverable(deliverable) : '';
}

export class StageOrchestrator {
  constructor(
    private record: StageChainRecord,
    private deps: StageOrchestratorDeps
  ) {}

  /** 创建新阶段链 */
  static create(
    taskId: string,
    description: string,
    sessionId: string,
    deps: StageOrchestratorDeps,
    budget: StageBudgetOptions = {},
    /**
     * D3 消费（偏差 2）：需求追踪 ID（requirementTracker 注册的 req_<sha1>），
     * 贯穿阶段链（prompt 注入 → 产物 → 交付清单），供需求→产物证据追溯。
     */
    requirementId?: string,
    /**
     * B2（2026-11-09）：demand（许愿式）会话 —— 阶段审批**自动放行**（跳过"计划待确认"）。
     * 仅放宽流程暂停点，不放宽任何工具/权限判定（Bash 闸与权限档独立生效）。
     *
     * B13：`demand` 同时作为**持久化身份**写进父级检查点（见 `StageChainRecord.demand`）。
     */
    opts: { autoApproveStages?: boolean; demand?: boolean } = {}
  ): StageOrchestrator {
    const record: StageChainRecord = {
      taskId,
      description,
      sessionId,
      requirementId,
      currentStage: STAGE_DEFS[0].id,
      stages: STAGE_DEFS.map((def) => ({
        id: def.id,
        name: def.name,
        approval: opts.autoApproveStages ? 'auto' : def.approval,
        status: 'pending',
        pdcaTaskId: `${taskId}_${def.id}`,
      })),
      phase: 'running',
      totalTokens: 0,
      budgetLimitTokens: budget.budgetLimitTokens ?? 0,
      budgetPolicy: budget.budgetPolicy ?? 'terminate',
      ...(opts.demand ? { demand: true } : {}),
      updatedAt: new Date().toISOString(),
    };
    return new StageOrchestrator(record, deps);
  }

  /** 从 checkpoint 恢复（非阶段链 checkpoint 返回 null） */
  static async fromCheckpoint(
    taskId: string,
    deps: StageOrchestratorDeps
  ): Promise<StageOrchestrator | null> {
    const ck = await readPdcaCheckpoint(taskId);
    if (!ck || !Array.isArray(ck.stages)) return null;
    return new StageOrchestrator(ck as unknown as StageChainRecord, deps);
  }

  getStatus(): StageChainRecord {
    return this.record;
  }

  private async persist(): Promise<void> {
    this.record.updatedAt = new Date().toISOString();
    await writePdcaCheckpoint(this.record.taskId, {
      ...this.record,
      phase: this.record.phase,
    });
  }

  /** 启动/继续阶段链（遇 awaiting_approval 停在审批门） */
  async run(): Promise<StageChainRecord> {
    for (const stage of this.record.stages) {
      if (stage.status === 'completed') continue;
      if (stage.status === 'awaiting_approval') {
        // 审批门：等用户 approve，停在这里
        this.record.phase = 'stage_awaiting_approval';
        await this.persist();
        return this.record;
      }

      // D6（M8）：交付阶段为合成阶段——不执行子 PDCA，由 run() 完成后统一打包交付清单
      if (stage.id === 'delivery') {
        stage.status = 'completed';
        this.record.currentStage = stage.id;
        await this.persist();
        continue;
      }

      // 执行本阶段
      stage.status = 'running';
      this.record.currentStage = stage.id;
      this.record.phase = 'running';
      await this.persist();

      try {
        const result = await this.deps.runStage(stage, this.record);
        stage.artifact = result.artifact;
        // D4（M4）：阶段边界显式回写 token → 全局成本护栏（跨阶段累计）
        this.record.totalTokens += result.tokens;
        // B13：子 PDCA 失败/中止 ⇒ 阶段链同样失败收尾（不得当作阶段完成）
        if (result.failed) {
          stage.status = 'failed';
          this.record.phase = 'failed';
          await this.persist();
          return this.record;
        }
        // B13：子 PDCA 挂在工具审批 ⇒ 阶段链同样停在审批门（不得当作阶段完成）
        if (result.paused) {
          stage.status = 'awaiting_approval';
          this.record.phase = 'stage_awaiting_approval';
          await this.persist();
          return this.record;
        }
        stage.status =
          stage.approval === 'stage_approval'
            ? 'awaiting_approval'
            : 'completed';

        // D4（M4）：成本护栏——超限降级（terminate 终止 / warn 警告继续）
        const limit = this.record.budgetLimitTokens;
        if (limit > 0 && this.record.totalTokens > limit) {
          this.record.budgetExhausted = true;
          if (this.record.budgetPolicy === 'terminate') {
            logger.warn('StageOrchestrator 成本护栏触发（terminate）', {
              taskId: this.record.taskId,
              stageId: stage.id,
              totalTokens: this.record.totalTokens,
              budgetLimitTokens: limit,
            });
            this.record.phase = 'failed';
            await this.persist();
            return this.record;
          }
          logger.warn('StageOrchestrator 成本护栏触发（warn，继续执行）', {
            taskId: this.record.taskId,
            stageId: stage.id,
            totalTokens: this.record.totalTokens,
            budgetLimitTokens: limit,
          });
        }
      } catch (err) {
        stage.status = 'failed';
        this.record.phase = 'failed';
        await this.persist();
        throw err;
      }

      if (stage.status === 'awaiting_approval') {
        this.record.phase = 'stage_awaiting_approval';
        await this.persist();
        return this.record;
      }
      await this.persist();
    }

    // 全部阶段完成 → D6（M8）：生成交付清单（打包产物 + 部署说明 + 验收标记）
    this.record.phase = 'completed';
    this.record.deliveryManifest = this.buildDeliveryManifest();
    await this.persist();
    return this.record;
  }

  /** D6（M8）：打包交付清单（各阶段产物 + 总 tokens + 验收标记 pending） */
  private buildDeliveryManifest(): DeliveryManifest {
    return {
      taskId: this.record.taskId,
      description: this.record.description,
      sessionId: this.record.sessionId,
      totalTokens: this.record.totalTokens,
      budgetLimitTokens: this.record.budgetLimitTokens,
      stages: this.record.stages.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        artifactPreview: (s.artifact ?? '').slice(0, 200),
      })),
      artifacts: Object.fromEntries(
        this.record.stages
          .filter((s) => s.artifact)
          .map((s) => [s.id, s.artifact as string])
      ),
      // MVP：阶段产物即交付物，部署说明为后续扩展（delivery 合成阶段无独立产物）
      deployNote: '',
      acceptance: this.record.deliveryAccepted ? 'accepted' : 'pending',
      requirementId: this.record.requirementId,
      deliveredAt: new Date().toISOString(),
    };
  }

  /**
   * D6（M8）：用户验收 → 交付清单 acceptance 置 accepted
   * 仅 phase='completed' 且已生成交付清单时可调用。
   */
  async markDeliveryAccepted(): Promise<StageChainRecord> {
    if (this.record.phase !== 'completed' || !this.record.deliveryManifest) {
      throw new AppError(
        'Stage chain not delivered yet',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'STAGE_NOT_DELIVERED'
      );
    }
    this.record.deliveryAccepted = true;
    this.record.deliveryManifest.acceptance = 'accepted';
    await this.persist();
    return this.record;
  }

  /**
   * 阶段审批通过 → 继续阶段链（D1/M7）
   * 仅 phase='stage_awaiting_approval' 时可调用；approve 后进入下一阶段。
   */
  async resumeAfterApproval(): Promise<StageChainRecord> {
    if (this.record.phase !== 'stage_awaiting_approval') {
      throw new AppError(
        'Stage orchestrator is not awaiting approval',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'STAGE_NOT_AWAITING'
      );
    }
    const pending = this.record.stages.find(
      (s) => s.status === 'awaiting_approval'
    );
    if (pending) pending.status = 'completed';
    this.record.phase = 'running';
    await this.persist();
    return this.run();
  }
}
