/**
 * YieldNoticeBar —— N-45（2026-09-20）：会话级"已让出 / 等待结算"提示条。
 *
 * 数据来自 `GET /v1/sessions/:id/streaming` 的 `yieldState`（后端**读时派生**）：
 * - `'waiting'`：本轮以 `sessions_yield` 让出，仍在等待子任务结算（后端子代理 run 存活）
 * - `'unresolved'`：已让出但未能自动恢复（应用重启 / 结算丢失）⇒ 明确告知用户，避免静默
 *
 * **为什么是会话级而不是挂在消息上**（两轮 UI 实测结论）：真实让出轮次的派生消息只有
 * `[user, tool]`（该轮无正文 ⇒ 不产出助手条目），而前端 store 会把"没有 assistant 可回填的
 * tool 消息"整体丢弃 ⇒ 任何挂在消息上的状态都会随消息一起消失（详见台账 N-48）。
 *
 * 刷新时机：会话切换 + `isStreaming` 变化 —— 让出会结束本轮流；续跑完成后流再次结束。
 */
import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chat";
import { getSessionRuntimeStatus } from "../../services/sessionService";
import { handleClientError } from "../../utils/handleError";

type YieldState = "waiting" | "unresolved";

const YIELD_HINTS: Record<YieldState, string> = {
  waiting: "本轮已让出，正在等待子任务完成后自动继续…",
  unresolved:
    "本轮已让出，但未能自动恢复（可能因应用重启或子任务结算丢失）。直接发送消息即可继续。",
};

interface YieldNoticeBarProps {
  fluid?: boolean;
}

function YieldNoticeBar({ fluid }: YieldNoticeBarProps) {
  const session = useSessionStore((s) => s.currentSession);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [yieldState, setYieldState] = useState<YieldState | undefined>(
    undefined,
  );

  const sessionId = session?.id;

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setYieldState(undefined);
      return;
    }
    void getSessionRuntimeStatus(sessionId)
      .then((status) => {
        if (!cancelled) setYieldState(status.yieldState);
      })
      .catch((e) => {
        if (!cancelled) setYieldState(undefined);
        handleClientError(e, {
          module: "components:chat:YieldNoticeBar",
          action: "getSessionRuntimeStatus",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, isStreaming]);

  if (!yieldState) return null;

  const unresolved = yieldState === "unresolved";
  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div
          className={`flex items-start gap-2 px-4 py-2 rounded-xl border text-xs ${
            unresolved
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
              : "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400"
          }`}
        >
          <span className="text-sm shrink-0 leading-5">
            {unresolved ? "⚠️" : "⏳"}
          </span>
          <span className="flex-1 min-w-0 leading-5">
            {YIELD_HINTS[yieldState]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default YieldNoticeBar;
