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
 * S2/S7 流式请求的**所有权释放**（会话互斥锁 + 资源治理名额）—— P2-1e
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S2 与 §3-S7 / §5。
 *
 * **口径（本仓既有修复的沉淀，勿改）**：
 * - **唯一释放点**：`mutex` / `governor` 只在 `runStreamMessage` 的**最外层 `finally`**
 *   释放一次（P2 修复 AB-2 + BUG-1/2 收敛）。内层工具循环**不**再 release ——
 *   历史上双重 release 非幂等（队列为空时第二次 `release` 会把 `locked` 清零），
 *   导致并发请求穿透「同一会话串行」保证。
 * - **只释放"确实持有"的**：`acquire` 失败/超时抛错时标志为 `false` ⇒ **绝不能** release
 *   （否则会错误清零**他人**持有的锁）。
 * - 治理器开关关闭时其 `release` 内部为 no-op（见 `resourceGovernor/index.ts` 头注）。
 *
 * **边界（如实）**：**准入侧不在本模块** —— `governorAdmitted` 必须在
 * `governor.acquire()` 之后、`mutex.acquire()` **之前**置真（后者抛错时前者仍需在
 * `finally` 被释放）⇒ 该时序与 `runStreamMessage` 的 `let` 状态**同处一处**，
 * 外移会改变异常路径语义（**禁止**）。
 */

import { getResourceGovernor } from '@modules/resourceGovernor';

/**
 * 释放本次流式请求持有的所有权（**幂等性由标志保证**；调用方须只在唯一释放点调用）。
 *
 * @param mutex          会话互斥锁（只需 `release`）
 * @param sessionId      会话 id（治理器按会话记账）
 * @param mutexHeld      首轮 `acquire` 是否成功
 * @param governorAdmitted 治理器名额是否已准入
 */
export function releaseStreamOwnership(
  mutex: { release: () => void },
  sessionId: string,
  mutexHeld: boolean,
  governorAdmitted: boolean
): void {
  if (mutexHeld) {
    mutex.release();
  }
  if (governorAdmitted) {
    getResourceGovernor().release(sessionId);
  }
}
