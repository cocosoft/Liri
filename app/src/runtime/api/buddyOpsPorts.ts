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
 * Buddy（虚拟伙伴）运维 —— **服务层端口**（C1「口径 C」：`buddy` 域单点收尾；2026-09-30 台账 D-111）
 *
 * **范围（本批 = `buddy-handlers.ts` 的 6 个动态导入）**。
 *
 * ⚠️ **多处返回值仅供 `JSON.stringify` / 展开**（`dreamStats` · `dreamLogs` · `growthState` ·
 * `interactionResult`）⇒ 端口按 `Record<string, unknown>` 声明（规则 38 的"展开"分支）；
 * 因 app 侧为 `interface`（**无隐式索引签名**）⇒ 实现侧相应位置**一处**收窄。
 */

/** Buddy 运维端口 */
export interface BuddyOpsPort {
  /**
   * 原 `getCompanion()`（`null` = 暂无伙伴；**原样回传**给 `executeBuddyInteraction`）。
   * ⚠️ 必须是**真对象** —— 调用方把它**原样转交**给 `executeBuddyInteraction`。
   */
  getBuddyCompanion(): Promise<unknown>;
  /** 原 `new InteractionManager().execute(companion, action)`（返回值供 `JSON.stringify` + 读 `response`） */
  executeBuddyInteraction(
    companion: unknown,
    action: string
  ): Promise<Record<string, unknown>>;
  /** 原 `getDreamStats()`（供展开 + 读 `totalCompleted`） */
  getBuddyDreamStats(): Promise<Record<string, unknown>>;
  /** 原 `getDreamLogs(limit, offset)`（供展开 + 读 `logs`；⚠️ 原码有**单参**调用 ⇒ `offset` 可选） */
  getBuddyDreamLogs(
    limit: number,
    offset?: number | undefined
  ): Promise<Record<string, unknown>>;
  /**
   * 原 `getDreamLogsByType(type, limit, offset)`。
   * ⚠️ `type` 原为**字面量联合**（原码 `typeFilter as any`）⇒ 端口收为 `string`，实现侧一处收窄。
   */
  getBuddyDreamLogsByType(
    type: string,
    limit: number,
    offset?: number | undefined
  ): Promise<Record<string, unknown>>;
  /** 原 `loadGrowthState()`（供读 8 个成长字段） */
  loadBuddyGrowthState(): Promise<Record<string, unknown>>;
}
