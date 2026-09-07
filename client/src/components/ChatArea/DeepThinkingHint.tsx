import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import type { Message } from "@/types";

/**
 * R3（走查 W3/W4）：超长思考期提示。
 *
 * 背景：SSE 流式中，推理模型（deepseek 等）先输出大量 thinking chunk，
 * 正文 text 可能在几十秒后才出现（实测首字节最高 76.8s）。
 * 若这段时间前端无任何"仍在工作"的反馈，用户会误判为"挂死"。
 *
 * 本组件判定"当前流式轮已开始收 thinking，但超过 N 秒仍无正文 text /
 * tool 事件"，在输入区上方显示轻提示；正文/工具事件到达或流结束即消失。
 *
 * 数据源仅为现有 chatStore（messages + isStreaming），不改 store schema、
 * 不新增网络/状态通道：以组件内 useRef 记录首个 thinking chunk 到达时间。
 *
 * 阶段判定（纯函数，扫描最后一条 assistant 消息的 blocks）：
 *   - idle:     未在流式 / 无当前 assistant 消息
 *   - pending:  流式中但尚未收到任何 thinking/text/tool 事件
 *   - thinking: 已收 thinking 但尚无正文(text)/工具(tool_call)事件 —— 深度思考等待期
 *   - content:  正文/工具事件已到达（thinking 期结束）
 * 渲染链路（M4）：thinking/text/tool_call 均由聚合器按事件派生为 blocks，
 * 与 processChunk 副作用解耦，故从消息 blocks 判定是可靠信号。
 */
type ThinkingPhase = "idle" | "pending" | "thinking" | "content";

/** 超过该时长仍无正文/工具事件 → 显示"深度思考中"提示 */
const DEEP_THINKING_THRESHOLD_SECONDS = 30;

function deriveThinkingPhase(
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

function DeepThinkingHint() {
  const { t } = useTranslation();
  // 字符串选择器：仅阶段翻转时重渲染（每 chunk 刷新但返回同一字符串）
  const phase = useChatStore((s) =>
    deriveThinkingPhase(s.isStreaming, s.messages),
  );
  const [seconds, setSeconds] = useState(0);
  /** 本轮首个 thinking chunk 的到达时间（组件内记录，不落 store） */
  const thinkingStartRef = useRef<number | null>(null);

  // 进入 thinking 期记下起始时间；离开（正文/工具到达/流结束）即清除
  useEffect(() => {
    if (phase === "thinking") {
      thinkingStartRef.current ??= Date.now();
    } else {
      thinkingStartRef.current = null;
    }
  }, [phase]);

  // thinking 等待期每秒刷新已等待秒数
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

  if (phase !== "thinking" || seconds < DEEP_THINKING_THRESHOLD_SECONDS) {
    return null;
  }

  return (
    <div className="flex justify-center px-4 pb-1">
      <div
        role="status"
        className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 dark:bg-gray-800/80 border border-gray-200/50 dark:border-gray-700/50 shadow-sm text-xs text-gray-600 dark:text-gray-300"
      >
        {t("chat.deepThinkingHint", { seconds })}
      </div>
    </div>
  );
}

export default DeepThinkingHint;
