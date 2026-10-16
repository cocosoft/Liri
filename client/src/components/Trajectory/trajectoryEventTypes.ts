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
 * 轨迹面板的**事件类型**相关单一实现（2026-10-16，台账 `TRAJECTORY-TYPE-FILTER-DYNAMIC`）。
 *
 * ① `TYPE_LABEL_KEYS` / `trajectoryTypeLabel`：类型 → i18n 标签（无标签则回落原始 type 串）。
 *    此前这里的内容分裂成**两份手写清单**（`TrajectoryRow` 18 条标签 / `TrajectoryFilter` 21 条
 *    按钮），互相错位：**12 个按钮无中文标签**（行内显示原始 type 串）、**9 个标签无按钮**
 *    （有中文名却筛不到）；两份都只覆盖 `LIRI_EVENT_NAMES`(54) 的约 1/3。
 * ② `countEventTypes`：由**已加载事件**派生可选类型候选（按出现次数降序、同次数按类型名字典序），
 *    供筛选栏**动态生成**类型按钮 ⇒ 覆盖随真实数据自动 100%、无需维护清单。
 *
 * ⚠️ 为什么不铺静态全量 54 项按钮：面板高度已在 TB-1 记为瓶颈（1280×720 下筛选区占 42%），
 *    而真实会话只出现 ~10–27 种类型；动态候选是"数据驱动"的最小面，且天然让
 *    `metric/timing`(真机 6.5%) / `request/start`(3.3%) 这类最吵类型**一定**有按钮。
 */

import type { LiriEvent, LiriEventType } from "@/types";

/** 类型 → i18n 标签键（缺项回落原始 type 串，见 `trajectoryTypeLabel`） */
const TYPE_LABEL_KEYS: Record<string, string> = {
  "turn/start": "trajectory.type.turnStart",
  "turn/end": "trajectory.type.turnEnd",
  "user/message": "trajectory.type.userMessage",
  "assistant/thinking": "trajectory.type.thinking",
  "assistant/text": "trajectory.type.reply",
  "assistant/tool_call": "trajectory.type.toolCall",
  "tool/result": "trajectory.type.toolResult",
  "context/compaction": "trajectory.type.contextCompaction",
  "context/summary": "trajectory.type.contextSummary",
  "system/error": "trajectory.type.error",
  "system/warning": "trajectory.type.warning",
  "system/info": "trajectory.type.info",
  "metric/timing": "trajectory.type.metricTiming",
  "channel/connect": "trajectory.type.channelConnect",
  "channel/disconnect": "trajectory.type.channelDisconnect",
  "channel/message": "trajectory.type.channelMessage",
  "session/start": "trajectory.type.sessionStart",
  "session/end": "trajectory.type.sessionEnd",
};

/** 类型的展示标签：命中 i18n 键则翻译，否则回落原始 type 串（保证任何类型都有可读标签） */
export function trajectoryTypeLabel(
  type: string,
  t: (key: string) => string,
): string {
  const key = TYPE_LABEL_KEYS[type];
  return key ? t(key) : type;
}

/** 类型候选（`countEventTypes` 产出项） */
export interface TrajectoryTypeOption {
  type: LiriEventType;
  count: number;
}

/**
 * 按**出现次数**统计已加载事件的类型（降序；同次数按类型名字典序 ⇒ 结果确定、不随
 * Map 插入顺序抖动）。仅用于筛选栏的候选集合，不改变任何过滤语义。
 */
export function countEventTypes(
  events: readonly LiriEvent[],
): TrajectoryTypeOption[] {
  const counts = new Map<LiriEventType, number>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  return Array.from(counts, ([type, count]) => ({ type, count })).sort(
    (a, b) => b.count - a.count || (a.type < b.type ? -1 : 1),
  );
}
