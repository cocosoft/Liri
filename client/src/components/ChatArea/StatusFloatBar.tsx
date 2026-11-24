import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import { usePlanTaskStore } from "../../stores/planTaskStore";
// UI 期 UI-1（2026-09-23 修复计划 §十）：深度思考等待期的共享判定（原 DeepThinkingHint 组件）
import {
  useThinkingPhase,
  DEEP_THINKING_THRESHOLD_SECONDS,
} from "./useThinkingPhase";
import type { TaskCardData } from "../../types";
// 2026-09-25：任务卡快照取数抽为**单一来源**（本组件与 usePdcaStartEntry 共用）
import { findLatestTaskCard } from "./taskCardSnapshot";
// 2026-11-21（P2-1）：未完成判据与「用编排推进」入口同源（CS01 不另立状态集合）
import { UNFINISHED_TASK_STATUSES } from "./usePdcaStartEntry";
// 等待态可见性（2026-09-27 Spec `wait-state-visibility.md` D5/D6）：等待态并入浮动栏
import type { WaitState } from "./useWaitState";
// 2026-11-18（用户反馈「看不出你在运行，以为挂了」）：运行秒表 + 后端心跳年龄 + 停滞判定
import { useRunClock } from "../../hooks/useRunClock";
// 2026-11-13：等待审批是会话级状态（审批卡 / 工具卡 / 收尾标记三处信号，结构化判定）
import {
  collectApprovalInboxIds,
  hasPendingApproval,
} from "../../stores/chat/chat-message-shared";
// 2026-11-24（批次 5 / C2）：任务状态图标/颜色的单一事实源
import { getTaskStatusStyle } from "../../constants/taskStatus";

const PHASE_LABELS: Record<string, string> = {
  analyzing: "chat.phaseAnalyzing",
  designing: "chat.phaseDesigning",
  implementing: "chat.phaseImplementing",
  verifying: "chat.phaseVerifying",
  presenting: "chat.phasePresenting",
};

/** 2026-11-24（批次 5 / C2）：状态图标/颜色收敛到 `constants/taskStatus`（含 skipped） */

/**
 * 任务进度显示组件
 */
function TaskProgress({ data }: { data: TaskCardData }) {
  const { t } = useTranslation();
  const total = data.tasks.length;
  const completed = data.tasks.filter((t) => t.status === "completed").length;
  const failed = data.tasks.filter((t) => t.status === "failed").length;

  if (total === 0) return null;

  return (
    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
      {t("chat.taskProgressCompleted", { completed, total })}
      {failed > 0 && (
        <span className="text-red-500 ml-1">
          | {t("chat.taskProgressFailed", { count: failed })}
        </span>
      )}
    </span>
  );
}

/**
 * 任务进度 Mini 面板（点击展开）
 */
function TaskMiniPanel({
  data,
  onClose,
  fluid,
}: {
  data: TaskCardData;
  onClose: () => void;
  fluid?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute bottom-full left-0 right-0 px-3 pb-1"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {data.title}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label={t("chat.collapse")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            </button>
          </div>

          {data.tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              {(() => {
                const style = getTaskStatusStyle(task.status);
                return (
                  <span className={`${style.color} font-mono w-4 text-center`}>
                    {style.icon}
                  </span>
                );
              })()}
              <span className="text-gray-600 dark:text-gray-300 flex-1 truncate">
                {task.name}
              </span>
              {task.status === "failed" && task.result && (
                <span
                  className="text-red-400 truncate max-w-[120px]"
                  title={task.result}
                >
                  {task.result}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 运行状态浮动面板（增强版）
 *
 * 浮于 ChatArea 消息列表与 ChatInput 输入区之间，展示当前会话的运行状态。
 * - 运行中：绿色脉冲点 + 状态描述文本 + 任务进度
 * - 空闲：不渲染
 * - 执行阶段：读取 executionPhase，优先显示阶段文本
 * - 任务进度：从最后一条 assistant 消息的 todo 块中提取，显示完成数/总数
 * - 点击任务进度可展开 Mini 面板查看具体任务状态
 */
export default function StatusFloatBar({
  fluid = false,
  sessionId,
  pdca,
  orchestrate,
  wait,
}: {
  fluid?: boolean;
  /** 当前会话 id —— 心跳按会话分键（多会话并行时不得用别的会话的心跳作证） */
  sessionId?: string;
  /** UI-2（2026-09-23）：PDCA 编排徽标（可见性/展开态由 ChatArea 与 usePdcaEntry 提供） */
  pdca?: { visible: boolean; open: boolean; onToggle: () => void };
  /** 「用编排推进（启动 PDCA）」入口（判据/动作由 ChatArea 与 usePdcaStartEntry 提供）：
   *  仅"存在未完成 todo 且尚无进行中 PDCA"时可见，与徽标互斥 */
  orchestrate?: {
    visible: boolean;
    count: number;
    starting: boolean;
    onStart: () => void;
  };
  /** 等待态可见性（2026-09-27）：会话级等待态 —— 由 ChatArea 的 `useWaitState` **统一提供**
   *  （单一拉取点；避免本组件与 YieldNoticeBar 各自轮询）。详见 `useWaitState.ts`。 */
  wait?: WaitState;
}) {
  const { t } = useTranslation();
  // UI-1（2026-09-23）：深度思考等待期 —— 与"正在生成/阶段"在**同一处**呈现，
  // 不再单独占输入框上方一行（用户诉求：零碎信息统一到浮动栏）
  const { phase: thinkingPhase, seconds: thinkingSeconds } = useThinkingPhase();
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isUploading = useChatStore((s) => s.isUploading);
  const streamingStatus = useChatStore((s) => s.streamingStatus);
  const executionPhase = useChatStore((s) => s.executionPhase);
  const messages = useChatStore((s) => s.messages);
  const stopMessage = useChatStore((s) => s.stopMessage);
  // 2026-11-21（P2-1）：一键「让助手收尾」复用既有发送链路（不伪造 todo 状态）
  const sendMessage = useChatStore((s) => s.sendMessage);
  // 2026-11-18：只读接入后台正在运行的这一轮（Spec `.trae/specs/stream-attach.md` §6）
  const attachSessionStream = useChatStore((s) => s.attachSessionStream);

  const [showTaskPanel, setShowTaskPanel] = useState(false);

  const isActive = isSending || isStreaming || isUploading;
  /**
   * 等待态可见性（2026-09-27 Spec D5/D6）：等待期**保持渲染**（只换文案）——
   * 原判据只有"有字节在流动"（isSending/isStreaming/isUploading），故流一停、哪怕后台
   * 仍在等（长等待/自唤醒），状态条就卸载 ⇒ 界面退回"答完了"的样子（用户实测现象）。
   * 等待态是**已确认在等**（后端 `yieldState='waiting'` 或 `pendingWake`），故并入"保持可见"。
   */
  const isWaiting = wait?.waiting === true;
  /**
   * 2026-11-18（Run HUD）：后端报告本会话仍在运行，但本页面没接入该流
   * （刷新 / 切走再回来）。此前这种情形直接卸载浮动栏 ⇒ 界面退回"答完了"的样子。
   */
  const remoteStreaming = wait?.remoteStreaming === true;
  /**
   * 2026-11-13：等待审批 ≠ 已完成。此前浮动栏只看"有没有字节在流"，审批暂停时卸载或
   * 继续显示「已完成 x/y」⇒ 用户读到"任务结束了"。审批期间保持渲染并改文案。
   */
  const pendingApproval = useMemo(
    () => hasPendingApproval(messages),
    [messages],
  );
  /**
   * 2026-11-24：本会话已落定的审批数 —— >0 时说明当前待审批是**又一张新卡**
   * （批准后模型继续执行会继续申请），用它区分文案，避免误读成"上一张没生效"。
   * selector 返回原始值 ⇒ 流式 chunk 不会造成本组件额外重渲染。
   */
  const resolvedApprovalCount = useMemo(
    () => collectApprovalInboxIds(messages).resolved.size,
    [messages],
  );
  const keepVisible =
    isActive || isWaiting || pendingApproval || remoteStreaming;
  /**
   * 2026-11-18（Run HUD）：运行秒表 + 后端心跳年龄。
   * 原状态条只有一句静态「AI 正在生成回复」—— 一个字不变的 UI 和真死掉的 UI
   * 在屏幕上长得一样（用户原话："我以为你挂了"）。这里给出可核对的时间证据，
   * 并在心跳静默超阈值时显式切到「可能已断」而不是继续假装正常。
   */
  const runClock = useRunClock(sessionId);
  const [fadingOut, setFadingOut] = useState(false);

  /**
   * keepVisible 从 true → false 时渐隐：先 `opacity-0`（1s 过渡），2s 后置回 `fadingOut=false`
   * 让末尾 `if (!keepVisible && !fadingOut) return null` 生效、组件真正卸载。
   *
   * N-49 根因修复（2026-09-20）：本 effect 原先依赖 `[isActive, fadingOut]` —— 进入渐隐
   * （`fadingOut` 被置 true）会**重跑 effect**，而它的 cleanup 会把刚设好的 2 秒定时器清掉
   * ⇒ `fadingOut` **永久为 true** ⇒ 组件**永不卸载**：以 `opacity-0` 常驻 DOM（仍订阅 store、
   * 仍占位、仍可拦截指针事件，并曾让两次浏览器验证误判为"状态条仍在显示"）。
   * 故改为**只依赖 `keepVisible`**：cleanup 只在可见态切换时清定时器，不再自清。
   */
  useEffect(() => {
    if (keepVisible) {
      setFadingOut(false);
      return;
    }
    setFadingOut(true);
    const timer = setTimeout(() => setFadingOut(false), 2000);
    return () => clearTimeout(timer);
  }, [keepVisible]);

  // BUG-9 修复（2026-08-23）：从 planTaskStore 订阅实时任务数据（SSE 驱动），
  // 与 TaskCard 组件同源；按消息中最后一个 planId 定位并优先取实时数据
  const planTasks = usePlanTaskStore((s) => s.tasks);
  const taskCard = useMemo(
    () => findLatestTaskCard(messages, planTasks),
    [messages, planTasks],
  );

  /**
   * 2026-11-21（P2-1）：回合已结束但进度仍是「x/y」⇒ 显式提示「进度未收尾」。
   *
   * 只提供**用户确认后的一次收尾请求**（发送一条指令给助手，由模型按真实情况更新 todo）；
   * 后端/前端都**不**自动把 `in_progress` 改成 `completed`（D4：不伪造状态）。
   */
  const unfinishedCount = useMemo(
    () =>
      (taskCard?.tasks ?? []).filter((task) =>
        UNFINISHED_TASK_STATUSES.has(task.status),
      ).length,
    [taskCard],
  );
  const [finalizing, setFinalizing] = useState(false);
  const showTodoFinalizeHint =
    unfinishedCount > 0 &&
    !isActive &&
    !isWaiting &&
    !pendingApproval &&
    !remoteStreaming &&
    !pdca?.visible &&
    !!sessionId;

  const requestTodoFinalize = () => {
    if (!sessionId || finalizing) return;
    setFinalizing(true);
    void sendMessage(t("chat.todoFinalizeNudge"), sessionId).finally(() =>
      setFinalizing(false),
    );
  };

  // UI-2（U2-a 裁决，2026-09-23）：有活跃 PDCA 事件时浮动栏**常驻** —— PDCA 任务可在
  // 流结束后继续跑，原 ChatPdcaDrawer 的独立入口行正为此而常驻；并入浮动栏后
  // 若仍只在 isActive 时渲染，会**丢失空闲态入口**（回归）。
  // 「用编排推进」入口同理：空闲且仍有未完成 todo 时常驻（否则入口无处可点）。
  // 等待态（2026-09-27）：等待期同样常驻 —— 见 `keepVisible` 注释。
  if (
    !keepVisible &&
    !fadingOut &&
    !pdca?.visible &&
    !orchestrate?.visible &&
    !showTodoFinalizeHint
  )
    return null;

  /**
   * 等待态文案（2026-09-27 Spec D7：**只报真实测量值**）
   * - selfwake 且带 `triggerAt`（`sleep_for`/`sleep_until`）⇒ 倒计时（唯一能算出的剩余量）；
   * - selfwake 无 `triggerAt`（`wake_on_job`/`wake_on_event`）⇒ 只说"等待中" + 已等待秒数，
   *   **不猜**剩余时间；
   * - yield（等子任务结算）⇒ 已等待秒数（结算时刻不可预测）。
   *
   * D（2026-11-19）：`triggerAt` 已过期超过一个 cron tick（60s）仍未被后端消费 ⇒ 倒计时恒为 0，
   * 属误导 ⇒ 降级为"等待已过期（后端尚未触发）"，只报已等待秒数。
   */
  const waitText = (): string => {
    const elapsed = wait?.seconds ?? 0;
    if (wait?.reason === "selfwake") {
      if (wait.overdue) {
        return t("chat.waitingSelfwakeOverdue", { seconds: elapsed });
      }
      if (typeof wait.triggerAt === "number") {
        const remain = Math.max(
          0,
          Math.round((wait.triggerAt - Date.now()) / 1000),
        );
        return t("chat.waitingSelfwakeCountdown", { seconds: remain });
      }
      return t("chat.waitingSelfwake", { seconds: elapsed });
    }
    return t("chat.waitingYield", { seconds: elapsed });
  };

  /**
   * 根据当前状态生成显示文本
   * 优先级：executionPhase > streamingStatus > 默认状态
   */
  const getStatusText = (): string => {
    /**
     * 2026-11-24（与工具组头口径一致）：审批等待优先于一切 —— 包括流式/阶段文案。
     * 此前该判断只在 `!isActive` 分支：流未结束时若有调用在等审批，浮动栏仍显示
     * 「AI 正在生成回复 / 实现中」，而工具组头已显示「⏳ 等待审批」⇒ 两处自相矛盾。
     */
    if (pendingApproval) {
      return resolvedApprovalCount > 0
        ? t("chat.taskPausedNew")
        : t("chat.taskPaused");
    }
    // UI-2：空闲但仍有活跃 PDCA ⇒ 以"编排进行中"常驻；不得沿用"正在生成"（会谎报运行态）
    if (!isActive) {
      // 等待态（2026-09-27）：**已确认在等**（后端 yieldState/pendingWake）⇒ 不得回落成
      // "正在生成 / 编排进行中"等谎报文案（原实现即因此显示成"答完了"）
      if (isWaiting) return waitText();
      // 2026-11-18：后端仍在跑、本页未接入 ⇒ 如实说明"在后台运行"，不谎报"已完成"
      if (remoteStreaming) return t("chat.remoteStreamingLabel");
      if (pdca?.visible) return t("chat.pdcaIdle");
      // 空闲且仅"用编排推进"入口常驻：左侧不谎报运行态也不与右侧入口文案重复，
      // 未完成进度由 TaskProgress（已完成 x/y）承担
      if (orchestrate?.visible) return "";
      /**
       * 2026-11-24：其余情形浮动栏只是为「进度未收尾」等右侧入口常驻（见渲染闸门），
       * 左侧没有运行状态可说 —— 原实现回落到「AI 正在生成回复」会谎报运行态。
       */
      return "";
    }
    if (runClock.stalled) {
      // 心跳静默超阈值（默认 90s）⇒ 直说"可能已断"，不得继续显示"正在生成"：
      // 继续显示正常文案正是用户被误导的来源。
      return t("chat.runStalled", {
        seconds: runClock.beatAgeSeconds ?? 0,
      });
    }
    if (isUploading) return t("chat.uploading");
    if (isSending && !isStreaming) return t("chat.sending");
    if (executionPhase?.phase) {
      const phaseLabel =
        t(PHASE_LABELS[executionPhase.phase]) || executionPhase.phase;
      return executionPhase.description
        ? `${phaseLabel} ${executionPhase.description}`
        : phaseLabel;
    }
    // UI-1（U1 裁决：executionPhase 优先，避免覆盖 PDCA 阶段）：深度思考等待期提示
    if (
      thinkingPhase === "thinking" &&
      thinkingSeconds >= DEEP_THINKING_THRESHOLD_SECONDS
    ) {
      return t("chat.deepThinkingHint", { seconds: thinkingSeconds });
    }
    if (streamingStatus) {
      // CS02：水位数据已全部走 `contextWatermarkStore` 的结构化字段
      // （chat-stream-chunk 的 context_state 分支），`streamingStatus` 不再承载水位文本，
      // 故不再对其做正则解析（判据必须落在结构化标记上）。
      return streamingStatus;
    }
    return t("chat.streamingLabel");
  };

  const statusText = getStatusText();

  return (
    <div className="w-full relative">
      <div
        className={`w-full px-3 transition-opacity duration-1000 ease-in-out ${fadingOut ? "opacity-0" : "opacity-100"}`}
        onClick={() => setShowTaskPanel(!showTaskPanel)}
      >
        <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            {/* 状态指示点：绿色脉冲 = 运行中；停滞 = 静态琥珀（不脉冲，不得谎报"仍在输出"）；
                等待中 / 后台运行（本页未接入）= 静态蓝点；等待审批 = 静态琥珀点；
                空闲但 PDCA 常驻时用静态灰点 */}
            <span className="relative flex h-2.5 w-2.5">
              {isActive && !runClock.stalled && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  runClock.stalled
                    ? "bg-amber-500"
                    : isActive
                      ? "bg-green-500"
                      : pendingApproval
                        ? "bg-amber-500"
                        : isWaiting
                          ? "bg-sky-500"
                          : remoteStreaming
                            ? "bg-sky-500"
                            : "bg-gray-400"
                }`}
              />
            </span>

            {/* 状态文本 + 任务进度 */}
            <div className="flex items-center flex-1 min-w-0">
              {statusText && (
                <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                  {statusText}
                </span>
              )}
              {/* 2026-11-18（Run HUD）：时间证据 —— 运行秒表 + 最后心跳年龄。
                  只显示真实测量值：没收到过心跳就不显示「N 秒前」（不猜）。 */}
              {isActive && (
                <span className="ml-2 shrink-0 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                  {t("chat.runElapsed", { seconds: runClock.elapsedSeconds })}
                  {runClock.beatAgeSeconds !== null && (
                    <span
                      className={
                        runClock.stalled
                          ? "text-amber-600 dark:text-amber-400"
                          : undefined
                      }
                    >
                      {" · "}
                      {t("chat.runBeatAge", {
                        seconds: runClock.beatAgeSeconds,
                      })}
                    </span>
                  )}
                </span>
              )}
              {/* 等待审批期间不展示「已完成 x/y」——它会被读成"任务结束" */}
              {taskCard && !pendingApproval && <TaskProgress data={taskCard} />}
              {/* 2026-11-21（P2-1）：回合结束但仍有未完成项 ⇒ 明确说「未收尾」 */}
              {showTodoFinalizeHint && (
                <span className="ml-2 shrink-0 text-xs text-amber-600 dark:text-amber-400">
                  {t("chat.todoUnfinished", { count: unfinishedCount })}
                </span>
              )}
            </div>

            {/* 2026-11-18：后端仍在跑、本页未接入 ⇒ 提供**只读**「接入」入口
                （接入只带回状态与后续帧；正文仍以落盘为准，不伪造连续输出） */}
            {remoteStreaming && sessionId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void attachSessionStream(sessionId);
                }}
                aria-label={t("chat.attachStreamCta")}
                title={t("chat.attachStreamHint")}
                className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
              >
                <span>⇥</span>
                <span>{t("chat.attachStreamCta")}</span>
              </button>
            )}

            {/* 「用编排推进」入口：存在未完成 todo 且尚无进行中 PDCA 时出现
                （与徽标互斥；stopPropagation 避免误触任务面板） */}
            {orchestrate?.visible && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  orchestrate.onStart();
                }}
                disabled={orchestrate.starting}
                aria-label={t("chat.pdcaSuggest")}
                title={t("chat.pdcaSuggestHint", { count: orchestrate.count })}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  orchestrate.starting
                    ? "text-gray-400 dark:text-gray-500 cursor-default"
                    : "text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                }`}
              >
                <span>🧭</span>
                <span className="truncate max-w-[12rem]">
                  {t("chat.pdcaSuggest")}
                </span>
              </button>
            )}

            {/* 2026-11-21（P2-1）：一键「让助手收尾」—— 发送一条收尾指令，由模型按真实
                情况更新 todo（不自动改状态；用户点击即确认） */}
            {showTodoFinalizeHint && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestTodoFinalize();
                }}
                disabled={finalizing}
                aria-label={t("chat.todoFinalize")}
                title={t("chat.todoFinalizeHint")}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  finalizing
                    ? "text-gray-400 dark:text-gray-500 cursor-default"
                    : "text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                }`}
              >
                <span>✓</span>
                <span className="truncate max-w-[8rem]">
                  {t("chat.todoFinalize")}
                </span>
              </button>
            )}

            {/* UI-2：PDCA 编排徽标（点击展开/收起；stopPropagation 避免误触任务面板） */}
            {pdca?.visible && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  pdca.onToggle();
                }}
                aria-expanded={pdca.open}
                aria-label={t("chat.pdcaBadge")}
                title={t("chat.pdcaBadgeHint")}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  pdca.open
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                <span>📊</span>
                <span>{t("chat.pdcaBadge")}</span>
              </button>
            )}

            {/* 任务进度展开指示 —— P2-5：由纯 svg 改为真按钮，
                键盘用户（Tab + Enter）也能展开/收起任务面板；鼠标仍可点整条浮动栏 */}
            {taskCard && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTaskPanel((v) => !v);
                }}
                aria-expanded={showTaskPanel}
                aria-label={t("chat.taskPanelToggle")}
                className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    showTaskPanel ? "rotate-180" : ""
                  }`}
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
            )}

            {/* 停止按钮：仅流式输出中显示 */}
            {isStreaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  stopMessage();
                }}
                aria-label={t("chat.stopReply")}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                title={t("chat.stopReply")}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                <span>{t("common.stop")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 展开的 Mini 面板 */}
      {showTaskPanel && taskCard && (
        <TaskMiniPanel
          data={taskCard}
          onClose={() => setShowTaskPanel(false)}
          fluid={fluid}
        />
      )}
    </div>
  );
}
