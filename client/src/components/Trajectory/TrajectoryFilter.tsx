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
 * TrajectoryFilter — 事件过滤栏
 *
 * 支持按 category 多选 + 关键字搜索。
 */

import { useId } from "react";
import type { LiriEventCategory } from "@/types";
import type { TrajectoryFilterState } from "@/stores/chat/trajectoryStore";

const CATEGORY_OPTIONS: Array<{
  value: LiriEventCategory;
  label: string;
  color: string;
}> = [
  {
    value: "conversation",
    label: "对话",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    value: "tool",
    label: "工具",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  {
    value: "context",
    label: "上下文",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    value: "system",
    label: "系统",
    color: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  },
  {
    value: "channel",
    label: "通道",
    color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  {
    value: "lifecycle",
    label: "生命周期",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
];

interface Props {
  filter: TrajectoryFilterState;
  onChange: (patch: Partial<TrajectoryFilterState>) => void;
}

export function TrajectoryFilter({ filter, onChange }: Props) {
  const keywordId = useId();

  const toggleCategory = (cat: LiriEventCategory) => {
    const set = new Set(filter.categories);
    if (set.has(cat)) set.delete(cat);
    else set.add(cat);
    onChange({ categories: Array.from(set) });
  };

  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
      <div className="flex flex-wrap gap-1">
        {CATEGORY_OPTIONS.map((opt) => {
          const active = filter.categories.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggleCategory(opt.value)}
              className={`px-2 py-0.5 text-xs rounded transition ${
                active
                  ? opt.color
                  : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={keywordId}
          className="text-xs text-gray-500 dark:text-gray-400 shrink-0"
        >
          搜索
        </label>
        <input
          id={keywordId}
          type="text"
          value={filter.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          placeholder="content / name / error / result"
          className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {(filter.keyword || filter.categories.length > 0) && (
          <button
            onClick={() => onChange({ keyword: "", categories: [] })}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}
