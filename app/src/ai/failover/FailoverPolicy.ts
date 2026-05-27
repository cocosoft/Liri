/**
 * 模型回退策略（归一化）
 *
 * 原有 FailoverPolicy 类已合并到 ai/policy/ FailoverManager。
 * 本文件作为向后兼容的 re-export 层。
 *
 * @deprecated 直接从 @modules/ai/policy 导入 FailoverManager / classifyFailoverReason
 */
export {
  FailoverManager as FailoverPolicy,
  classifyFailoverReason,
} from '../policy/index.js';
export type {
  FailoverReason,
  FailoverEvent,
  FailoverChain,
} from '../policy/index.js';
