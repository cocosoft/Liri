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
 * 任务卡快照取数（**单一来源**）：`StatusFloatBar`（进度条）与 `usePdcaStartEntry`
 * （"用编排推进"入口）共用同一"最新任务卡"判定，避免两处判定漂移。
 *
 * BUG-9 修复（2026-08-23）：优先从 `planTaskStore` 读实时任务数据（SSE 驱动，与
 * TaskCard 组件同源，不再滞后于消息块静态快照）。按消息中最后一个 taskCard 块的
 * planId 定位；planTaskStore 缺失（plan:completed 已移除）时回退消息块快照。
 *
 * 2026-09-25：自 `StatusFloatBar.tsx` 抽出为独立模块 —— 该文件为组件文件，
 * 导出非组件函数会触发 `react-refresh/only-export-components` 警告。
 */
import type { TaskCardData } from "../../types";

export function findLatestTaskCard(
  messages: Array<{
    blocks?: Array<{ taskCard?: TaskCardData; type?: string }>;
  }>,
  liveTasks: Record<string, TaskCardData>,
): TaskCardData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].blocks;
    if (!blocks) continue;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      if (!block.taskCard) continue;
      const planId = block.taskCard.planId;
      // 优先实时数据（planTaskStore），缺失回退块快照
      if (planId && liveTasks[planId]) return liveTasks[planId];
      return block.taskCard as TaskCardData;
    }
  }
  return null;
}
