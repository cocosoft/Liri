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
 * workMode.ts — Plan/Do 工作模式契约（V-18 ⑤；设计见 `.trae/specs/plan-do-mode.md`）
 *
 * 事实来源：**会话 metadata.workMode**（由 `POST /v1/workspaces/:id/sessions` 写入，见
 * `infrastructure/http/handlers/workspaces-handlers.ts`）。本模块只承担两件事：
 *
 *  ① **HTTP 边界的取值校验**：`isWorkMode()` —— 非法值必须 fail loud（此前 `work_mode`
 *     在后端无任何读取点，客户端发了也无人校验，属"空投"，比未实现更难发现）；
 *  ② **模式 → 系统提示片段**：`plan` 追加"只规划、不产出最终交付物"的要求；
 *     `do` 与未提供时**原样返回**（现行为不变，Spec §5.3）。
 */

/** 工作模式（取值与后端会话 metadata 一致，勿改名） */
export type WorkMode = 'plan' | 'do';

/** 取值校验（用于 HTTP 边界等外部输入） */
export function isWorkMode(value: unknown): value is WorkMode {
  return value === 'plan' || value === 'do';
}

/** `plan` 模式追加的系统提示片段 */
export const PLAN_MODE_PROMPT = [
  '【工作模式：Plan（规划）】',
  '本次会话处于规划阶段：先给出完整、可执行的计划（步骤、依赖、风险、验收标准），',
  '不要直接产出最终交付物，也不要调用会产生副作用的写操作工具；',
  '计划产出后等待用户确认，再进入 Do（执行）阶段。',
].join('\n');

/**
 * 把工作模式应用到系统提示。
 *
 * - `plan` → 在调用方原有 system prompt 之后追加规划要求（原有提示不丢失）
 * - `do` / 未提供 → **原样返回**（现行为不变）
 */
export function applyWorkModeToSystemPrompt(
  systemPrompt: string | undefined,
  mode: WorkMode | undefined
): string | undefined {
  if (mode !== 'plan') {
    return systemPrompt;
  }
  return systemPrompt
    ? `${systemPrompt}\n\n${PLAN_MODE_PROMPT}`
    : PLAN_MODE_PROMPT;
}
