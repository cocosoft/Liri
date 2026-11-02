/**
 * 统一 effects 队列出口（P38，2026-11-02）
 *
 * 本行只做再导出；具体语义见 `EffectQueue.ts` 与 `types.ts`。
 * 生产接线（把某个分域台账迁到本队列）**不在本批**：需先选定目标域并补双跑对照，
 * 见方案 §5 P38「先迁一类，其余保持原样」。
 */
export { EffectQueue, EFFECT_QUEUE_TABLE } from './EffectQueue';
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
