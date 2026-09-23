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
 * JsonTree — 可折叠 JSON 树（P2-3，2026-09-22）
 *
 * 用于轨迹详情面板，替换原先的纯文本 `JSON.stringify`（对标 deepseek-harness 的 JSON 树展示）。
 *
 * 设计（简洁优先）：
 * - **递归自持折叠状态**：每个容器节点一个 `useState` ⇒ 无需外部状态树，组件自洽；
 * - **大对象限高滚动**（`max-h`）——避免长 `data` 撑爆面板；
 * - **长字符串截断**（`MAX_STRING_CHARS`）——事件 `data` 可能含超大正文（实测某会话单消息
 *   2.1MB），整段渲染会卡死；超长只显示前 N 字符 + 省略提示（**原文仍可经"复制"按钮获取**，
 *   故截断不损失信息，只损失"一次看全"）；
 * - 类型着色：string / number / boolean / null / undefined 各一色。
 */

import { useState } from "react";

interface Props {
  value: unknown;
  /** 初始展开深度（0 = 全部折叠；默认 1 = 展开根一层） */
  defaultDepth?: number;
}

/** 单行字符串渲染上限（超出截断，避免巨型正文卡死渲染） */
const MAX_STRING_CHARS = 2000;

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === "object" && v !== null;
}

function previewOf(v: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(v)) return `Array(${v.length})`;
  return `Object(${Object.keys(v).length})`;
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-gray-500">null</span>;
  if (value === undefined)
    return <span className="text-gray-500">undefined</span>;
  if (typeof value === "string") {
    const truncated = value.length > MAX_STRING_CHARS;
    return (
      <span className="text-emerald-600 dark:text-emerald-400 break-all">
        &quot;{truncated ? value.slice(0, MAX_STRING_CHARS) : value}&quot;
        {truncated && (
          <span className="text-gray-400">…（共 {value.length} 字符）</span>
        )}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-amber-600 dark:text-amber-400">
        {String(value)}
      </span>
    );
  }
  return <span className="text-gray-600">{String(value)}</span>;
}

function JsonNode({
  value,
  depth,
  defaultDepth,
}: {
  value: unknown;
  depth: number;
  defaultDepth: number;
}) {
  const [open, setOpen] = useState(depth < defaultDepth);

  if (!isContainer(value)) {
    return <PrimitiveValue value={value} />;
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);

  return (
    <span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        aria-expanded={open}
      >
        {open ? "▾" : "▸"}
      </button>
      <span className="text-gray-500">{previewOf(value)}</span>
      {open && (
        <div className="pl-4 border-l border-gray-200 dark:border-gray-700">
          {entries.map(([k, v]) => (
            <div key={k}>
              <span className="text-violet-600 dark:text-violet-400">{k}</span>
              <span className="text-gray-400">: </span>
              <JsonNode
                value={v}
                depth={depth + 1}
                defaultDepth={defaultDepth}
              />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function JsonTree({ value, defaultDepth = 1 }: Props) {
  return (
    <div className="font-mono text-xs overflow-auto max-h-[420px] p-2 rounded bg-gray-50 dark:bg-gray-900/40">
      <JsonNode value={value} depth={0} defaultDepth={defaultDepth} />
    </div>
  );
}

export default JsonTree;
