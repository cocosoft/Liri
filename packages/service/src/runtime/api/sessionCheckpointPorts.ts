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
 * 会话检查点 —— **取用面投影**（B11 余 1 条 · `session -> chat` 收口；2026-10-01）
 *
 * **为什么需要**：`session/compaction/ServiceAdapters.ts`（service）原先**静态**导入 app 层
 * `@modules/chat` 的 `getCheckpointService`（值）与 `SessionCheckpointService`（类型）
 * ⇒ 1 条 `session -> chat`(app) 倒挂。
 * ⚠️ 该取用是**装配值**（非类型）⇒ 移类型文件治不了 ⇒ 走门面（同 `getGlobalEmbeddingManager()`）。
 *
 * **实际取用面极窄**（适配器只用 1 个方法、只读 2 个字段）：
 *   `real.createCheckpoint({ sessionId, autoCreated: true })` ⇒ 只读 `cp.id` / `cp.createdAt`
 * ⇒ 投影只声明这 1 方法与 2 字段（不做无谓的类替身）。
 * （事实源：`chat/services/SessionCheckpointService.ts:42` 的 `createCheckpoint`；
 *  `session/types/checkpoint.ts` 的 `CreateCheckpointParams`（除 `sessionId` 外全可选）与
 *  `SessionCheckpoint.createdAt: number`。）
 *
 * ⚠️ 取用方式为「同步门面」：由 `CoreAPIImpl.getSessionCheckpointRef()`（既有 sanctioned 缝，
 * 同 `getCheckpointCleanup()` / `getGlobalEmbeddingManager()`）**同步**返回本投影 ——
 * 调用点在**同步函数** `createWiredCompactionBridge()` 体内，不可改异步（同 D-217 约束）。
 */
export interface SessionCheckpointRefPort {
  /** 原 `SessionCheckpointService.createCheckpoint({ sessionId, autoCreated })`（返回值只取 `id`/`createdAt`） */
  createCheckpoint(params: {
    sessionId: string;
    autoCreated?: boolean;
  }): Promise<{ id: string; createdAt: number }>;
}
