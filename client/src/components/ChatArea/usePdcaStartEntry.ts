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
 * usePdcaStartEntry — 「用编排推进（启动 PDCA）」入口的共享判定与动作（纯前端）。
 *
 * 展示条件（两者同时成立，全部按**状态量**判定，无文案/字符串匹配）：
 *   ① 当前会话存在未完成的 todo 任务 —— 取消息中**最新**一张 taskCard 快照
 *      （复用 StatusFloatBar 的 findLatestTaskCard：优先 planTaskStore 实时数据，
 *      缺失回退块快照，不累加历史快照），统计 status ∈ {pending, in_progress} 的任务数 > 0；
 *   ② 当前会话尚无进行中的 PDCA 编排 —— 直接复用 usePdcaEntry().visible === false。
 *
 * 动作：复用**既有** HTTP 调用点 `pdcaService.start(description, sessionId)`
 * （`services/planService.ts` → POST /v1/pdca/start，参数 description + sessionId 与
 * 后端 handlePdcaStart 契约一致）。成功后的进度刷新完全依赖既有 pdca:* SSE 链路
 * （orchestrationStore 订阅 → usePdcaEntry / usePdcaAutoAppend 消费），不新建轮询。
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import { usePlanTaskStore } from "../../stores/planTaskStore";
import { useSessionStore } from "../../stores/sessionStore";
import { pdcaService } from "../../services/planService";
import { toastWarning } from "../../stores/toastStore";
import type { TaskCardTask } from "../../types";
import { findLatestTaskCard } from "./taskCardSnapshot";
import { usePdcaEntry } from "./usePdcaEntry";

/** 未完成状态集合（状态量枚举判定；对应 TaskCardTask["status"]） */
const UNFINISHED_STATUSES: ReadonlySet<TaskCardTask["status"]> = new Set([
  "pending",
  "in_progress",
]);

export function usePdcaStartEntry(): {
  visible: boolean;
  count: number;
  starting: boolean;
  start: () => void;
} {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const planTasks = usePlanTaskStore((s) => s.tasks);
  const sessionId = useSessionStore((s) => s.currentSession?.id);
  // 既有判据：当前会话是否存在进行中的 PDCA 编排
  const pdca = usePdcaEntry();
  const [starting, setStarting] = useState(false);

  const card = useMemo(
    () => findLatestTaskCard(messages, planTasks),
    [messages, planTasks],
  );
  const unfinished = useMemo(
    () =>
      (card?.tasks ?? []).filter((task) =>
        UNFINISHED_STATUSES.has(task.status),
      ),
    [card],
  );

  const start = useCallback(() => {
    if (!sessionId || starting || unfinished.length === 0) return;
    // 描述取自真实状态（任务卡标题 + 未完成任务名），不使用任何示例/假数据
    const description = [
      card?.title?.trim() ?? "",
      unfinished
        .map((task) => task.name)
        .filter(Boolean)
        .join("；"),
    ]
      .filter(Boolean)
      .join("：");
    if (!description) return;

    setStarting(true);
    void pdcaService.start(description, sessionId).then((taskId) => {
      setStarting(false);
      if (!taskId) toastWarning(t("chat.pdcaStartFailed"));
    });
  }, [sessionId, starting, unfinished, card, t]);

  return {
    visible: unfinished.length > 0 && !pdca.visible,
    count: unfinished.length,
    starting,
    start,
  };
}
