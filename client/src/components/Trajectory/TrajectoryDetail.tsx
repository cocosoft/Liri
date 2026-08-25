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
 * TrajectoryDetail — 事件详情底部面板
 *
 * 点击行后从底部弹出，展示完整 data JSON。
 */

import { useMemo, useState } from "react";
import type { LiriEvent } from "@/types";
import { ClampedBody } from "../common/ClampedBody";

interface Props {
  event: LiriEvent;
  onClose: () => void;
}

export function TrajectoryDetail({ event, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const jsonText = useMemo(() => {
    try {
      return JSON.stringify(event.data, null, 2);
    } catch {
      return String(event.data);
    }
  }, [event]);

  const timeStr = useMemo(() => {
    return new Date(event.time).toLocaleString("zh-CN", { hour12: false });
  }, [event]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // @ignore-catch — 剪贴板不可用时静默
    }
  };

  // P5（2026-08-25）：工具事件字段分区块（参数 / 结果 / 错误）
  const data = (event.data ?? {}) as Record<string, unknown>;
  const hasArgs = typeof data.arguments === "object" && data.arguments !== null;
  const hasResult = data.result !== undefined && data.result !== null;
  const hasError = data.error !== undefined && data.error !== null;
  const stringifyField = (v: unknown): string =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  const showFieldSections = hasArgs || hasResult || hasError;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 max-h-[50%] flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
            #{event.seq}
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {event.type}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* P5：复制 JSON */}
          <button
            onClick={handleCopy}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              copied
                ? "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700"
                : "text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            aria-label="复制 JSON"
          >
            {copied ? "已复制 ✓" : "复制 JSON"}
          </button>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            aria-label="关闭详情"
          >
            ✕
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3 text-xs">
        <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 mb-3">
          <dt className="text-gray-500 dark:text-gray-400">seq</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {event.seq}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">time</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {timeStr}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">sessionId</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
            {event.sessionId}
          </dd>
          {event.sourceEventSeqs && event.sourceEventSeqs.length > 0 && (
            <>
              <dt className="text-gray-500 dark:text-gray-400">sources</dt>
              <dd className="font-mono text-gray-900 dark:text-gray-100">
                {event.sourceEventSeqs.join(", ")}
              </dd>
            </>
          )}
          {event.ignorable && (
            <>
              <dt className="text-gray-500 dark:text-gray-400">ignorable</dt>
              <dd className="font-mono text-amber-600 dark:text-amber-400">
                true
              </dd>
            </>
          )}
        </dl>

        {showFieldSections ? (
          /* P5：工具事件字段聚焦（参数 / 结果 / 错误分区块） */
          <div className="space-y-2">
            {hasArgs && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  arguments
                </div>
                <ClampedBody text={stringifyField(data.arguments)} />
              </div>
            )}
            {hasResult && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  result
                </div>
                <ClampedBody text={stringifyField(data.result)} />
              </div>
            )}
            {hasError && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  error
                </div>
                <ClampedBody text={stringifyField(data.error)} />
              </div>
            )}
          </div>
        ) : (
          /* 非工具事件：完整 data 限高展示 */
          <div>
            <div className="text-gray-500 dark:text-gray-400 mb-0.5">data</div>
            <ClampedBody text={jsonText} />
          </div>
        )}
      </div>
    </div>
  );
}
