// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * filterTrajectoryEvents —— 轨迹事件过滤（**纯函数**）
 *
 * P1-5（2026-09-22）节流配套：从 `ChatInspector` 的 `filteredEvents` memo **原样抽出**
 * （逐条保持既有语义），目的有二：
 * ① 让这段此前**零测试覆盖**的过滤逻辑可单测（含 keyword 候选字段、来源派生、seq/时间区间）；
 * ② 与 `useDeferredValue` 配套 —— 关键字用**延迟值**参与过滤，使输入框即时响应，
 *    而"过滤 → 布局派生 → 虚拟列表重建"这条随事件数线性变重的链路降为低优先级渲染。
 *
 * **为何不手写 setTimeout 节流**：`useDeferredValue` 不引入固定延迟（快设备立即收敛）、
 * 参与并发渲染且中间值会被 React 合并跳过、无需定时器与清理；语义上正是"昂贵派生降优先级"，
 * 比"固定 300ms 延迟"更贴合这里的真实诉求（输入不卡 + 派生不浪费）。
 */

import type { LiriEvent } from "@/types";
import { categorizeEvent } from "@/types";
import type { TrajectoryFilterState } from "./trajectoryStore";

/**
 * 来源维度派生映射（P7 2026-08-25 引入；本次由 `ChatInspector` 移入，成为**唯一实现**，
 * 避免"组件内一份 + 过滤函数一份"的漂移）。复用 `categorizeEvent` 而非新增枚举。
 */
const CATEGORY_TO_SOURCE: Record<string, string> = {
  conversation: "llm",
  tool: "tool",
  context: "system",
  system: "system",
  channel: "channel",
  lifecycle: "system",
};

export function categoryToSource(category: string): string {
  return CATEGORY_TO_SOURCE[category] ?? "system";
}

/** 关键字模糊匹配的候选字段（顺序与原实现一致） */
function keywordCandidates(event: LiriEvent): string[] {
  const data = event.data as Record<string, unknown>;
  return [
    typeof data.content === "string" ? data.content : "",
    typeof data.name === "string" ? data.name : "",
    typeof data.error === "string" ? data.error : "",
    typeof data.message === "string" ? data.message : "",
    typeof data.result === "string" ? data.result : "",
    typeof data.toolCallId === "string" ? data.toolCallId : "",
    typeof data.turn === "number" || typeof data.turn === "string"
      ? String(data.turn)
      : "",
    typeof data.model === "string" ? data.model : "",
  ];
}

/**
 * 按过滤器筛选事件。语义与抽取前**逐条一致**：
 * - 各维度为"与"关系，空数组/undefined = 该维度不过滤；
 * - `keyword` 前后去空白、大小写不敏感，命中任一候选字段即保留；
 * - 过滤顺序：categories → types → sources → seq 区间 → 时间区间 → keyword。
 */
export function filterTrajectoryEvents(
  events: LiriEvent[],
  filter: TrajectoryFilterState,
): LiriEvent[] {
  let result: LiriEvent[] = events;

  if (filter.categories.length > 0) {
    const set = new Set(filter.categories);
    result = result.filter((e) => set.has(categorizeEvent(e.type)));
  }
  if (filter.types.length > 0) {
    const set = new Set(filter.types);
    result = result.filter((e) => set.has(e.type));
  }
  if (filter.sources.length > 0) {
    const set = new Set(filter.sources);
    result = result.filter((e) =>
      set.has(categoryToSource(categorizeEvent(e.type))),
    );
  }
  if (filter.minSeq !== undefined) {
    const minSeq = filter.minSeq;
    result = result.filter((e) => e.seq >= minSeq);
  }
  if (filter.maxSeq !== undefined) {
    const maxSeq = filter.maxSeq;
    result = result.filter((e) => e.seq <= maxSeq);
  }
  if (filter.fromTime !== undefined) {
    const fromTime = filter.fromTime;
    result = result.filter((e) => e.time >= fromTime);
  }
  if (filter.toTime !== undefined) {
    const toTime = filter.toTime;
    result = result.filter((e) => e.time <= toTime);
  }
  if (filter.keyword.trim()) {
    const kw = filter.keyword.trim().toLowerCase();
    result = result.filter((e) =>
      keywordCandidates(e).some((c) => c.toLowerCase().includes(kw)),
    );
  }

  return result;
}
