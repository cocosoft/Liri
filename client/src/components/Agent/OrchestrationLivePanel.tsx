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
 * OrchestrationLivePanel — PDCA 实时编排面板（OBS，M3b-UI，2026-09-04）
 *
 * 纯展示：订阅 orchestrationStore（pdca:* 独立通道），显示各任务最近状态
 * 与最近分流决策（为何走 PDL/阶段链）。REST 快照由调用方（pdca 列表加载）
 * 回放 seed，本面板专注实时增量。
 *
 * 阶段一 4.2-4：按会话上下文过滤——调用方传入 projectId/sessionId 后，
 * 仅展示归属匹配的事件；事件未显式携带归属字段时保守保留（兼容缺失归属的旧事件）。
 */
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import type { PdcaLiveEventPayload } from "@/stores/orchestrationStore";

interface OrchestrationLivePanelProps {
  /** 项目上下文（编排视图当前所在项目）；提供后仅展示该项目任务 */
  projectId?: string;
  /** 会话上下文（后续会话级编排视图上提用）；提供后仅展示该会话任务 */
  sessionId?: string;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function describe(ev: PdcaLiveEventPayload): string {
  const d = ev.data ?? {};
  const stage = (d.stage as string) ?? "";
  const status = (d.status as string) ?? ev.type.replace("pdca:stage:", "");
  const percent = typeof d.percent === "number" ? `${d.percent}%` : "";
  const msg =
    (d.message as string) ?? (d.decision as string) ?? `${stage} ${status}`;
  return [msg, percent].filter(Boolean).join(" · ");
}

export default function OrchestrationLivePanel({
  projectId,
  sessionId,
}: OrchestrationLivePanelProps) {
  const latest = useOrchestrationStore((s) => s.latest);
  const timeline = useOrchestrationStore((s) => s.timeline);

  // 4.2-4：上下文过滤——显式携带归属字段且不匹配 → 剔除；缺失归属 → 保守保留
  const matchesScope = (ev: PdcaLiveEventPayload): boolean => {
    if (projectId && ev.projectId && ev.projectId !== projectId) return false;
    if (sessionId && ev.sessionId && ev.sessionId !== sessionId) return false;
    return true;
  };

  const entries = Object.values(latest).filter(
    (ev) => ev.type !== "pdca:decision" && matchesScope(ev),
  );
  const decisions = timeline
    .filter((ev) => ev.type === "pdca:decision" && matchesScope(ev))
    .slice(-3)
    .reverse();

  if (entries.length === 0 && decisions.length === 0) return null;

  return (
    <div className="border-t border-gray-100 dark:border-gray-800">
      <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        实时编排 (通道)
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-1.5 text-[11px] text-gray-400">
          暂无活动任务
        </div>
      ) : (
        entries.map((ev) => (
          <div
            key={ev.taskId || ev.planId || ev.time}
            className="px-3 py-1.5 text-[11px] text-gray-600 dark:text-gray-300"
          >
            <span className="text-gray-400 mr-1">{fmtTime(ev.time)}</span>
            <span className="mr-1">
              {(ev.data?.stage as string) ?? "execute"}
            </span>
            <span className="text-gray-400">{describe(ev)}</span>
          </div>
        ))
      )}
      {decisions.length > 0 && (
        <>
          <div className="px-3 py-1 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            最近分流决策
          </div>
          {decisions.map((ev, i) => (
            <div
              key={`${ev.time}-${i}`}
              className="px-3 py-1 text-[11px] text-gray-500 dark:text-gray-400"
            >
              {fmtTime(ev.time)} · {describe(ev)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
