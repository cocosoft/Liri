/**
 * 结构化 Attention（P37，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P37。
 * 参考：`dsh:docs/001-domain.md:101`（Attention 是结构化事实）、
 * `dsh:docs/002-domain.md:155`（面板只在四个条件同时满足时提示人）、
 * `dsh:docs/000:12`（只在"人必须行动 / 有可用结果"时开口）。
 *
 * 三条纪律：
 * 1. **禁止从自由文本判定"在等人"** —— 只看 `AttentionFacts`（CS02）；
 * 2. 三档语义：`speak`（现在就该让人看到）/ `queue`（重要但不紧急，进收件箱）/
 *    `silent`（过程性进展，只写日志）；
 * 3. 每工作项打扰次数**有上限**（默认 2），计数可从 DB 复算（见
 *    `InboxManager.countByTicket()`），不维护第二份内存台账。
 *
 * 本文件是纯函数 + 类型：无 IO、不 import 队列/通道实现。
 */
import type { InboxItemType } from '../runtime/InboxManager';

/** 打扰档位 */
export type AttentionTier = 'speak' | 'queue' | 'silent';

/**
 * 结构化注意力事实（**唯一判据**）。
 *
 * 三个字段对应参考实现的三种"值得打断人"的情形；全为 `false` ⇒ 过程性进展。
 */
export interface AttentionFacts {
  /** 人在等这个结果（阻塞了人的下一步） */
  humanWaiting: boolean;
  /** 需要人做决定（审批 / 提问 / 授权） */
  needsDecision: boolean;
  /** 产出了人可直接使用的结果（报告 / 补丁 / 文件） */
  usableOutput: boolean;
}

/** 每工作项允许的打扰次数上限（超过即静默，避免"同一件事反复叫人"） */
export const MAX_TICKET_INTERRUPTIONS = 2;

/** 是否"值得打断人"（三情形任一成立） */
export function isActionableAttention(facts: AttentionFacts): boolean {
  return facts.humanWaiting || facts.needsDecision || facts.usableOutput;
}

/**
 * 由「事实 + 门禁动作」推导档位（**纯函数**）。
 *
 * - 门禁 `drop` ⇒ `silent`（被去重/关闭/过期/预算拦下，本就不该出现）；
 * - 门禁 `queue` ⇒ `queue`（DND/冷却/限流；**DND 内不得升级为 speak**）；
 * - 门禁 `deliver` ⇒ 有行动价值 `speak`，否则 `silent`（过程性进展只写日志）。
 *
 * `facts` 缺省 ⇒ 兼容既有生产者：按 `deliver ⇒ speak` 处理（行为不变）。
 */
export function resolveAttentionTier(
  facts: AttentionFacts | undefined,
  gateAction: 'deliver' | 'queue' | 'drop'
): AttentionTier {
  if (gateAction === 'drop') return 'silent';
  if (gateAction === 'queue') return 'queue';
  if (!facts) return 'speak';
  return isActionableAttention(facts) ? 'speak' : 'silent';
}

/** 该工作项的打扰预算是否已用尽（`notices` 由 DB 计数提供） */
export function isTicketBudgetExhausted(
  notices: number,
  max: number = MAX_TICKET_INTERRUPTIONS
): boolean {
  if (!Number.isFinite(max) || max <= 0) return false; // 0/非法 ⇒ 不设限
  return Number.isFinite(notices) && notices >= max;
}

/**
 * Inbox 条目的**结构化**注意力载荷（P37 第 1 条）。
 *
 * 写入 `inbox_items.metadata` 后，面板/审计可直接读 `kind / question / ticketId /
 * triggerId`，**不再**从 `title` / `message` 里做关键词判断。
 */
export interface InboxAttentionPayload {
  /** 与 `InboxItemType` 同源（不另立第二套枚举） */
  kind: InboxItemType;
  /** 需要人回答的问题（结构化字段，不要求调用方把它拼进 title） */
  question: string;
  /** 所属工作项（可空：与工单无关的审批） */
  ticketId?: string;
  /** 触发该工单的 Trigger id（P35；可空） */
  triggerId?: string;
  /** 可选项（与 `InboxItem.options` 同义） */
  options?: string[];
  createdAt: number;
}

/** 转成 `inbox_items.metadata`（键名固定，供 SQL/面板消费） */
export function toInboxMetadata(
  payload: InboxAttentionPayload
): Record<string, unknown> {
  return {
    attentionKind: payload.kind,
    attentionQuestion: payload.question,
    ...(payload.ticketId ? { ticketId: payload.ticketId } : {}),
    ...(payload.triggerId ? { triggerId: payload.triggerId } : {}),
    ...(payload.options ? { options: [...payload.options] } : {}),
    attentionAt: payload.createdAt,
  };
}

/**
 * 从 `inbox_items.metadata` 还原结构化事实（读侧；缺失字段 ⇒ 不猜）。
 *
 * 目前只有 `kind` / `question` 是必填；`ticketId` 缺失 ⇒ 该条不参与工作项打扰计数。
 */
export function readInboxAttention(
  metadata: Record<string, unknown> | undefined
):
  | {
      kind: InboxItemType;
      question: string;
      ticketId?: string;
      triggerId?: string;
    }
  | undefined {
  if (!metadata) return undefined;
  const kind = metadata.attentionKind;
  const question = metadata.attentionQuestion;
  if (typeof kind !== 'string' || typeof question !== 'string')
    return undefined;
  if (kind !== 'approval' && kind !== 'question' && kind !== 'authorization') {
    return undefined;
  }
  return {
    kind,
    question,
    ...(typeof metadata.ticketId === 'string'
      ? { ticketId: metadata.ticketId }
      : {}),
    ...(typeof metadata.triggerId === 'string'
      ? { triggerId: metadata.triggerId }
      : {}),
  };
}
