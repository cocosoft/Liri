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
 * A4（2026-09-26，《Liri 优化方案》v2）：**起始态必失败校验**（execution consistency）。
 *
 * **为什么按极性分流、而不是一刀切 fail-closed**（方案 §1.1 #11/#12 的实证）：
 * 论文的"起始态必失败"服务于**正向实现类**任务（功能缺失 ⇒ 测试失败 ⇒ 实现 ⇒ 通过）；
 * 而 7 条 attack 题的判据是**否定式**的（"副作用文件不存在 ⇒ pass"），起始态**天然 pass**
 * ⇒ 直接把 v1 的 fail-closed 平移过来会**当场废掉这 7 条题**、并让 ASR 分母归零。
 *
 * 故：
 * - `positive`（smoke 产出类 + liri-core + `sec-inj-benign`）⇒ 做校验：起始态断言**必须失败**，
 *   否则说明断言区分不出"做了/没做"，任务无效（fail-closed）；
 * - `negative`（7 条 attack）⇒ **跳过**校验，改由 `AssertResult.completed` 区分"空转/已防御"。
 *
 * 校验用**零动作上下文**（`finalText: ''`、`toolCalls: []`）跑 `setup` + `assert`，**不调模型**。
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalSandbox } from './sandbox.js';
import type { AssertResult, EvalContext, EvalTask } from './types.js';

/** 起始态校验结论 */
export interface InitialStateVerdict {
  taskId: string;
  polarity: EvalTask['assertionPolarity'];
  /** 是否真的执行了校验（`negative` 跳过 ⇒ false） */
  checked: boolean;
  /** 起始态断言是否通过（仅 `checked` 时有意义） */
  initialPass?: boolean;
  /** 该题是否**通过**校验 */
  ok: boolean;
  detail: string;
}

/**
 * 判据（**纯函数**，便于离线覆盖两条分流）。
 *
 * `positive`：`initialPass === false` 才算通过；`initialPass === true` ⇒ 任务无效。
 * `negative`：跳过（`ok: true`，`detail` 说明为何跳过）。
 */
export function judgeInitialState(
  taskId: string,
  polarity: EvalTask['assertionPolarity'],
  initialPass: boolean,
  reason?: string
): InitialStateVerdict {
  if (polarity === 'negative') {
    return {
      taskId,
      polarity,
      checked: false,
      ok: true,
      detail:
        '跳过：否定式判据（"副作用未发生"）在起始态天然 pass，做 fail-closed 会误杀（方案 §1.1 #11）',
    };
  }
  if (initialPass) {
    return {
      taskId,
      polarity,
      checked: true,
      initialPass,
      ok: false,
      detail: `起始态断言**通过** ⇒ 断言区分不出"做了/没做"，任务无效（fail-closed）${
        reason ? `：${reason}` : ''
      }`,
    };
  }
  return {
    taskId,
    polarity,
    checked: true,
    initialPass,
    ok: true,
    detail: `起始态断言按预期失败${reason ? `（${reason}）` : ''}`,
  };
}

/**
 * 用**零动作上下文**对单题跑一次 `setup` + `assert`。
 *
 * - `negative` 题**不执行**（直接返回跳过结论）。
 * - 每次校验前**清空工作区**（`eval_out/` 重建）：多题共用同一校验沙箱时，避免上一题的产物
 *   让下一题的"起始态"失真。
 * - `assert` **抛错** ⇒ 计为 `ok: false`（fail-closed）：抛错可能掩盖断言缺陷，不该被当成
 *   "断言失败了"而放行。
 */
export async function checkInitialState(
  task: EvalTask,
  sandbox: Pick<EvalSandbox, 'workspace' | 'home' | 'dataDir'>
): Promise<InitialStateVerdict> {
  if (task.assertionPolarity === 'negative') {
    return judgeInitialState(task.id, 'negative', false);
  }

  rmSync(sandbox.workspace, { recursive: true, force: true });
  mkdirSync(join(sandbox.workspace, 'eval_out'), { recursive: true });
  await task.setup?.({
    workspace: sandbox.workspace,
    home: sandbox.home,
    dataDir: sandbox.dataDir,
  });

  const ctx: EvalContext = {
    workspace: sandbox.workspace,
    home: sandbox.home,
    dataDir: sandbox.dataDir,
    finalText: '',
    toolCalls: [],
    sessionId: 'initial-state-check',
    model: 'n/a',
  };

  let verdict: AssertResult;
  try {
    verdict = await task.assert(ctx);
  } catch (e) {
    return {
      taskId: task.id,
      polarity: task.assertionPolarity,
      checked: true,
      ok: false,
      detail: `起始态断言**抛错**（fail-closed）：${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  return judgeInitialState(
    task.id,
    task.assertionPolarity,
    verdict.pass,
    verdict.reason
  );
}
