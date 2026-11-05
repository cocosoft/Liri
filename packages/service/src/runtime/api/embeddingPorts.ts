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
 * 嵌入能力 —— **取用面投影**（子批 F `ai` 组；2026-10-01 台账 D-222）
 *
 * **为什么需要**：`session/memory/SessionMemoryManager.ts`（service）原先**静态**导入 app 层
 * `@modules/ai` 的 `EmbeddingManager` 类型，`session/bootstrap/SessionSystemBootstrap.ts`
 * 直接取 `globalEmbeddingManager` 值 ⇒ 2 条 `session -> ai`(app) 倒挂。
 *
 * ⚠️ **取用方式为「同步门面」**：`getSessionMemoryManager()` 是**同步懒初始化**
 * （`if (!memoryManager) { memoryManager = new SessionMemoryManager(…) }`）⇒ 不可改异步
 * ⇒ 由 `CoreAPIImpl.getGlobalEmbeddingManager()`（既有 sanctioned 缝，同 `createAutoCompactService()`）
 * **同步**返回本投影。
 *
 * ⚠️ 投影**禁止引用 app 类型**（`R00-001` 连类型导入也计）⇒ 按调用方**实际读取面**最小投影：
 * `SessionMemoryManager` 仅消费 `embedOne(text)` 与 `embed(texts).embeddings`（见其
 * `semanticSearch` / `indexMemoryItems`）。
 */
export interface EmbeddingRefPort {
  /** 原 `globalEmbeddingManager.embedOne(text)`（同步方法返回 Promise；结果作查询向量） */
  embedOne(text: string): Promise<number[]>;
  /** 原 `globalEmbeddingManager.embed(texts)`（调用方仅读 `embeddings`） */
  embed(texts: string[]): Promise<{ embeddings: number[][] }>;
}
