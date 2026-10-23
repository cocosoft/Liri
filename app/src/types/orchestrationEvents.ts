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
 * `types` 模块的**编排事件词汇表**出口（app 层门面）。
 *
 * 沿革：D-67 曾把该词汇表从 `agent/events/OrchestrationEvents.ts` 下沉到
 * `app/src/types/orchestrationEvents.ts`（core 层类型中心）；**P6 再下沉一层**到内核包
 * （`@openliri/kernel/orchestrationEvents`）—— 因为内核的 4 个事件文件
 * （`TokenTracker` / `OrchestrationMetrics` / `orchestrationPairing` / `EventBusOTelBridge`）
 * 是它的真实消费者，而内核必须能在**没有 app** 的情况下独立构建。
 *
 * 本文件保留为 `@modules/types/orchestrationEvents` 的既有出口：上层
 * （`agent/events`、`infrastructure/http/handlers`、`monitoring`、`tasks/swarm`）无需改动。
 * 与 `error/types.ts` 转出 `@openliri/kernel/errors` 是同一手法。
 *
 * 载荷类型（`OrchStartData` 等）与派生函数仍留在 app 层——「只下沉名字、不下沉载荷」（D-57）。
 */
export {
  OrchestrationEventType,
  type OrchestrationEventTypeValue,
} from '@openliri/kernel/orchestrationEvents.js';
