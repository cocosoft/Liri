/**
 * 统一 effects 队列出口（P38，2026-11-02）
 *
 * 本行只做再导出；具体语义见 `EffectQueue.ts` 与 `types.ts`。
 * 生产接线（把某个分域台账迁到本队列）**不在本批**：需先选定目标域并补双跑对照，
 * 见方案 §5 P38「先迁一类，其余保持原样」。
 */
export { EffectQueue, EFFECT_QUEUE_TABLE } from './EffectQueue';
// P38-b-2：`reply` 影子队列（只写不派发；由宿主注入 channels 的影子端口）
export {
  REPLY_EFFECT_KIND,
  replyEffectKey,
  shadowReplyRelay,
} from './replyShadow';
export type {
  ReplyEffectPayload,
  ReplyShadowInput,
  ReplyShadowQueue,
} from './replyShadow';
// P38-b-3：`reply` 派发运行时（开关开启时由宿主启动扫描器）
export {
  createDefaultReplyDispatchDeps,
  dispatchDueReplies,
  enqueueReplyEffect,
  kickReplyEffectDispatcher,
  setReplyEffectQueueForTest,
  startReplyEffectDispatcher,
} from './replyEffectRuntime';
export type { ReplyDispatchDeps } from './replyEffectRuntime';
// P39-b-2：effects 计数（面板观测面；单例连接）
export {
  getEffectCounts,
  setEffectCountsQueueForTest,
  toEffectCountsSummary,
} from './effectCounts';
export type { EffectCountsSummary } from './effectCounts';
export {
  EFFECT_CLAIM_STALE_MS,
  EFFECT_DEFAULT_LATER_MS,
  EFFECT_FAILURES_BEFORE_ERROR,
  EFFECT_KIND_MAX_ATTEMPTS,
  EFFECT_KINDS,
  EFFECT_MAX_RETRY_MS,
  EFFECT_RETRY_BASE_MS,
  EFFECT_STATUSES,
  EFFECT_STATUS_ATTEMPTING,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
  effectRetryDelay,
} from './types';
export type {
  ClaimEffectResult,
  ClaimedEffect,
  EffectEntry,
  EffectKind,
  EffectOutcome,
  EffectStatus,
} from './types';
