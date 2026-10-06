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
 * decompositionSchema — LLM 分解结果的结构校验（M1，2026-10-06）
 *
 * 背景（回仓取证）：`TaskDecomposer.parseDecomposition` 原为**裸 `JSON.parse`** +
 * 逐字段就地兜底 ⇒ 畸形结构（`subTasks` 非数组 / 含 `null` 元素 / `dependsOn` 含
 * 非字符串 / `id` 重复）会被**静默接受**成"看起来合法"的结果。
 *
 * 本模块用 zod 做**声明式结构校验**：畸形 ⇒ 明确失败，由既有
 * `throw → simpleDecompose()`（`TaskDecomposer.decompose()` 的 catch）降级为单步。
 *
 * 边界（如实）：
 * - **归一化仍留在 `TaskDecomposer`**（`name`→`description` 兜底、缺 `id` 自动编号、
 *   超发截断）：本模块只判定"能否安全消费"，不收紧既有宽进能力。
 * - `zod` 已在 `app/package.json` 声明（`^3.23.0`，实测 3.25.76）⇒ **零新增依赖**。
 *
 * spec：`.trae/specs/task-decomposition-schema-validation.md`（裁定 D1=zod / D2=抛错降级）。
 */

import { z } from 'zod';

/**
 * LLM 出参中的单个子任务（**宽进**：`name` 可替代 `description`、字段均可缺省）。
 * 单一事实源：原定义在 `TaskDecomposer.ts` 为文件内接口，现上移至此处供 schema 与消费方共用（CS01）。
 */
export const parsedSubTaskSchema = z.object({
  id: z.string().optional(),
  /** 修复 3（2026-08-25）：LLM 可能用 `name` 字段替代 `description` */
  name: z.string().optional(),
  description: z.string().optional(),
  tier: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export type ParsedSubTaskJson = z.infer<typeof parsedSubTaskSchema>;

/** 顶层结构：`subTasks` **非空**（空分解对下游编排无意义 ⇒ 判失败，spec §4-D3=(a)） */
const decompositionSchema = z.object({
  mainTier: z.string().optional(),
  reasoning: z.string().optional(),
  subTasks: z.array(parsedSubTaskSchema).min(1),
});

/** 结构化失败项（**非用户可见文案**，CS02：状态判定用结构化字段） */
export interface DecompositionShapeIssue {
  /** 定位，如 `subTasks.2.dependsOn.0`（zod path join） */
  path: string;
  kind: 'schema' | 'duplicate_id';
}

export type DecompositionShape =
  | { ok: true; data: z.infer<typeof decompositionSchema> }
  | { ok: false; issues: DecompositionShapeIssue[] };

/**
 * 校验 `JSON.parse` 后的分解结果结构（纯函数，无 IO）。
 *
 * @param raw - 不可信的原始值
 * @param maxSubTasks - 超发截断上限（与 `TaskDecomposer.MAX_SUBTASKS` 同源；由调用方传入以避免循环导入）
 */
export function validateDecompositionShape(
  raw: unknown,
  maxSubTasks: number
): DecompositionShape {
  const parsed = decompositionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        kind: 'schema' as const,
      })),
    };
  }

  // 重复 id 判定：**先截断后判定**（spec §3 规则 5）—— 避免"被截掉的重复"误报。
  // 只比对**显式给出**的 id：缺 id 由调用方自动编号（`step-N`），不在本模块判定。
  const explicitIds = parsed.data.subTasks
    .slice(0, maxSubTasks)
    .flatMap((st, index) =>
      typeof st.id === 'string' ? [{ id: st.id, index }] : []
    );
  const seen = new Set<string>();
  const duplicates: DecompositionShapeIssue[] = [];
  for (const { id, index } of explicitIds) {
    if (seen.has(id)) {
      duplicates.push({ path: `subTasks.${index}.id`, kind: 'duplicate_id' });
    } else {
      seen.add(id);
    }
  }
  if (duplicates.length > 0) {
    return { ok: false, issues: duplicates };
  }

  return { ok: true, data: parsed.data };
}
