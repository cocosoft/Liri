import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chat";
import type { Message } from "@/types";

/**
 * UI 期 UI-1（2026-09-23 修复计划 §十）：深度思考相位判定 + 已等待秒数（共享钩子）。
 *
 * 来源：原 `DeepThinkingHint` 组件（R3 走查 W3/W4）——判定逻辑**逐字迁移**，仅把
 * "独立提示药丸"改为供浮动栏 `StatusFloatBar` 复用的钩子，消除输入框上方的独立占行
 * （用户诉求：零碎信息统一到浮动栏显示，不要把输入区撑开）。
 *
 * 背景：SSE 流式中，推理模型先输出大量 thinking chunk，正文 text 可能几十秒后才出现
 * （实测首字节最高 76.8s）。这段"仍在工作但无正文"的窗口若不给反馈，用户会误判为挂死。
 *
 * 数据源仅为现有 chatStore（messages + isStreaming）：不改 store schema、不新增通道。
 *
 * 阶段判定（纯函数，扫描最后一条 assistant 消息的 blocks）：
 *   - idle:     未在流式 / 无当前 assistant 消息
 *   - pending:  流式中但尚未收到任何 thinking/text/tool 事件
 *   - thinking: 已收 thinking 但尚无正文(text)/工具(tool_call)事件 —— 深度思考等待期
 *   - content:  正文/工具事件已到达（thinking 期结束）
 * 渲染链路（M4）：thinking/text/tool_call 均由聚合器按事件派生为 blocks，
 * 与 processChunk 副作用解耦，故从消息 blocks 判定是可靠信号。
 */
export type ThinkingPhase = "idle" | "pending" | "thinking" | "content";

/** 超过该时长仍无正文/工具事件 → 视为「深度思考等待期」并需要向用户提示 */
export const DEEP_THINKING_THRESHOLD_SECONDS = 30;

/** 相位判定纯函数（可单测；不依赖 React） */
export function deriveThinkingPhase(
  isStreaming: boolean,
  messages: readonly Message[],
): ThinkingPhase {
  if (!isStreaming) return "idle";
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return "idle";
  let hasThinking = false;
  for (const block of last.blocks ?? []) {
    switch (block.type) {
      case "thinking":
        if ((block.content ?? "").trim()) hasThinking = true;
        break;
      case "text":
        // 正文到达（非空 delta）→ 思考期结束
        if ((block.content ?? "").trim()) return "content";
        break;
      // 工具/提问/成果块到达同样视为"已出正文阶段"，无需再提示
      case "tool_call":
      case "question":
      case "todo":
      case "code_run":
        return "content";
      default:
        break;
    }
  }
  if ((last.content ?? "").trim()) return "content";
  return hasThinking ? "thinking" : "pending";
}

/**
 * 订阅当前深度思考相位与已等待秒数。
 *
 * - 字符串选择器：仅相位翻转时重渲染（每 chunk 刷新但返回同一字符串）；
 * - 起始时间用 `useRef` 记录首个 thinking chunk 到达时刻，**不落 store**；
 * - 离开 thinking（正文/工具到达/流结束）即清除并归零。
 */
export function useThinkingPhase(): {
  phase: ThinkingPhase;
  seconds: number;
} {
  const phase = useChatStore((s) =>
    deriveThinkingPhase(s.isStreaming, s.messages),
  );
  const [seconds, setSeconds] = useState(0);
  const thinkingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase === "thinking") {
      thinkingStartRef.current ??= Date.now();
    } else {
      thinkingStartRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "thinking") {
      setSeconds(0);
      return;
    }
    const tick = () => {
      if (thinkingStartRef.current !== null) {
        setSeconds(Math.floor((Date.now() - thinkingStartRef.current) / 1000));
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  return { phase, seconds };
}
