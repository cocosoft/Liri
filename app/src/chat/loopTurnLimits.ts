// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 工具轮次上限统一解析（调用方分级基础，对标 cc_code 2026-09-01）
 *
 * 调用方分级语义（单一事实来源，供各循环引用，避免上限分散在各文件）：
 * - 主对话（chat）：基础阈值 30（env MAX_TAOR_TURNS / MAX_TOOL_TURNS 可覆盖）
 *   + 动态扩容（未完成 todo × DYNAMIC_TURNS_PER_PENDING_TODO，硬顶 MAX_DYNAMIC_TOOL_TURNS_CAP）
 *   ——动态计算在 ReActToolLoop 内部（chat 主循环路径）
 * - 子代理（subagent）：默认 50（SubAgentEngine 调用方分级）
 * - 后台任务/压缩：各自定值（如压缩 =1，不在此管理）
 *
 * 2026-08-30 循环治理背景：基础阈值曾 300→30 以拦截工具死循环；
 * 死循环拦截已由 LoopDetector（同调用同结果/连续无工具/文件 IO 循环）承担，
 * 本模块仅管理轮次上限的单一事实来源，避免各文件各自 parseInt env。
 */
import { configManager } from '@modules/config';

/** 主对话基础轮次阈值默认值（2026-08-30 循环治理：防死循环，30 覆盖正常多轮任务） */
export const DEFAULT_BASE_TOOL_TURNS = 30;
/** 动态扩容：每 1 个未完成 todo task 增加的轮次（对标 PDCA max(20, steps*5)） */
export const DYNAMIC_TURNS_PER_PENDING_TODO = 5;
/** P10（2026-09-01）：无 todo 但涉及外部获取/技能探索的任务额外扩容轮次——
 *  此类任务需要多轮尝试（抓取→失败→换源→查询→求助），基础 30 轮偏紧。 */
export const EXTERNAL_FETCH_EXPANSION_TURNS = 20;
/** 动态扩容硬顶（防失控兜底） */
export const MAX_DYNAMIC_TOOL_TURNS_CAP = 500;
/** 子代理默认最大轮次（SubAgentEngine，调用方分级，对标 cc_code fork 子代理 200；2026-09-01 决策 3 落地 50→200） */
export const DEFAULT_SUBAGENT_MAX_TURNS = 200;

/**
 * 解析主对话基础轮次阈值：
 * env MAX_TAOR_TURNS || MAX_TOOL_TURNS 显式配置最高优先级（合法时），否则默认 30。
 */
export function resolveBaseToolTurns(): number {
  const env =
    configManager.env('MAX_TAOR_TURNS') ||
    configManager.env('MAX_TOOL_TURNS');
  if (env) {
    const val = parseInt(env, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return DEFAULT_BASE_TOOL_TURNS;
}
