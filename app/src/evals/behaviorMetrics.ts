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
 * A2（2026-09-26，《Liri 优化方案》）：评测**行为指标**（三个子指标）—— 纯函数。
 *
 * **⚠️ 仅作观测信号，不得作为通过/失败判据**（方案 A2 明文）：论文自身 CI 只对"自验证"
 * 的 95% CI 不含 0；exploration / drafting 的区间**跨过 0（统计不显著）**。把它们当门禁
 * 等于把噪声当判据。故本模块的产物**不接入** `isAsExpected()` / 基线比对。
 *
 * **数据来源**：A1 已把工具调用 args 落盘（`buildToolCallsDetail`），本模块只用
 * `ToolCallRecord[]` 与当轮正文文本，**零额外采集成本**。
 *
 * **① 的前置确认已做（方案要求"动工前必做一次"）**：③ 若取自正文，须确认评测链路是否经过
 * `chat/services/bareExplorationStripper.ts`（剥离裸探索句 ⇒ 会系统性低估）。实测结论：
 * 该函数的 4 个调用点**均在"消息终态/落盘"路径**（逐行读 `StreamPipeline.repairContent`
 * 作用于 `accumulatedContent` 且 `isComplete: true`、`ReActToolLoop.ts:1152-1164` 写
 * `assistantMessage.content`；另两处 `ChatManager.ts:5414` / `sendMessageFlow.ts:584` 经 grep
 * 定位为同族落盘点，未逐行读），而评测侧累加的是 **SSE 增量 delta**（`runner.ts:155-158`）
 * ⇒ ③ 不落在被剥离的产物上，**不构成"系统性低估"**。
 * 残余不确定性（如实）：若将来引入 delta 级清洗，本结论需重验。
 *
 * 工具名均为**真实注册名**：`file_read`（FileReadTool.ts:238）、`file_write`（FileWriteTool.ts:129）、
 * `file_edit`（FileEditTool.ts:176）、`grep`（GrepTool.ts:94）、`glob`（search/GlobTool.ts:26）。
 */

import type { BehaviorMetrics, ToolCallRecord } from './types.js';

/** 编辑类工具（"首个编辑"标记位） */
const EDIT_TOOLS = new Set(['file_edit', 'file_write']);

/** 读/搜类工具（探索度口径） */
const EXPLORE_TOOLS = new Set(['file_read', 'grep', 'glob']);

/** 首个编辑类调用的下标；无编辑 ⇒ -1 */
function firstEditIndex(calls: ToolCallRecord[]): number {
  return calls.findIndex((c) => EDIT_TOOLS.has(c.name));
}

/** 命令字符串归一化：去首尾空白 + 折叠内部空白（`ls  a` 与 `ls a` 视为同一命令） */
function normalizeCommand(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length > 0 ? s : undefined;
}

/**
 * ① 自验证次数：**首个编辑之后**发生的"独立验证命令"数。
 *
 * 口径（如实，不做语义分类）：把编辑之后**任何带 `command` 参数的调用**（`bash` / `code_run`
 * 等）视为候选命令，按**归一化命令字符串去重**后计数 —— 方案原文"经不同工具发出的等价命令
 * 按重复计"即"跨工具按字符串去重"。**不**尝试判断"这条命令是否真是验证"（那需要语义分类，
 * 会把噪声当判据）。
 *
 * 边界：无编辑 ⇒ 0；编辑后无命令 ⇒ 0。
 */
export function countSelfVerification(calls: ToolCallRecord[]): number {
  const start = firstEditIndex(calls);
  if (start === -1) return 0;

  const seen = new Set<string>();
  for (let i = start + 1; i < calls.length; i++) {
    const cmd = normalizeCommand(calls[i].args?.command);
    if (cmd) seen.add(cmd);
  }
  return seen.size;
}

/**
 * ② 探索度：**首个编辑之前**的读/搜调用次数（`file_read` / `grep` / `glob`）。
 *
 * 边界：全程无编辑 ⇒ 计全部读/搜（"编辑前"即整段轨迹）。
 */
export function countExploration(calls: ToolCallRecord[]): number {
  const editAt = firstEditIndex(calls);
  const end = editAt === -1 ? calls.length : editAt;
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (EXPLORE_TOOLS.has(calls[i].name)) count += 1;
  }
  return count;
}

/**
 * ③ 草稿比：当轮正文长度 ÷ 工具调用数（保留 2 位）。
 *
 * 工具调用数为 0 时返回 0（不做除零，也不把它当"无限大"）。
 */
export function draftingRatio(text: string, toolCallCount: number): number {
  if (toolCallCount <= 0) return 0;
  return Number((text.trim().length / toolCallCount).toFixed(2));
}

/** 汇总三个子指标（供 `runner.ts` 单点调用） */
export function computeBehaviorMetrics(
  calls: ToolCallRecord[],
  text: string
): BehaviorMetrics {
  return {
    selfVerificationCount: countSelfVerification(calls),
    explorationCount: countExploration(calls),
    draftingRatio: draftingRatio(text, calls.length),
  };
}
