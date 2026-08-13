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

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
} from './PdcaWorkItemBridge.js';
import { taskOrchestrator } from './TaskOrchestrator.js';
import type { LongRunningTaskOrchestrator } from './LongRunningTaskOrchestrator.js';

const logger = getLogger('tasks:stageOrchestrator');

/** 阶段 ID（2 阶段 MVP） */
export type StageId = 'requirement' | 'design';

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

/** 阶段链父级记录（LongTaskRecord 阶段链字段） */
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
  updatedAt: string;
}

/** 阶段定义表（顺序即执行顺序） */
export const STAGE_DEFS: Array<{
  id: StageId;
  name: string;
  approval: 'stage_approval' | 'auto';
}> = [
  { id: 'requirement', name: '需求分析', approval: 'stage_approval' },
  { id: 'design', name: '设计', approval: 'auto' },
];

/** 阶段执行结果（D4 起含 token 用量，供阶段边界成本结算） */
export interface StageRunnerResult {
  /** 阶段产物文本（下阶段基线） */
  artifact: string;
  /** 本阶段 token 消耗（阶段边界累计到父级 totalTokens） */
  tokens: number;
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
    };
  };
}

/** 阶段 prompt（产物基线注入：design 阶段携带 requirement PRD） */
export function buildStagePrompt(
  stage: StageRecord,
  chain: StageChainRecord
): string {
  if (stage.id === 'requirement') {
    return `【需求分析】请产出需求规格说明（PRD）。
任务描述: ${chain.description}`;
  }
  const baseline =
    chain.stages.find((s) => s.id === 'requirement')?.artifact ?? '';
  return `【设计】请基于以下需求规格说明（PRD）进行设计（产物作为实现阶段输入基线）。
需求规格说明（PRD）:
${baseline || chain.description}`;
}

/** 从子编排器收集阶段产物（已完成步骤的结果文本） */
export function collectStageArtifact(
  child: LongRunningTaskOrchestrator
): string {
  const status = child.getStatus() as { planId?: string };
  const plan = status.planId ? taskOrchestrator.getPlan(status.planId) : null;
  const parts = (plan?.steps ?? [])
    .filter((s) => s.status === 'completed' && s.result)
    .map((s) => `[${s.description}] ${s.result}`);
  return parts.length > 0 ? parts.join('\n\n') : '';
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
    budget: StageBudgetOptions = {}
  ): StageOrchestrator {
    const record: StageChainRecord = {
      taskId,
      description,
      sessionId,
      currentStage: STAGE_DEFS[0].id,
      stages: STAGE_DEFS.map((def) => ({
        id: def.id,
        name: def.name,
        approval: def.approval,
        status: 'pending',
        pdcaTaskId: `${taskId}_${def.id}`,
      })),
      phase: 'running',
      totalTokens: 0,
      budgetLimitTokens: budget.budgetLimitTokens ?? 0,
      budgetPolicy: budget.budgetPolicy ?? 'terminate',
      updatedAt: new Date().toISOString(),
    };
    return new StageOrchestrator(record, deps);
  }

  /** 从 checkpoint 恢复（非阶段链 checkpoint 返回 null） */
  static fromCheckpoint(
    taskId: string,
    deps: StageOrchestratorDeps
  ): StageOrchestrator | null {
    const ck = readPdcaCheckpoint(taskId);
    if (!ck || !Array.isArray(ck.stages)) return null;
    return new StageOrchestrator(ck as unknown as StageChainRecord, deps);
  }

  getStatus(): StageChainRecord {
    return this.record;
  }

  private persist(): void {
    this.record.updatedAt = new Date().toISOString();
    writePdcaCheckpoint(this.record.taskId, {
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
        this.persist();
        return this.record;
      }

      // 执行本阶段
      stage.status = 'running';
      this.record.currentStage = stage.id;
      this.record.phase = 'running';
      this.persist();

      try {
        const result = await this.deps.runStage(stage, this.record);
        stage.artifact = result.artifact;
        // D4（M4）：阶段边界显式回写 token → 全局成本护栏（跨阶段累计）
        this.record.totalTokens += result.tokens;
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
            this.persist();
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
        this.persist();
        throw err;
      }

      if (stage.status === 'awaiting_approval') {
        this.record.phase = 'stage_awaiting_approval';
        this.persist();
        return this.record;
      }
      this.persist();
    }

    // 全部阶段完成
    this.record.phase = 'completed';
    this.persist();
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
    this.persist();
    return this.run();
  }
}
