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
export type { TokenUsage, TokenCountResult } from './TokenCounter';

export {
  CHARS_PER_TOKEN,
  TOKEN_ESTIMATION_OFFSET,
  TOKEN_THRESHOLD_200K,
  roughTokenCountEstimation,
  roughTokenCountForMessages,
  tokenCountWithEstimation,
  getTokenCountFromUsage,
  getCurrentUsage,
  doesExceedTokenThreshold,
  doesMostRecentExceed200k,
  getAssistantMessageContentLength,
  calculateTokenEstimateFromUsage,
} from './TokenCounter';

// 2026-10-02 D-224：移除「Phase 2.9 自 core 转出 TokenBudgetController/Status/State 的向后兼容别名块」
// —— 该别名（`TokenBudgetManager` 等）全仓**零消费**，且 `tokenBudget` 已**改归 app**；保留会让本
// service 层文件产生 `service -> app` 倒挂（BULK-005）。消费方一律直连 `@modules/tokenBudget`。
export type { ModelSpecificTokenEstimator } from './TokenEstimator';

export {
  DEFAULT_ESTIMATORS,
  getEstimatorForModel,
  estimateTokensForText,
  estimateTokensForMessages,
  estimateThinkingTokens,
} from './TokenEstimator';
