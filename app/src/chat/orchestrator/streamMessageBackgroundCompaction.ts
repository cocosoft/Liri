/**
 * streamMessageFlow 的「**后台压缩水位状态块**」构造（P2-1n）。
 *
 * 动因（S4 观测 / S6 压缩后的下一轮窗口）：该段此前**内联**在 `runStreamMessage` 收尾处
 * （约 15 行）：取模型阈值 → 估算当前水位 → 算比值 → **达到 warn 阈值**才发「后台压缩进行中」
 * 状态块。判据（阈值比对）与文案沉在编排函数里 ⇒ 无法独立测试；而该块是"把 Tier3 的等待从
 * 用户发送前转移到发送后"的**用户可见**入口（项1，2026-08-13），阈值口径值得被锁定。
 *
 * 拆分手法（与 P2-1d-4 / P2-1i 一致）：**判据/载荷纯化、动作留下** ——
 * 本模块产出**状态块载荷或 `null`**；`yield` 的实际动作留在编排函数。
 *
 * 口径（与拆分前**逐字等价**）：
 * - 阈值复用 policy 的**真实阈值**（`getModelThresholds`，CS01 不重复定义）；
 * - `ratio = max > 0 ? tokens / max : 0`（`max` 非正 ⇒ 0，避免除零）；
 * - **低于阈值 ⇒ 返回 `null`**（不造无意义噪声状态块 —— 与拆分前同）。
 *
 * **可注入的估算器（DI 缝 · P0-8）**：`estimateTokens` 缺省为真实 `estimateMessagesTokens`；
 * 单测可注入确定性桩 ⇒（①）**避免构造超大输入**——**实测教训（2026-10-10）**：用 600k 字符
 * 字符串驱动"超水位"用例时，在**全量套件**上下文中 tiktoken 编码器已被其它测试加载 ⇒ 该输入走
 * tiktoken 路径，**单测阻塞数分钟**（`bun test` 整体卡死、`test:guarded` 超时失败）；（②）
 * 使"达阈值 ⇒ 出块 + 文案百分比"成为**确定性**断言（不依赖估算器实现细节）。
 */

import { estimateMessagesTokens } from '@modules/ai';
import type { ChatMessage } from '@modules/ai';
import { getModelThresholds } from '@modules/tokenBudget/UnifiedTokenTracker';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import { resolveMaxContextTokens } from '../services/ChatHelper.js';

export interface BackgroundCompactionStatusDeps {
  /** 当前会话消息（用于估算水位；`null` 会话由调用方保证非空） */
  messages: readonly unknown[];
  /** 本轮模型（`turnModel`）；`undefined` 时阈值取默认、窗口按缺省解析 */
  model: string | undefined;
  sessionId: string;
  /**
   * 可注入的 token 估算器（**DI 缝 · P0-8**）：缺省为真实 `estimateMessagesTokens`。
   * 单测注入确定性桩 ⇒ 既避免超大输入，又使阈值断言确定（见模块头注）。
   */
  estimateTokens?: (messages: readonly unknown[]) => number;
}

/**
 * 构造「上下文较长，正在后台压缩历史…」状态块；**未达阈值 ⇒ `null`**（详见模块头注）。
 *
 * ⚠️ 本函数**只构造载荷**：`yield` 与随后 `compactSessionInBackground` 的启动仍在编排函数。
 */
export function buildBackgroundCompactionNotice(
  deps: BackgroundCompactionStatusDeps
): ChatStreamChunk | null {
  const thresholds = getModelThresholds(deps.model || '');
  const estimate = deps.estimateTokens ?? estimateMessagesTokens;
  const tokens = estimate(deps.messages as unknown as ChatMessage[]);
  const max = resolveMaxContextTokens(deps.model);
  const ratio = max > 0 ? tokens / max : 0;
  if (ratio < thresholds.warn) return null;
  return {
    type: 'status',
    statusType: 'compaction',
    phase: 'compacting',
    content: `上下文较长（${Math.round(ratio * 100)}%），正在后台压缩历史...`,
    sessionId: deps.sessionId,
  } as ChatStreamChunk;
}
