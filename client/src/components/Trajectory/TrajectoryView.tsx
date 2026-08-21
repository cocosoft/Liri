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
 * TrajectoryView — 轨迹调试面板主容器（侧滑）
 *
 * M1-7：只读视图，按 seq 升序展示事件流，支持按 category 过滤、关键字搜索、
 * 点击行展开详情。
 *
 * 不修改任何业务状态，仅消费 trajectoryStore。
 */

import { useEffect, useMemo } from "react";
import { useTrajectoryStore } from "@/stores/chat/trajectoryStore";
import type { LiriEvent } from "@/types";
import { categorizeEvent } from "@/types";
import { TrajectoryFilter } from "./TrajectoryFilter";
import { TrajectoryRow } from "./TrajectoryRow";
import { TrajectoryDetail } from "./TrajectoryDetail";

interface Props {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

export function TrajectoryView({ sessionId, open, onClose }: Props) {
  const {
    events,
    tailSeq,
    loading,
    error,
    selectedSeq,
    filter,
    loadEvents,
    loadMore,
    hasMore,
    selectEvent,
    setFilter,
  } = useTrajectoryStore();

  useEffect(() => {
    if (open && sessionId) {
      loadEvents(sessionId);
    }
  }, [open, sessionId, loadEvents]);

  // 过滤后的事件
  const filteredEvents = useMemo(() => {
    let result: LiriEvent[] = events;
    if (filter.categories.length > 0) {
      const set = new Set(filter.categories);
      result = result.filter((e) => set.has(categorizeEvent(e.type)));
    }
    if (filter.types.length > 0) {
      const set = new Set(filter.types);
      result = result.filter((e) => set.has(e.type));
    }
    if (filter.keyword.trim()) {
      const kw = filter.keyword.trim().toLowerCase();
      result = result.filter((e) => {
        const data = e.data as Record<string, unknown>;
        const candidates = [
          typeof data.content === "string" ? data.content : "",
          typeof data.name === "string" ? data.name : "",
          typeof data.error === "string" ? data.error : "",
          typeof data.message === "string" ? data.message : "",
          typeof data.result === "string" ? data.result : "",
        ];
        return candidates.some((c) => c.toLowerCase().includes(kw));
      });
    }
    return result;
  }, [events, filter]);

  // 选中的事件对象
  const selectedEvent = useMemo(() => {
    if (selectedSeq === null) return null;
    return events.find((e) => e.seq === selectedSeq) ?? null;
  }, [events, selectedSeq]);

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-[520px] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            轨迹调试
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {filteredEvents.length}/{events.length} 条 · tailSeq={tailSeq}
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          aria-label="关闭"
        >
          ✕
        </button>
      </header>

      <TrajectoryFilter filter={filter} onChange={setFilter} />

      <div className="flex-1 overflow-y-auto">
        {loading && events.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            加载中...
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">
            加载失败：{error}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {events.length === 0 ? "暂无事件" : "无匹配事件"}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredEvents.map((event) => (
              <TrajectoryRow
                key={`${event.seq}-${event.type}`}
                event={event}
                selected={event.seq === selectedSeq}
                onClick={() =>
                  selectEvent(event.seq === selectedSeq ? null : event.seq)
                }
              />
            ))}
          </ul>
        )}

        {hasMore && !loading && (
          <div className="p-3 text-center">
            <button
              onClick={loadMore}
              className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
            >
              加载更多
            </button>
          </div>
        )}
      </div>

      {selectedEvent && (
        <TrajectoryDetail
          event={selectedEvent}
          onClose={() => selectEvent(null)}
        />
      )}
    </div>
  );
}
