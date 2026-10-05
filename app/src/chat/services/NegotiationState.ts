/**
 * NegotiationState — 协商式执行引擎的状态机 + 持久化（设计方案 §5.2 + §5.7）
 *
 * 状态机：
 *   idle → analyzing → awaiting_confirm → executing → awaiting_review → done
 *
 * 持久化：
 *   序列化到 ~/.pyapp/data/negotiation/<sessionId>.json
 *   **重启恢复（A1 T3 已接线，2026-10-05）**：本文件原声称"启动时检测 awaitingUser=true 则
 *   恢复挂起提问"但未接线（2026-10-05 复核为失实自称，已记台账）。现由 `chat/manager/recovery.ts`
 *   的 `bootstrapPendingRecovery()` 接线：以**事件日志投影**（`chat/services/pendingSuspensions.ts`）
 *   为权威事实源（Q1 裁定①），本 JSON 作**廉价索引 + 状态对齐**（Q2 裁定「接线并对齐」）；
 *   启动期对无恢复通道的挂起项做 **fail-closed 结算**（T4）。
 *
 * 生命周期：创建于首轮分析、随会话销毁清理
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import type { PendingQuestion } from './DecisionGate';

const logger = getLogger('chat:negotiationState');

// ─── 状态机枚举 ──────────────────────────────────────────

export type NegotiationPhase =
  | 'idle'
  | 'analyzing'
  | 'awaiting_confirm'
  | 'executing'
  | 'awaiting_review'
  | 'done';

// ─── 持久化数据结构 ──────────────────────────────────────

/**
 * 协商状态（对齐设计方案 §5.2 NegotiationState）
 * 序列化为 JSON 持久化，跨消息保持
 */
export interface NegotiationState {
  sessionId: string;
  phase: NegotiationPhase;
  pending: PendingQuestion[];
  awaitingUser: boolean;
  answered: Record<string, string | string[]>;
  askedAt?: number;
  /** 超时阈值（ms），默认 5 分钟 */
  timeoutMs: number;
  /** 门控强度 */
  tier: 'strict' | 'moderate' | 'relaxed';
  /** 基准大纲节点数（scope_drift 判定基准） */
  baselineNodeCount?: number;
  updatedAt: number;
}

// ─── 持久化路径 ──────────────────────────────────────────

function resolveNegotiationDir(): string {
  return resolveDataSubDir('negotiation');
}

function resolveNegotiationFilePath(sessionId: string): string {
  return path.join(resolveNegotiationDir(), `${sessionId}.json`);
}

// ─── 持久化函数 ──────────────────────────────────────────

/**
 * 保存协商状态到磁盘
 */
export function saveNegotiationState(state: NegotiationState): void {
  const filePath = resolveNegotiationFilePath(state.sessionId);
  try {
    fs.mkdirSync(resolveNegotiationDir(), { recursive: true });
    state.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    logger.debug('negotiationState:saved', {
      sessionId: state.sessionId,
      phase: state.phase,
      pendingCount: state.pending.length,
      awaitingUser: state.awaitingUser,
    });
  } catch (err) {
    logger.warn('negotiationState:save_failed', {
      sessionId: state.sessionId,
      error: String(err),
    });
  }
}

/**
 * 加载协商状态
 * 返回 null 表示无持久化状态（首次进入或已清理）
 */
export function loadNegotiationState(
  sessionId: string
): NegotiationState | null {
  const filePath = resolveNegotiationFilePath(sessionId);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(raw) as NegotiationState;
    logger.info('negotiationState:loaded', {
      sessionId: state.sessionId,
      phase: state.phase,
      awaitingUser: state.awaitingUser,
      pendingCount: state.pending.length,
    });
    return state;
  } catch (err) {
    logger.warn('negotiationState:load_failed', {
      sessionId,
      error: String(err),
    });
    return null;
  }
}

/**
 * 删除协商状态（会话结束时清理）
 */
export function deleteNegotiationState(sessionId: string): void {
  const filePath = resolveNegotiationFilePath(sessionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('negotiationState:deleted', { sessionId });
    }
  } catch (err) {
    logger.warn('negotiationState:delete_failed', {
      sessionId,
      error: String(err),
    });
  }
}

// ─── 状态机工厂 + 转换 ────────────────────────────────────

/**
 * 创建初始协商状态
 */
export function createNegotiationState(
  sessionId: string,
  opts?: { tier?: NegotiationState['tier']; timeoutMs?: number }
): NegotiationState {
  return {
    sessionId,
    phase: 'idle',
    pending: [],
    awaitingUser: false,
    answered: {},
    timeoutMs: opts?.timeoutMs ?? 5 * 60 * 1000,
    tier: opts?.tier ?? 'moderate',
    updatedAt: Date.now(),
  };
}

/**
 * 状态转换（对齐设计方案 §5.7 状态机）
 *
 * idle → analyzing：收到新任务
 * analyzing → awaiting_confirm：产出待确认清单
 * analyzing → executing：无决策点
 * awaiting_confirm → executing：用户确认
 * executing → awaiting_review：子任务完成
 * awaiting_review → executing：用户确认继续
 * awaiting_review → analyzing：用户要求调整
 * awaiting_review → rollback：用户要求回退（调用方处理）
 * * → idle：会话结束
 * * → done：全部完成
 */
export function transition(
  state: NegotiationState,
  next: NegotiationPhase
): NegotiationState {
  const valid: Record<NegotiationPhase, NegotiationPhase[]> = {
    idle: ['analyzing', 'done'],
    analyzing: ['awaiting_confirm', 'executing', 'idle'],
    awaiting_confirm: ['executing', 'idle'],
    executing: ['awaiting_review', 'done', 'idle'],
    awaiting_review: ['executing', 'analyzing', 'idle'],
    done: ['idle'],
  };

  const allowed = valid[state.phase];
  if (!allowed.includes(next)) {
    logger.warn('negotiationState:invalid_transition', {
      sessionId: state.sessionId,
      from: state.phase,
      to: next,
    });
    return state;
  }

  logger.info('negotiationState:transition', {
    sessionId: state.sessionId,
    from: state.phase,
    to: next,
  });

  state.phase = next;
  state.updatedAt = Date.now();
  return state;
}

/**
 * 添加待确认问题到队列
 */
export function addPendingQuestion(
  state: NegotiationState,
  question: PendingQuestion
): NegotiationState {
  state.pending.push(question);
  state.awaitingUser = true;
  state.askedAt = question.askedAt ?? Date.now();
  saveNegotiationState(state);
  return state;
}

/**
 * 记录用户回答
 */
export function recordAnswer(
  state: NegotiationState,
  questionId: string,
  answer: string | string[]
): NegotiationState {
  state.answered[questionId] = answer;
  state.pending = state.pending.filter((q) => q.id !== questionId);
  if (state.pending.length === 0) {
    state.awaitingUser = false;
    state.askedAt = undefined;
  }
  saveNegotiationState(state);
  return state;
}

/**
 * 检测是否有挂起的提问需要恢复（应用重启后）
 *
 * A1 T3（2026-10-05）：**已接线** —— 启动期由 `chat/manager/recovery.ts` 的
 * `bootstrapPendingRecovery()` 经此判据识别"曾挂起"的会话，再以**事件日志投影**为准
 * （`chat/services/pendingSuspensions.ts`）做对齐与 fail-closed 结算。
 */
export function hasPendingRestoration(
  state: NegotiationState | null
): state is NegotiationState {
  return state !== null && state.awaitingUser && state.pending.length > 0;
}

// ─── A1 T3：启动重建支持 ──────────────────────────────────

/**
 * 列出存在协商状态的会话 id（**廉价索引**：仅 readdir，不解析内容）。
 *
 * 用途：启动期挂起重建的**候选集** —— 只对"曾进入协商"的会话做事件投影，
 * 避免全量扫描所有会话的事件日志。
 *
 * ⚠️ **权威事实源仍是事件日志**（Q1 裁定①）：本索引仅用于**缩小扫描范围**；
 * 投影结果与索引不一致时**以投影为准**（Q2「接线并对齐」）。
 */
export function listNegotiationSessionIds(): string[] {
  try {
    const dir = resolveNegotiationDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch (err) {
    logger.warn('negotiationState:list_failed', { error: String(err) });
    return [];
  }
}

/**
 * 按事实源（事件投影）**对齐**协商状态：清空挂起项并复位 `awaitingUser`。
 *
 * 调用时机：启动期投影已产出"当前仍挂起清单"并**逐项结算**之后 —— 结算后不再有挂起项，
 * 故对齐为"无挂起"。事件日志读失败时**不得**调用本函数（避免误清有效状态）。
 */
export function clearPendingState(state: NegotiationState): void {
  if (state.pending.length === 0 && !state.awaitingUser) return;
  state.pending = [];
  state.awaitingUser = false;
  state.askedAt = undefined;
  saveNegotiationState(state);
}
