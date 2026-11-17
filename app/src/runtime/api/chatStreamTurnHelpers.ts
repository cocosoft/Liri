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
 * `CoreAPIImpl.chatStream` 单轮编排的纯函数助手（T3，2026-11-17）。
 *
 * 从 `chatStream` 的 `onUsage` 回调与 catch 块**原样搬出**（零行为变更）：
 * 累加口径与错误文案解析不再埋在生成器里，既可单测，也让该函数的圈复杂度回到阈值内。
 */
/** 一次 LLM 调用的 usage 增量（`ChatManager.streamMessage` 的 `onUsage` 回调口径） */
export interface StreamUsageDelta {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** 整轮累加后的 usage（done 块 / 返回日志口径） */
export interface StreamUsageTotal {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * AB-10 修复：**累加**而非覆盖 —— 主回复 + 各工具轮次 LLM 调用都会回调，
 * 累加后 usage SSE 事件反映整轮消息的完整用量。
 */
export function accumulateStreamUsage(
  prev: StreamUsageTotal | undefined,
  usage: StreamUsageDelta
): StreamUsageTotal {
  return {
    inputTokens: (prev?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (prev?.outputTokens ?? 0) + usage.outputTokens,
    totalTokens:
      (prev?.totalTokens ?? 0) +
      (usage.totalTokens ?? usage.inputTokens + usage.outputTokens),
    estimatedCostUsd:
      (prev?.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0),
    cacheReadTokens:
      (prev?.cacheReadTokens ?? 0) + (usage.cacheReadInputTokens ?? 0),
    cacheCreationTokens:
      (prev?.cacheCreationTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
  };
}

/**
 * 流式失败的**用户可见文案**。
 *
 * 普通对象（如 AI Provider 返回的 `{ message: "...", type: "..." }`）可能不是 `Error` 实例，
 * 故显式读 `.message`；两者皆无 ⇒ `String(error)`。
 */
export function describeStreamError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const obj = error as Record<string, unknown> | null | undefined;
  if (obj?.message) return String(obj.message);
  return String(error);
}
