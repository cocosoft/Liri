/**
 * LLM 跟踪器单例
 * 提供全局访问入口
 */

import { LLMTracker } from './LLMTracker.js';
import { resolveScopedDbPath } from '@modules/core/paths';
// 多租户 P1（2026-10-21）：LLM 调用记录按身份分实例（本地身份零变更）
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '../../core/identity/requestScope.js';

/**
 * 全局 LLM 跟踪器实例（**本地身份 / 无请求作用域**使用）
 */
export const llmTracker = new LLMTracker();

/** 多租户 P1：非本地身份的跟踪器实例（各自独立 app.db） */
const scopedTrackers = new Map<string, LLMTracker>();

/**
 * 获取 LLM 跟踪器实例。
 *
 * 多租户 P1：本地身份 ⇒ 原全局实例（零变更）；已认证身份 ⇒ 该身份自己的实例，
 * 并在创建时**同步**开库建表（`recordLLMCall` 是同步热路径，异步初始化会让首批记录丢失）。
 */
export function getLLMTracker(): LLMTracker {
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principalKeyOf(principal);
    const existing = scopedTrackers.get(key);
    if (existing) return existing;
    const scoped = new LLMTracker();
    scoped.openScopedSync(resolveScopedDbPath(principal));
    scopedTrackers.set(key, scoped);
    return scoped;
  }
  return llmTracker;
}
