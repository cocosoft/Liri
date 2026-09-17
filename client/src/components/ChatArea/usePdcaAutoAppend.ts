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
 * usePdcaAutoAppend — P2-A（2026-09-17）：PDCA 自动启动 → 聊天正文内嵌卡片（当前轮实时出现）。
 *
 * 后端在自动启动点以 assistant/pdca_workflow 事件持久化快照（重开回放还原）；但因
 * 该点位于消息流收尾、无法 yield 进响应体，当前轮的"即时出现"由前端在此完成：订阅
 * orchestrationStore 的 pdca:auto_launched，把 pdca_workflow 块 append 到该会话
 * 最后一条 assistant 消息（仅内存、幂等：同一事件 time 只 append 一次；已含
 * pdca_workflow 块则跳过，避免双卡）。数据来自真实 pdca:auto_launched 载荷（CS04）。
 */
import { useEffect, useRef } from "react";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useChatStore } from "@/stores/chat";
import type { PdcaWorkflowProgressData } from "@/types/message";
import { generateBlockId } from "@/stores/chat/chat-toolcall.slice";
import { AUTO_LAUNCHED_TYPE, findLatestEvent } from "./PdcaActivityStrip";

/** 从 auto_launched 载荷构建快照数据（镜像后端 _persistPdcaSnapshot 语义） */
function snapshotFromEvent(data?: Record<string, unknown>): PdcaWorkflowProgressData {
  const decision = (data?.decision as "pdl" | "stage-chain" | "research") ?? "stage-chain";
  const message = (data?.message as string | undefined) ?? "";
  return {
    decision,
    message,
    stage: "plan",
    status: "started",
    ...(data?.projectId ? { projectId: data.projectId as string } : {}),
    ...(Array.isArray(data?.reasons)
      ? { reasons: data.reasons as string[] }
      : {}),
  };
}

/**
 * 当前会话收到 pdca:auto_launched 时，把 pdca_workflow 块追加到最后一条 assistant 消息。
 */
export function usePdcaAutoAppend(sessionId: string | undefined): void {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const handledTime = useRef<number | null>(null);

  const autoEvent = sessionId
    ? findLatestEvent(timeline, latest, sessionId, [AUTO_LAUNCHED_TYPE])
    : null;

  useEffect(() => {
    if (!autoEvent || !sessionId) return;
    if (handledTime.current === autoEvent.time) return;
    handledTime.current = autoEvent.time;

    const { messages } = useChatStore.getState();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      if ((m.blocks ?? []).some((b) => b.type === "pdca_workflow")) break; // 已含卡，跳过
      const snap = snapshotFromEvent(autoEvent.data);
      const newBlock = {
        id: generateBlockId(),
        type: "pdca_workflow" as const,
        content: snap.message,
        pdcaWorkflowData: snap,
        isStreaming: false,
      };
      useChatStore.setState((s) => ({
        messages: s.messages.map((x) =>
          x.id === m.id ? { ...x, blocks: [...(x.blocks ?? []), newBlock] } : x,
        ),
      }));
      break;
    }
  }, [autoEvent, sessionId]);
}