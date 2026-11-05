// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction,ing, including without limitation the rights
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
 * 压缩域运行时 —— **服务层取用面投影**（子批 E `chat` 组；2026-10-01 台账 D-217）
 *
 * **为什么需要**：`session/compaction/ServiceAdapters.ts`（service）需要构造并调用
 * app 侧的 `AutoCompactService`（`checkAndCompact` / `performAutoCompact`）⇒ 该目录
 * **改归 app**（`services/compact/**` → **独立 app 模块** `compaction`，见 spec §3.5 D-217 方案乙）后，
 * 若继续直接 import 会构成 `session -> compaction`(app) 倒挂 ⇒ 改经**取用面投影**本处取用。
 *
 * ⚠️ **取用方式为「同步门面」而非 Promise 端口**：调用点在 `SessionGateway` 的**构造函数**与
 * **同步 fluent API** 内 ⇒ 由 `CoreAPIImpl.createAutoCompactService()`（既有 sanctioned 缝，
 * 同 `getChatManager()`）**同步**返回本投影；本文件仅定义投影**类型**，不含工厂方法。
 *
 * ⚠️ 投影**禁止引用 app 类型**（`R00-001` 连类型导入也计）⇒ 入参按调用方实参用 `unknown[]`，
 * 返回按调用方**读取面**最小投影（`{ shouldCompact }` / `{ success, error? }`）。
 */

/** app 侧 `AutoCompactService` 的**最小投影**（仅 `session/compaction` 实际调用的 2 方法） */
export interface AutoCompactServiceRefPort {
  /** 原 `service.checkAndCompact(sessionId, messages, model)`（同步，返回 `{ shouldCompact }`） */
  checkAndCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): { shouldCompact: boolean };
  /** 原 `service.performAutoCompact(...)`（异步；仅读取 `success` / `error`） */
  performAutoCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): Promise<{ success: boolean; error?: string | undefined }>;
}
