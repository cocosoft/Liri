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
 * 检查点清理 —— **取用面投影**（子批 F `query` 组；2026-10-01 台账 D-222 B13）
 *
 * **为什么需要**：`session/SessionGateway.ts` 与 `session/SessionManager.ts`（service）原先
 * **静态**导入 app 层 `@modules/query` 的 `FileCheckpointStorage` ⇒ 2 条 `session -> query`(app) 倒挂。
 * ⚠️ 该类引 `../chat/types/checkpoint` ⇒ **app 耦合、不可下沉** ⇒ 走门面。
 *
 * **实际取用面极窄**（实测两处完全相同）：`(id: string) => new FileCheckpointStorage().deleteSessionCheckpoints(id)`
 * —— 即**一次性实例 + 单方法** ⇒ 投影只声明这 1 个方法（不做无谓的类替身）。
 *
 * ⚠️ 取用方式为「同步门面」：由 `CoreAPIImpl.getCheckpointCleanup()`（既有 sanctioned 缝，
 * 同 `getGlobalEmbeddingManager()`）**同步**返回本投影。
 */
export interface CheckpointCleanupPort {
  /** 原 `new FileCheckpointStorage().deleteSessionCheckpoints(sessionId)`（app 侧为 `async`） */
  deleteSessionCheckpoints(sessionId: string): Promise<void>;
}
