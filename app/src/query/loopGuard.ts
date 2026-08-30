// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * loopGuard — ReActLoop 无进展熔断判定（D 项，2026-08-30）
 *
 * 抽取为纯函数模块：ReActLoop 骨架与测试均引用此处，避免测试直接加载
 * ReActLoop 类触发 TAORLoop↔ReActLoop 深层循环依赖 TDZ（项目已知问题）。
 */

import type { ActResult } from './ReActLoop.js';

/**
 * 构建轮签名：工具名+状态排序拼接。
 * 用于检测"不同工具组合反复尝试但无实质进展"的循环
 *（与 checkCircuitBreaker 的 all-error 熔断互补）。
 */
export function buildRoundSignature(actResult: ActResult): string {
  return [...actResult.results]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((r) => `${r.name}:${r.status}`)
    .join('|');
}

/**
 * 判断是否构成无进展循环：窗口内最近 threshold 轮签名全部一致。
 *
 * @param recentSignatures 已记录的最近若干轮签名（调用方维护有界窗口）
 * @param threshold 熔断阈值（连续相同轮数）
 * @returns 窗口尾部是否连续 threshold 轮签名相同
 */
export function isRepeatedLoop(
  recentSignatures: string[],
  threshold: number
): boolean {
  if (threshold <= 0 || recentSignatures.length < threshold) return false;
  const tail = recentSignatures.slice(-threshold);
  return tail.every((s) => s === tail[0]);
}
