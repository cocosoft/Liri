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
 * A7 防泄题：**屏蔽清单的汇总与校验**（纯函数，离线可断言）。
 *
 * 分工：本模块只决定"该屏蔽哪些路径"与"是否真的屏蔽上了"；**执行**在
 * `tools/pathShield.ts` + `ToolRegistry.executeTool`（见那里的头注释）。
 *
 * 为什么要有校验（fail-closed）：题源任务的价值完全依赖"答案读不到"。若任务声明了题源路径、
 * 但沙箱实际没注入（例如调用方漏传），**评测会静默变成泄题**——通过率虚高且无人察觉。
 * 所以运行前必须逐条核对（`verifyShieldApplied`），缺一条即拒绝本次运行。
 */
import { normalizeShieldPath } from '../tools/pathShield';

/** 只取本模块需要的字段，避免与 `EvalTask` 形成循环依赖 */
export interface ShieldedTaskLike {
  id: string;
  shieldedPaths?: string[];
}

/** 汇总本次运行涉及的**全部**屏蔽路径（去重、去空、保持声明顺序） */
export function collectShieldedPaths(
  tasks: readonly ShieldedTaskLike[]
): string[] {
  const out: string[] = [];
  for (const task of tasks) {
    for (const raw of task.shieldedPaths ?? []) {
      const p = raw.trim();
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

export interface ShieldVerifyResult {
  ok: boolean;
  /** 声明了但**未**被沙箱接受（＝会泄题）的路径 */
  missing: string[];
}

/**
 * 核对"声明的屏蔽路径"是否都进了沙箱实际生效的清单。
 *
 * 比较用 {@link normalizeShieldPath}（大小写 / 分隔符 / 尾分隔符差异不算差异）。
 */
export function verifyShieldApplied(
  declared: readonly string[],
  applied: readonly string[]
): ShieldVerifyResult {
  const appliedSet = new Set(applied.map((p) => normalizeShieldPath(p)));
  const missing = declared.filter(
    (p) => !appliedSet.has(normalizeShieldPath(p))
  );
  return { ok: missing.length === 0, missing };
}
