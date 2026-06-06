// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 智能路由模块入口
 */

export { SmartRouter } from './SmartRouter.js';
export type { SmartRouterOptions } from './SmartRouter.js';
export { getLastActiveTier } from './SmartRouter.js';
export { JudgeService } from './JudgeService.js';
export { TierResolver } from './TierResolver.js';
export { SessionRouterStore } from './SessionRouterStore.js';
export { RouterStatsCollector } from './RouterStatsCollector.js';
export { executeFallbackChain } from './FallbackChain.js';
export type { FallbackChainOptions, FallbackResult } from './FallbackChain.js';
export { executeWithRetry } from './RetryPolicy.js';
export type { RetryPolicyOptions, RetryableResponse, RetryResult } from './RetryPolicy.js';

// Phase 3: 自动编排
export { TaskDecomposer } from './TaskDecomposer.js';
export type { SubTask, DecompositionResult } from './TaskDecomposer.js';
export { OrchEngine } from './OrchEngine.js';
export type { OrchResult, SubTaskResult } from './OrchEngine.js';
export { AdaptiveRouter } from './AdaptiveRouter.js';
export type { ModelTierScore } from './AdaptiveRouter.js';

export type {
  RouterTier,
  RouterConfig,
  TierModelConfig,
  JudgeCloudConfig,
  RouteDecision,
  SessionRouteRecord,
  JudgeResult,
  RouterModelRef,
} from './types.js';
export { ALL_ROUTER_TIERS } from './types.js';
