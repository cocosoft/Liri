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
 * ClampedBody — 限高正文块（P2 共享组件，2026-08-25）
 *
 * 从 LogTab 内部定义提升为共享组件（CS01：TrajectoryDetail 复用，不复制一份）。
 * 长文本 200px 限高 + 渐变遮罩 + 「显示全部 / 收起」。
 */

import { useState } from "react";

const DETAIL_MAX_HEIGHT = 200;
const LONG_TEXT_CHARS = 600;
const LONG_TEXT_LINES = 12;

function isLongText(text: string): boolean {
  return (
    text.length > LONG_TEXT_CHARS ||
    (text.match(/\n/g)?.length ?? 0) > LONG_TEXT_LINES
  );
}

export interface ClampedBodyProps {
  text: string;
  label?: string;
  noClamp?: boolean;
}

export function ClampedBody({ text, label, noClamp }: ClampedBodyProps) {
  const [showAll, setShowAll] = useState(false);
  const long = isLongText(text);
  const clamped = !noClamp && !showAll;

  return (
    <div className="mt-1">
      <div
        className={`relative overflow-hidden rounded bg-gray-50 dark:bg-gray-800 ${
          clamped ? "max-h-[200px]" : ""
        }`}
        style={clamped ? { maxHeight: DETAIL_MAX_HEIGHT } : undefined}
      >
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all text-gray-600 dark:text-gray-300 p-1.5">
          {text}
        </pre>
        {clamped && long && (
          <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-gray-50 dark:from-gray-800 to-transparent pointer-events-none" />
        )}
      </div>
      {!noClamp && long && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="text-[10px] text-blue-500 mt-0.5 hover:underline"
        >
          {showAll ? "收起 ▲" : "显示全部 ▼"}
        </button>
      )}
      {label && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">
          {label}
        </span>
      )}
    </div>
  );
}

export default ClampedBody;
