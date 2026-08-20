/**
 * NegotiationState — 协商式执行引擎的状态机 + 持久化（设计方案 §5.2 + §5.7）
 *
 * 状态机：
 *   idle → analyzing → awaiting_confirm → executing → awaiting_review → done
 *
 * 持久化：
 *   序列化到 ~/.pyapp/data/negotiation/<sessionId>.json
 *   应用启动时检测 awaitingUser=true 则恢复挂起提问
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
 */
export function hasPendingRestoration(
  state: NegotiationState | null
): state is NegotiationState {
  return state !== null && state.awaitingUser && state.pending.length > 0;
}
