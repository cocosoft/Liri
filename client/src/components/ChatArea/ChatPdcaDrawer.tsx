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
 * ChatPdcaDrawer — 普通会话就地展开的 PDCA 编排抽屉（P2/C3，2026-09-06）
 *
 * C3：普通聊天会话（无项目页上下文）内，当当前会话存在活跃 pdca 事件时，
 * 提供"就地展开完整编排面板"能力（无需跳转项目页）：
 * - 折叠态：一条细的「📊 PDCA 编排详情」入口行（数据为空时不渲染）
 * - 展开态：内嵌 PdcaPipeline（taskId，步骤/阶段详情，REST 轮询）+
 *   OrchestrationLivePanel（sessionId 过滤的 pdca:* 实时事件流）
 *
 * 与 PdcaActivityStrip（C1/C2）共用 findLatestEvent / 事件类型白名单（避免逻辑漂移）；
 * 折叠态仅存组件内 useState，跨刷新不持久化。
 */
import { useState, useRef } from "react";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { createLogger } from "@/utils/logger";
import {
  PROGRESS_EVENT_TYPES,
  AUTO_LAUNCHED_TYPE,
  findLatestEvent,
} from "./PdcaActivityStrip";
import OrchestrationLivePanel from "../Agent/OrchestrationLivePanel";
import PdcaPipeline from "../Agent/PdcaPipeline";

const logger = createLogger("ChatPdcaDrawer");

/** 输入区上方 PDCA 编排抽屉：当前会话有 pdca 事件时可展开完整编排面板 */
export default function ChatPdcaDrawer({ fluid = false }: { fluid?: boolean }) {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  const [open, setOpen] = useState(false);
  // 走查打点（2026-09-06）：入口"出现/消失/展开"仅打一次（过渡日志），
  // 避免每帧刷屏——前端一闪而过时也能在 console/logStore 留下证据。
  const prevVisible = useRef(false);

  const ev = currentSessionId
    ? findLatestEvent(timeline, latest, currentSessionId, [
        ...PROGRESS_EVENT_TYPES,
        AUTO_LAUNCHED_TYPE,
      ])
    : null;
  const visible = !!ev;
  if (visible && !prevVisible.current) {
    logger.info("PDCA 编排入口出现", {
      sessionId: currentSessionId,
      taskId: ev!.taskId ?? ev!.planId,
      eventType: ev!.type,
    });
  } else if (!visible && prevVisible.current) {
    logger.info("PDCA 编排入口消失", { sessionId: currentSessionId });
  }
  prevVisible.current = visible;
  if (!currentSessionId || !ev) return null;

  // 事件负载携带 taskId/planId 时才能驱动 PdcaPipeline（REST /v1/pdca/:id）
  const taskId = ev.taskId ?? ev.planId;

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        {open ? (
          <div className="rounded-lg border border-gray-200/70 dark:border-gray-700/60 bg-white/90 dark:bg-gray-800/90 shadow-sm overflow-hidden">
            {/* 面板头部：标题 + 收起 */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/50">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                📊 PDCA 编排面板
              </span>
              {taskId && (
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[12rem]">
                  {taskId}
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="ml-auto shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                title="收起编排面板"
                aria-label="收起编排面板"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>

            {/* 面板主体：步骤管线 + 实时事件流（限高滚动，防撑爆聊天区） */}
            <div className="max-h-[45vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/40">
              {taskId && (
                <div className="p-2">
                  <PdcaPipeline taskId={taskId} />
                </div>
              )}
              <div className="p-2">
                <OrchestrationLivePanel sessionId={currentSessionId} />
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              logger.info("PDCA 编排面板展开", {
                sessionId: currentSessionId,
                taskId: taskId ?? undefined,
              });
              setOpen(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/70 dark:hover:bg-gray-800/70 transition-colors"
            title="就地展开 PDCA 编排面板"
            aria-label="就地展开 PDCA 编排面板"
          >
            <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
              📊 PDCA 编排详情
            </span>
            <span className="flex-1 min-w-0 truncate text-[10px] text-gray-400 dark:text-gray-500">
              {taskId ? `任务 ${taskId}` : "编排事件流"}
            </span>
            <svg
              className="w-3 h-3 text-gray-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
