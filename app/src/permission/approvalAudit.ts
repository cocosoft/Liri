/**
 * approvalAudit — 审批四段**事件打点**（P5-1，2026-10-28）
 *
 * 规格：`.trae/specs/p5-runtime-hardening-specs.md` §1（A1/A2/A5）。
 *
 * ## 职责边界
 * 本模块只做三件事：① 决定"要不要落"（配置开关，默认关闭）；② 给事件一个**落盘出口**
 * （由入口 `entrypoints/init.ts` 注入，避免 `permission`(infra) 反向依赖 `runtime`/`chat`）；
 * ③ 提供审批链 id 与回复值→决策的唯一映射（映射本体在 `./approvalStages`）。
 *
 * **顺序判据不在这里** —— 在 `./approvalStages` 的纯状态机。本模块只负责"把某个可观测点
 * 报出去"，不做"能不能推进"的判断；调用点必须已由状态机判定为合法。
 *
 * ## 为什么不直接 appendStreamEvent
 * `permission` 是 infra 层：静态导入 `chat`（service）会构成上行依赖（R00-001）。
 * 故沿用本模块既有先例 `PermissionRuntimeDeps`（2026-09-30 D-126）的**注入**手法。
 *
 * ## 事件量
 * 每条真实走 Inbox 的审批链 = 4 条 log-only 事件；开关关闭时 = 0。
 *
 * ## 开关为什么落在这里（而不是 `config/settings/*`）
 * `permission` 是 infra 层，深路径导入 `@modules/config/settings/*` 会触发
 * `lint:arch`（子模块深路径禁令）。故本模块只经 `@modules/config` 的公开出口
 * `configManager.getConfigValue('approvalFourStage')` 读值 —— 与
 * `PermissionChecker` 读 `permission` 配置的既有手法一致。
 */

import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import type { ApprovalDecisionValue } from './approvalStages';

const logger = getLogger('permission:approvalAudit');

/** 开关配置（`config.json → approvalFourStage`；**默认关闭**） */
export interface ApprovalFourStageConfig {
  enabled: boolean;
}

/** 默认值（关闭 ⇒ 零事件、行为零变更） */
export const DEFAULT_APPROVAL_FOUR_STAGE_CONFIG: ApprovalFourStageConfig = {
  enabled: false,
};

/** 纯函数：只有 `enabled === true`（严格布尔）才开启；其余 fail-closed 到关闭 */
export function parseApprovalFourStageConfig(
  raw: unknown
): ApprovalFourStageConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APPROVAL_FOUR_STAGE_CONFIG };
  }
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

/** 读取当前配置（配置管理器自身缓存；读失败 ⇒ 关闭） */
export function readApprovalFourStageConfig(): ApprovalFourStageConfig {
  try {
    return parseApprovalFourStageConfig(
      configManager.getConfigValue<unknown>('approvalFourStage')
    );
  } catch {
    // @ignore-catch — 读配置失败不得改变审批行为 ⇒ 回落默认关闭
    return { ...DEFAULT_APPROVAL_FOUR_STAGE_CONFIG };
  }
}

/** ① 申请 */
export interface ApprovalRequestedAudit {
  stage: 'requested';
  approvalId: string;
  toolName: string;
  risk: string;
  /** 参数摘要（脱敏 + 截断） */
  inputPreview?: string;
  /** 关联执行身份（有则记） */
  executionId?: string;
}

/** ② 呈现 */
export interface ApprovalPresentedAudit {
  stage: 'presented';
  approvalId: string;
  toolName: string;
  risk: string;
  /** 可选项（Inbox 卡原文词表） */
  options: string[];
  /** 授权维度摘要（只落 hash） */
  fingerprintHash?: string;
  /** 承载呈现的 Inbox 项 id */
  inboxItemId?: string;
}

/** ③ 决定 */
export interface ApprovalDecidedAudit {
  stage: 'decided';
  approvalId: string;
  decision: ApprovalDecisionValue;
  /** `timeout` = fail-closed 自动拒绝（当前真实链路尚未接线，见规格附录） */
  by: 'user' | 'timeout';
  reply?: string;
}

/** ④ 留痕 */
export interface ApprovalRecordedAudit {
  stage: 'recorded';
  approvalId: string;
  decision: ApprovalDecisionValue;
  commandHash?: string;
  scopeKind: 'once' | 'session' | 'always';
}

export type ApprovalAuditEvent =
  | ApprovalRequestedAudit
  | ApprovalPresentedAudit
  | ApprovalDecidedAudit
  | ApprovalRecordedAudit;

/**
 * 事件落盘出口（由入口注入）。
 *
 * 约定：**不得抛错**（sink 内部自行降级）；本模块仍会兜一层 try/catch（CS03：
 * 审计失败不阻断审批主流程）。
 */
export type ApprovalAuditSink = (
  sessionId: string,
  event: ApprovalAuditEvent
) => void;

let _sink: ApprovalAuditSink | null = null;

/** 注入事件出口（幂等；传 `null` 卸载） */
export function setApprovalAuditSink(sink: ApprovalAuditSink | null): void {
  _sink = sink;
}

let approvalSeq = 0;

/**
 * 生成审批链 id。
 *
 * **不复用 Inbox 项 id**：同指纹复用既有卡时（`findPendingApprovalId`）卡 id 会重复，
 * 用它当链 id 会让两条不同的"申请"看起来是同一条链。
 */
export function newApprovalId(now: number = Date.now()): string {
  approvalSeq = (approvalSeq + 1) % 1_000_000;
  return `ap_${now.toString(36)}_${approvalSeq.toString(36)}`;
}

/**
 * 落一条审批段事件。
 *
 * 开关关闭 / 无出口 ⇒ 直接返回（**不伪造**、不影响调用方）。
 *
 * **同步判定 + 同步交付**：四段是**有序**的观测点，若这里再开一个 Promise 分支，
 * ①②的相对顺序就取决于微任务调度（曾踩过同类乱序）。落盘的串行化由 sink 侧保证
 * （入口注入的 sink 内部按会话串行 append）。
 */
export function emitApprovalAudit(
  sessionId: string,
  event: ApprovalAuditEvent
): void {
  const sink = _sink;
  if (!sink) return;
  try {
    if (!readApprovalFourStageConfig().enabled) return;
    sink(sessionId, event);
  } catch (e) {
    logger.warn('审批四段事件写入失败（不影响审批主流程）', {
      sessionId,
      stage: event.stage,
      approvalId: event.approvalId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
