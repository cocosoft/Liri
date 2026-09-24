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
 * run 记录装配器（P0-1 接入点第二刀）
 *
 * seam 的输出是**两级回调**（run 级 + 成员级），消费方（工具）需要的是一份可随
 * `ToolResult.metadata` 带出的 `WorkflowRunRecord`。本装配器是这两者之间的**唯一**
 * 转换点 —— 放在 seam 侧而非各领域工具内，避免每个消费方各抄一份（CS01 归一化）。
 *
 * 与 `WorkflowStepLedger` 的分工：账本是**上报端**（reporter → observer，负责配对
 * 不变式与强制结算），本装配器是**消费端**（observer → record，负责装配形状）。
 *
 * **不合成、不编造**（CS06）：`step_end` 若找不到配对的 `step_start`，直接丢弃。
 * 配对不变式由账本保证，此处只需忠实装配。
 */

import type {
  WorkflowRunObserver,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from './types';

export interface RunRecordCollector {
  /** 注入 `WorkflowExecuteOptions.observer` */
  observer: WorkflowRunObserver;
  /** 执行结束后即为完整记录（`record.end` 已回填） */
  record: WorkflowRunRecord;
}

/**
 * 创建 run 记录装配器。
 *
 * @example
 * const { observer, record } = createRunRecordCollector();
 * await engine.execute(name, params, { observer });
 * return { metadata: { workflowRun: record } };
 */
export function createRunRecordCollector(): RunRecordCollector {
  const steps: WorkflowStepRecord[] = [];
  const record: WorkflowRunRecord = { steps };

  const observer: WorkflowRunObserver = {
    onRunStart: (info) => {
      record.start = info;
    },
    onStepStart: (info) => {
      steps.push({ start: info });
    },
    onStepEnd: (info) => {
      const entry = steps.find(
        (item) => item.start.stepId === info.stepId && item.end === undefined
      );
      if (entry) entry.end = info;
    },
    onRunEnd: (info) => {
      record.end = info;
    },
  };

  return { observer, record };
}
