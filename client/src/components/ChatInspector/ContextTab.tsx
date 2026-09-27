/**
 * 上下文 Tab — 上下文窗口可视化 + 系统提示词（只读）+ 会话统计
 *
 * 上分区：上下文窗口进度条 + 系统提示词（只读）
 * 下分区：消息摘要（点击跳转）+ 会话统计
 */

import React from "react";
import { useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Message } from "../../types";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessionStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { useContextWatermarkStore } from "../../stores/contextWatermarkStore";
import { useModelStore } from "../../stores/modelStore";

// ─── 工具函数 ─────────────────────────────────────

/** 默认上下文窗口大小（模型未加载时使用，与后端 ContextWindowResolver 一致） */
const DEFAULT_CONTEXT = 200_000;

/**
 * "会产出文件"的工具名集合 — 用于结构化统计文件数 (CS02)。
 *
 * 语义说明（2026-09-26，与后端 `WRITE_TOOLS` 系列的命名对齐）：本集合**不是**后端那个
 * "文件写类"（`file_write` / `file_edit`，语义 = 按文件读写配对 / 写类判定），而是**产物类** ——
 * 凡会写出、生成、转换出文件的工具都算（含 `image_generate` / `pdf` / `tts` 等生成类）。
 * 11 项均已核对为**本仓真实注册名**（`src/tools/**`，含 `utility-io-tools.ts` 的对象字面量声明）
 * ⇒ 与后端同名集合**取值不同属预期**、非漂移；此处改名以消除"同名不同义"的误读。
 */
const FILE_PRODUCING_TOOLS = new Set([
  "file_write",
  "file_edit",
  "file_copy",
  "temp_file",
  "file_convert",
  "image_generate",
  "image_svg_generate",
  "video_generate",
  "pdf",
  "tts",
  "update_soul_or_user",
]);

/** 从消息列表聚合 Token 用量 */
function aggregateTokens(messages: Message[]) {
  let totalInput = 0;
  let totalOutput = 0;
  let estimatedCost = 0;
  let cacheRead = 0;

  for (const msg of messages) {
    if (msg.usage) {
      totalInput += msg.usage.inputTokens || 0;
      totalOutput += msg.usage.outputTokens || 0;
      estimatedCost += msg.usage.estimatedCostUsd || 0;
      cacheRead += msg.usage.cacheReadTokens || 0;
    }
  }

  return {
    totalTokens: totalInput + totalOutput,
    totalInput,
    totalOutput,
    estimatedCost,
    cacheRead,
  };
}

/** 生成消息轮次摘要（合并 user+assistant 为一轮）
 *  仅处理最近 MAX_ROUNDS 轮，避免大会话卡主线程 */
function buildRoundSummaries(
  messages: Message[],
  t: TFunction,
): Array<{
  roundIndex: number;
  userMsg: string;
  userMsgId: string;
  assistantMsg: string;
  timestamp: number;
}> {
  const MAX_ROUNDS = 50;
  const rounds: Array<{
    roundIndex: number;
    userMsg: string;
    userMsgId: string;
    assistantMsg: string;
    timestamp: number;
  }> = [];
  let currentRound: {
    userMsg: string;
    userMsgId: string;
    assistantMsg: string;
    timestamp: number;
  } | null = null;

  // 从尾部往前取最近的消息，构建轮次摘要
  const recentMessages = messages.slice(-MAX_ROUNDS * 2); // 每轮约 2 条(user+assistant)
  for (const msg of recentMessages) {
    const content = msg.content || "";
    if (msg.role === "user") {
      if (currentRound) {
        rounds.push({ ...currentRound, roundIndex: rounds.length + 1 });
      }
      currentRound = {
        userMsg:
          content.slice(0, 60).replace(/\n/g, " ") ||
          t("chatInspector.userMessageFallback"),
        userMsgId: msg.id,
        assistantMsg: "",
        timestamp: msg.timestamp,
      };
    } else if (msg.role === "assistant" && currentRound) {
      const textBlocks =
        msg.blocks
          ?.filter((b) => b.type === "text")
          .map((b) => b.content)
          .join(" ") || content;
      currentRound.assistantMsg =
        textBlocks.slice(0, 60).replace(/\n/g, " ") ||
        t("chatInspector.aiReplyFallback");
    }
  }

  if (currentRound) {
    rounds.push({ ...currentRound, roundIndex: rounds.length + 1 });
  }

  return rounds;
}

// ─── 子组件 ───────────────────────────────────────

function ContextWindowBarImpl({
  used,
  contextLength,
  percentage,
  totalInput,
  totalOutput,
  cacheRead,
  severity,
  isStreaming,
  realTimeTokens,
}: {
  used: number;
  contextLength: number;
  percentage: number;
  totalInput: number;
  totalOutput: number;
  cacheRead: number;
  severity?: "normal" | "warn" | "compact";
  isStreaming?: boolean;
  realTimeTokens?: number;
}) {
  const { t } = useTranslation();
  const barColor =
    severity === "compact"
      ? "bg-red-500"
      : severity === "warn"
        ? "bg-yellow-500"
        : percentage > 80
          ? "bg-red-500"
          : percentage > 50
            ? "bg-yellow-500"
            : "bg-blue-500";

  const pulseClass = severity === "compact" ? "animate-pulse" : "";

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {t("chatInspector.contextWindow")}
        {isStreaming && realTimeTokens !== undefined && (
          <span className="ml-1 text-blue-500 dark:text-blue-400 text-[10px] font-normal">
            {t("common.realtime")}
          </span>
        )}
        {severity === "warn" && (
          <span className="ml-1 text-yellow-500 text-[10px]">
            {t("chatInspector.contextHigh")}
          </span>
        )}
        {severity === "compact" && (
          <span className="ml-1 text-red-500 text-[10px] animate-pulse">
            {t("chatInspector.contextCritical")}
          </span>
        )}
      </h4>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
        <div
          className={`${barColor} h-2.5 rounded-full transition-all duration-500 ${pulseClass}`}
          style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%` }}
        />
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        {used > contextLength ? (
          <span className="text-red-500 font-medium">
            {t("chatInspector.overLimit", {
              used: used.toLocaleString(),
              limit: contextLength.toLocaleString(),
            })}
          </span>
        ) : (
          <>
            {used.toLocaleString()} / {contextLength.toLocaleString()} tokens
          </>
        )}
        <span
          className={`ml-2 font-medium ${used > contextLength ? "text-red-500" : percentage > 80 || severity === "compact" ? "text-red-500" : percentage > 50 ? "text-yellow-500" : ""}`}
        >
          ({percentage.toFixed(1)}%)
        </span>
        {isStreaming && realTimeTokens !== undefined && realTimeTokens > 0 && (
          <span className="ml-2 text-blue-500 dark:text-blue-400 text-[10px]">
            {t("chatInspector.realtimeTokens", {
              tokens: realTimeTokens.toLocaleString(),
            })}
          </span>
        )}
      </p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-gray-400">{t("chatInspector.input")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {totalInput.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-gray-400">{t("chatInspector.output")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {totalOutput.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-gray-400">{t("chatInspector.cacheRead")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {cacheRead.toLocaleString()}
            {cacheRead > 0 && (
              <span className="text-green-500 ml-0.5">
                ({Math.round((cacheRead / Math.max(totalInput, 1)) * 100)}%)
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
const ContextWindowBar = React.memo(ContextWindowBarImpl);

function MessageSummaryListImpl({
  rounds,
  streaming,
  onRoundClick,
}: {
  rounds: ReturnType<typeof buildRoundSummaries>;
  streaming: boolean;
  onRoundClick: (userMsgId: string) => void;
}) {
  const { t } = useTranslation();
  if (rounds.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {t("chatInspector.messageSummary")}
        <span className="ml-1 text-gray-400">
          {t("chatInspector.clickToJump")}
        </span>
      </h4>
      <div className="space-y-1">
        {rounds.map((round) => (
          <button
            key={round.roundIndex}
            onClick={() => onRoundClick(round.userMsgId)}
            className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span className="text-gray-400 mr-1.5">#{round.roundIndex}</span>
            <span className="text-gray-600 dark:text-gray-300 truncate">
              {round.userMsg}
            </span>
            {!round.assistantMsg &&
              streaming &&
              rounds.indexOf(round) === rounds.length - 1 && (
                <span className="text-blue-500 ml-1">
                  {t("chatInspector.inProgressEllipsis")}
                </span>
              )}
          </button>
        ))}
      </div>
    </div>
  );
}
const MessageSummaryList = React.memo(MessageSummaryListImpl);

function SessionStatsImpl({
  roundCount,
  messageCount,
  toolCallCount,
  fileCount,
  estimatedCost,
  createdAt,
}: {
  roundCount: number;
  messageCount: number;
  toolCallCount: number;
  fileCount: number;
  estimatedCost: number;
  createdAt: string;
}) {
  const { t } = useTranslation();
  const createdTime = useMemo(() => {
    try {
      return new Date(createdAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "--";
    }
  }, [createdAt]);

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {t("chatInspector.sessionStats")}
      </h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">{t("chatInspector.createdAt")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {createdTime}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">{t("chatInspector.rounds")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {roundCount}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">{t("chatInspector.messages")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {messageCount}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">{t("chatInspector.toolCalls")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {toolCallCount}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">{t("chatInspector.files")}</span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {fileCount}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
          <span className="text-gray-400">
            {t("chatInspector.estimatedCost")}
          </span>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            ${estimatedCost.toFixed(4)}
          </p>
        </div>
      </div>
    </div>
  );
}
const SessionStats = React.memo(SessionStatsImpl);

// ─── 主组件 ───────────────────────────────────────

function ContextTab() {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages) || [];
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSession = useSessionStore((s) => s.currentSession);
  const currentModelName = useModelSwitchStore((s) => s.currentModelName);
  const setActiveTab = useChatInspectorStore((s) => s.setActiveTab);
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );
  const setTokenWarning = useChatInspectorStore((s) => s.setTokenWarning);
  const watermark = useContextWatermarkStore((s) => s.watermark);
  const models = useModelStore((s) => s.models);

  // 从模型列表获取当前模型的实际上下文窗口（非流式时使用）
  const modelContextLength = useMemo(() => {
    if (!currentModelName) return DEFAULT_CONTEXT;
    // 精确匹配 → 模糊匹配（模型名可能有路径前缀如 /models/xxx）
    const found =
      models.find(
        (m) => m.modelId === currentModelName || m.name === currentModelName,
      ) ??
      models.find(
        (m) =>
          m.modelId?.includes(currentModelName) ||
          m.name?.includes(currentModelName),
      );
    return found?.context_length || DEFAULT_CONTEXT;
  }, [currentModelName, models]);

  // 实时水位数据 → tokenWarning 角标同步
  useEffect(() => {
    if (watermark && watermark.severity !== "normal") {
      setTokenWarning(true);
    } else if (!watermark || watermark.severity === "normal") {
      setTokenWarning(false);
    }
  }, [watermark?.severity, watermark?.ratio, setTokenWarning]);

  const tokenStats = useMemo(
    () => aggregateTokens(messages),
    [messages.length, messages[messages.length - 1]?.usage],
  );

  // 流式输出中：融合实时水位数据与历史累积
  // 非流式：保持原有行为（消息 usage 聚合）
  const hasRealtime = isStreaming && watermark && watermark.currentTokens > 0;
  const usedTokens = hasRealtime
    ? Math.max(watermark.currentTokens, tokenStats.totalTokens)
    : tokenStats.totalTokens;
  const contextLength = hasRealtime
    ? watermark.contextLimit
    : modelContextLength;
  const percentage =
    contextLength > 0 ? Math.min((usedTokens / contextLength) * 100, 100) : 0;
  const realTimeSeverity = hasRealtime ? watermark.severity : undefined;
  const realTimeTokens = hasRealtime ? watermark.currentTokens : undefined;

  const rounds = useMemo(() => buildRoundSummaries(messages, t), [messages, t]);

  // 提取系统提示词（从第一条 system 消息）
  const systemPromptText = useMemo(() => {
    const sysMsg = messages.find((m) => m.role === "system");
    return sysMsg?.content || "";
  }, [messages]);

  const toolCallCount = useMemo(
    () =>
      messages.filter((m) => m.role === "tool" || m.tool_calls?.length).length,
    [messages.length],
  );

  // 基于 blocks 结构化数据统计文件操作数 (CS02)
  // deliverable 块有 files[] 数组，diff 块有 file 字段，tool_call 块按工具名判断
  const fileCount = useMemo(
    () =>
      messages.filter((m) => {
        if (m.role !== "assistant") return false;
        return m.blocks?.some((b) => {
          if (b.type === "deliverable" && b.deliverableData?.files?.length)
            return true;
          if (b.type === "diff" && b.diffData?.file) return true;
          if (
            b.type === "tool_call" &&
            b.toolCall?.name &&
            FILE_PRODUCING_TOOLS.has(b.toolCall.name)
          )
            return true;
          return false;
        });
      }).length,
    [messages.length],
  );

  // 跳转到对应轮次：设置 highlightedRoundId 触发 ChatArea 滚动
  const handleRoundClick = (userMsgId: string) => {
    setHighlightedRoundId(userMsgId);
  };

  // 复制系统提示词
  const handleCopySystemPrompt = () => {
    if (systemPromptText) {
      navigator.clipboard.writeText(systemPromptText).catch(() => {});
    }
  };

  // 前往设置 Tab
  const handleGoToSettings = () => {
    setActiveTab("settings");
  };

  // 空状态
  if (messages.length === 0) {
    const hasModel = currentModelName && currentModelName !== "";
    return (
      <div className="p-3 space-y-4">
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          <p className="mb-2">
            {hasModel
              ? t("chatInspector.startFirstChat")
              : t("chatInspector.selectModelHint")}
          </p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div
              className="bg-blue-500 h-2.5 rounded-full"
              style={{ width: "0%" }}
            />
          </div>
          <p className="mt-1 text-xs">
            0 / {contextLength.toLocaleString()} tokens
          </p>
          {!hasModel && (
            <p className="mt-3 text-xs text-gray-400">
              {t("chatInspector.pressKey")}{" "}
              <kbd className="px-1 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">
                Ctrl+M
              </kbd>{" "}
              {t("chatInspector.openModelPanelHint")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      <ContextWindowBar
        used={usedTokens}
        contextLength={contextLength}
        percentage={percentage}
        totalInput={tokenStats.totalInput}
        totalOutput={tokenStats.totalOutput}
        cacheRead={tokenStats.cacheRead}
        severity={realTimeSeverity}
        isStreaming={isStreaming}
        realTimeTokens={realTimeTokens}
      />
      <hr className="border-gray-200 dark:border-gray-700" />

      {/* 系统提示词（只读） */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t("chatInspector.systemPrompt")}
          <span className="ml-1 text-gray-400 text-[10px] font-normal">
            {t("chatInspector.readOnly")}
          </span>
        </h4>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 whitespace-pre-wrap">
            {systemPromptText || t("chatInspector.noSystemPrompt")}
          </p>
        </div>
        <div className="flex gap-2">
          {systemPromptText && (
            <button
              onClick={handleCopySystemPrompt}
              className="text-xs text-gray-500 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
              title={t("chatInspector.copySystemPrompt")}
            >
              {t("common.copy")}
            </button>
          )}
          <button
            onClick={handleGoToSettings}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 underline transition-colors"
          >
            {t("chatInspector.goEditSettings")}
          </button>
        </div>
      </div>
      <hr className="border-gray-200 dark:border-gray-700" />

      <MessageSummaryList
        rounds={rounds}
        streaming={isStreaming}
        onRoundClick={handleRoundClick}
      />
      <hr className="border-gray-200 dark:border-gray-700" />
      <SessionStats
        roundCount={currentSession?.roundCount || rounds.length}
        messageCount={currentSession?.messageCount || messages.length}
        toolCallCount={toolCallCount}
        fileCount={fileCount}
        estimatedCost={tokenStats.estimatedCost}
        createdAt={currentSession?.createdAt || new Date().toISOString()}
      />
    </div>
  );
}

export default React.memo(ContextTab);
