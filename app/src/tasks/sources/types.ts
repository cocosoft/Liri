/**
 * Source / Trigger / Thread —— 「外部事件 → 工作项」的唯一入口（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P35**。
 * 语义对齐参考实现 `docs/001-domain.md:27-29`（Source 订阅外部事件）与
 * `docs/001-domain.md:43`（同一 Thread 串行）。
 *
 * 本文件只有**类型与纯函数**：不发 IO、不读配置、不 import 上层。
 *
 * 三条硬约束（方案 §5 P35）：
 * 1. **幂等 id**：`Trigger` 的 id 由 `(source, 外部 id, 事件类型)` 确定性生成
 *    ⇒ 同一事件重复投递只产生一个工作项；
 * 2. **单线程串行**：同一 `ThreadKey` 同时只跑一个处理批次，期间到达的合并进下一批；
 * 3. **读位点持久化**：`cursor` 推进后落库，重启不重放（见 `cursor.ts`）。
 */

/** 线程键：同一外部对象（一个 cron 任务 / 一个文件路径 …）的串行域 */
export type ThreadKey = string & { readonly __brand: 'ThreadKey' };

/** 事件类型（新增来源时必须在此登记，禁止散落裸字符串） */
export const SOURCE_EVENT_TYPES = [
  'cron_tick',
  'file_changed',
  // D1（2026-11-14）：外部系统推送（webhook；GitHub issue / 邮件轮询接入时复用本类型）
  'external_event',
] as const;
export type SourceEventType = (typeof SOURCE_EVENT_TYPES)[number];

/** 来源侧投递的一条入站事件 */
export interface InboundEvent {
  /** 串行域（同键串行、异键并行） */
  threadKey: ThreadKey;
  /** 来源方的事件标识（确定性幂等键的一部分；同一事件重投必须相同） */
  externalId: string;
  /** 事件类型 */
  type: SourceEventType;
  /** 结构化载荷（进入工作项时原样保存，不做语义解释） */
  payload: Record<string, unknown>;
  /**
   * 来源侧读位点（单调递增）。
   *
   * 缺省 ⇒ 只靠 `triggerId` 幂等；提供 ⇒ 位点 ≤ 已存位点的事件直接跳过（重启不重放）。
   */
  cursor?: number;
}

/** 一次「外部事件 → 工作项」的触发事实（持久化后交给处理方） */
export interface Trigger {
  triggerId: string;
  sourceId: string;
  threadKey: ThreadKey;
  type: SourceEventType;
  externalId: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

/** 外部事件来源（`subscribe` 返回 disposer ⇒ 热重载不泄漏） */
export interface EventSource {
  readonly id: string;
  subscribe(
    handler: (event: InboundEvent) => void | Promise<void>
  ): Promise<() => void>;
}

/** `asThreadKey` 的域前缀（便于日志与排障；不是状态词表） */
export const THREAD_KEY_PREFIX = {
  cron: 'cron',
  fs: 'fs',
  external: 'external',
} as const;

/** 构造线程键（`<域>:<外部 id>`） */
export function asThreadKey(domain: string, externalId: string): ThreadKey {
  return `${domain}:${externalId}` as ThreadKey;
}

/**
 * 确定性 trigger id（**纯函数**）。
 *
 * 组成固定为 `sourceId \u0000 externalId \u0000 type`，用 djb2 折叠为 32 位无符号数
 * 再以 `tg1-` 前缀输出（与 `permission/policyStrength.ts#buildPolicyVersion` 同型）。
 * 分隔符参与运算 ⇒ `(a,bc)` 与 `(ab,c)` 不会碰撞。
 *
 * 为什么不用随机 id：参考实现的去重就是「同一机制防轮询重叠」（`docs/008`），
 * 随机 id 会让重启/重投各建一个工作项。
 */
export function computeTriggerId(
  sourceId: string,
  event: Pick<InboundEvent, 'externalId' | 'type'>
): string {
  const input = `${sourceId}\u0000${event.externalId}\u0000${event.type}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `tg1-${hash.toString(16)}`;
}

/** 由入站事件 + 来源 id 组装 Trigger（唯一组装点） */
export function toTrigger(
  sourceId: string,
  event: InboundEvent,
  receivedAt: number
): Trigger {
  return {
    triggerId: computeTriggerId(sourceId, event),
    sourceId,
    threadKey: event.threadKey,
    type: event.type,
    externalId: event.externalId,
    payload: event.payload,
    receivedAt,
  };
}
