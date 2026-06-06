/**
 * LLM 跟踪器单例
 * 提供全局访问入口
 */

import { LLMTracker } from './LLMTracker.js';

/**
 * 全局 LLM 跟踪器实例
 */
export const llmTracker = new LLMTracker();

/**
 * 获取 LLM 跟踪器实例
 */
export function getLLMTracker(): LLMTracker {
  return llmTracker;
}
