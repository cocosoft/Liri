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
 * UI 期 UI-2（2026-09-23 修复计划 §十）：**入口从"独占一行"并入浮动栏徽标**。
 * 原折叠态是一整行「📊 PDCA 编排详情」（用户反馈：零碎信息把输入区撑开又没啥作用）。
 * 现本组件**只负责展开态面板**：
 *   - 可见性与 taskId 取自 `usePdcaEntry()` —— 与浮动栏徽标**共用同一判据**，禁止第二份
 *     （沿用原注释约定：与 PdcaActivityStrip 共用 findLatestEvent / 事件类型白名单，避免漂移）；
 *     批次 14（P2-A）起用 `available`（含终态）：抽屉是**唯一进度详情来源**，
 *     编排结束后仍须可达（终态结果、审计、事件流都在这里）；
 *   - 展开/收起由 `usePdcaDrawerStore` 承载（浮动栏徽标与消息卡「查看详情」两个入口共用）。
 *
 * 展开态：内嵌 PdcaPipeline（taskId，步骤/阶段详情，REST 轮询）+
 *   OrchestrationLivePanel（sessionId 过滤的 pdca:* 实时事件流）。
 */
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { usePdcaEntry } from "./usePdcaEntry";
import OrchestrationLivePanel from "../Agent/OrchestrationLivePanel";
import PdcaPipeline from "../Agent/PdcaPipeline";

/** 输入区上方的 PDCA 展开面板（入口徽标在浮动栏；无事件 / 未展开时不渲染） */
export default function ChatPdcaDrawer({
  fluid = false,
  open = false,
  onClose,
}: {
  fluid?: boolean;
  open?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { available, taskId } = usePdcaEntry();
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);

  if (!available || !open || !currentSessionId) return null;

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="rounded-lg border border-gray-200/70 dark:border-gray-700/60 bg-white/90 dark:bg-gray-800/90 shadow-sm overflow-hidden">
          {/* 面板头部：标题 + 「唯一进度详情」定位 + taskId + 收起 */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/50">
            <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
              📊 {t("chat.pdcaPanelTitle")}
            </span>
            {/* 批次 14（P2-C）：本面板是该会话**唯一**的进度详情来源（百分比/计数只在此） */}
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-[10px] text-gray-500 dark:text-gray-400">
              {t("chat.pdcaPanelSubtitle")}
            </span>
            {taskId && (
              <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[12rem]">
                {taskId}
              </span>
            )}
            <button
              onClick={() => onClose?.()}
              className="ml-auto shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title={t("chat.pdcaPanelCollapse")}
              aria-label={t("chat.pdcaPanelCollapse")}
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
            {/* 批次 14（P2-C）：无任务快照 ⇒ 不造假进度，只如实说明下面看的是事件流 */}
            {!taskId && (
              <div className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500">
                {t("chat.pdcaNoTaskSnapshot")}
              </div>
            )}
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
      </div>
    </div>
  );
}
