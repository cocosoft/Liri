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
 * 技能运维 —— **服务层端口**（2026-09-30 台账 D-126，`R00-003` P6-b / G6-a）
 *
 * **为什么需要**：`infrastructure/http/handlers/skills-handlers.ts`（**service**）原先动态导入
 * `constants/systemPromptSections`（**infra**）取 `reloadUserSkills()`；该实现已**迁入 `skills`（app）**
 * ⇒ 若 handler 直连即为 `service -> app` 违规 ⇒ 改经本端口 + `CoreAPI` **单入口**取用
 * （`runtime -> skills` 属**既有 sanctioned 缝 ①**，**不新增对**），编排内聚在 `CoreAPIImpl`。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）—— 本端口无 app 类型出参，故无需投影。
 */

/** 技能运维端口 */
export interface SkillsOpsPort {
  /** 原 `reloadUserSkills()`（用户技能写盘/导入后，重载到运行时 registry + 刷新注入服务） */
  reloadUserSkills(): Promise<void>;
}
