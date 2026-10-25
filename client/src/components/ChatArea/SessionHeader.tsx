import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chat";
import { sessionService } from "../../services/sessionService";
import type { Message } from "../../types";
import { getMessageSearchText } from "../../utils/messageText";
import { decodeToolResultContent } from "../../utils/toolResultText";
import {
  balanceCodeFences,
  exportMessageAsFormat,
  triggerBlobDownload,
} from "../../utils/exportMessage";
import { handleClientError } from "../../utils/handleError";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import SessionTitle from "./SessionTitle";

/** 格式化日期为 yyyy-MM-dd HH:mm */
function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "-";
  }
}

/** P2-6（2026-09-27 审计）：`triggerBlobDownload` 收敛到 `utils/exportMessage`（唯一实现） */

/** 导出元信息（P1-3：导出件需自证来源） */
interface ExportMeta {
  id: string;
  title: string;
  exportedAt: string;
}

/**
 * 导出正文结构保护（P1-4，最小化）：正文里若出现与导出自身标记同形的
 * 角色标题行（`### 👤/🤖/⚙️/🛠 …`），会被误读为新的消息节 ⇒ 行首 `#` 转义。
 *
 * **有意不做的**：不做全文 HTML 转义（会破坏正文里合法的 Markdown/HTML 代码示例，
 * 降低导出件保真度）；`---` 分隔线歧义与渲染器层面的 HTML 执行风险见 Spec P1-4 备注。
 */
function protectExportStructure(text: string): string {
  return text.replace(/^###\s+(👤|🤖|⚙️|🛠)\s/gm, "\\### $1 ");
}

/**
 * 导出时间兜底（T-⑥02，2026-10-02 导出产物实证）：
 * `msg.timestamp` 缺失时 `new Date(undefined).toLocaleString()` 会输出**纪元 0**
 * （`Asia/Shanghai` 下即 `1970/1/1 08:00:00`）⇒ 缺失/非法时显式标注，不再伪造时间。
 */
function formatExportTime(ts: unknown, t: Translate): string {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0
    ? new Date(ts).toLocaleString()
    : t("chat.exportTimeUnknown");
}

/** 最小 t 契约（i18n 残留收尾：模块级构造函数由渲染处传入翻译函数） */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Markdown 头部：会话元信息（P1-3） */
function buildMarkdownHeader(
  messages: Message[],
  meta: ExportMeta,
  t: Translate,
): string {
  const rounds = messages.filter((m) => m.role === "user").length;
  return [
    `# ${meta.title || t("chat.exportDefaultTitle")}`,
    "",
    `- ${t("chat.exportMetaSessionId", { id: meta.id || "?" })}`,
    `- ${t("chat.exportMetaMessageCount", { count: messages.length, rounds })}`,
    `- ${t("chat.exportMetaExportedAt", { time: meta.exportedAt })}`,
    "",
    "---",
    "",
  ].join("\n");
}

/** JSON 块内容截断上限（与文案标注配套，P1-1/P1-2） */
const MAX_EXPORT_BLOCK_CHARS = 5000;

/**
 * 块内容截断（P1-2）：**必须带标注**——原实现静默 `substring(0, 5000)`，
 * 消费者无法判断内容缺口。此处复用 thinking 截断的无歧义口径（保留量 + 原文量 + 去处）。
 */
function truncateBlockContent(content: string, t: Translate): string {
  if (content.length <= MAX_EXPORT_BLOCK_CHARS) return content;
  return `${content.slice(0, MAX_EXPORT_BLOCK_CHARS)}\n\n${t(
    "chat.exportTruncatedBlock",
    { kept: MAX_EXPORT_BLOCK_CHARS, total: content.length },
  )}`;
}

/**
 * P2-7（2026-09-27 审计）：导出构造分段让出事件循环。
 * 原实现用 `messages.map(...).join()` 一次性同步构造整段字符串，超大会话会长时间
 * 阻塞主线程（UI 卡死、导出中动画不动）。现按条累加，每 `EXPORT_YIELD_EVERY` 条
 * `await` 一次让出，把长任务切成多个可渲染帧。
 */
const EXPORT_YIELD_EVERY = 20;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 整体缩进多行字符串（P2-7：逐条 stringify 后拼装，替代一次性整体 stringify） */
function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

/** 导出为 Markdown（含思考、工具调用、blocks 标识 + 会话元信息）
 *  @param opts.full D6（2026-09-27）= B：完整版——思考/工具结果不截断、工具调用附参数 */
async function exportAsMarkdown(
  messages: Message[],
  labels: Record<string, string>,
  meta: ExportMeta,
  t: Translate,
  opts?: { full?: boolean },
): Promise<string> {
  // 跨消息归属去重：全局 seen 在整会话导出期间共享（2026-09-05）
  const seen = new Set<string>();
  const parts: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleLabel =
      msg.role === "user"
        ? `👤 ${labels.user}`
        : msg.role === "assistant"
          ? `🤖 ${labels.assistant}`
          : msg.role === "system"
            ? `⚙️ ${labels.system}`
            : `🛠 ${labels.tool}`;
    const date = formatExportTime(msg.timestamp, t);
    // 1.6：助手消息有 startedAt 时显示开始时间与耗时（区分流式开始/完成）
    // T-⑥02：两侧时间戳都必须是有限数，否则耗时算成 NaN
    const timeInfo =
      msg.role === "assistant" &&
      msg.startedAt &&
      Number.isFinite(msg.timestamp) &&
      Number.isFinite(msg.startedAt)
        ? t("chat.exportStartedAtDuration", {
            start: new Date(msg.startedAt).toLocaleString(),
            seconds: ((msg.timestamp - msg.startedAt) / 1000).toFixed(1),
          })
        : "";
    const text = getMessageSearchText(dedupeCrossMessageToolBlocks(msg, seen), {
      forExport: true,
      full: opts?.full === true,
    });
    const usageInfo = msg.usage
      ? `\n> 📊 ${t("chat.exportTokenLine", {
          input: msg.usage.inputTokens ?? "?",
          output: msg.usage.outputTokens ?? "?",
          cacheRead: msg.usage.cacheReadTokens ?? "0",
        })}`
      : "";
    // 2026-09-27（真机产物实证）：先补齐**未闭合代码围栏**（否则本条会吞掉后续所有消息），
    // 再做结构保护（见 utils/exportMessage#balanceCodeFences）
    parts.push(
      `### ${roleLabel}  (${date}${timeInfo})\n\n${protectExportStructure(
        balanceCodeFences(text),
      )}${usageInfo}\n`,
    );
    if (i > 0 && i % EXPORT_YIELD_EVERY === 0) await yieldToEventLoop();
  }
  return buildMarkdownHeader(messages, meta, t) + parts.join("\n---\n");
}

/** 导出 JSON（含 blocks 全字段、usage、metadata + 会话元信息） */
async function exportAsJson(
  messages: Message[],
  meta: ExportMeta,
  t: Translate,
): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // P1-1：透传块的全部结构化载荷（原实现只映射 6 个字段 ⇒ taskCard/questionData/
    // deliverableData/diffData/*WorkflowData/块级 error 在导出中全部丢失）；
    // P1-2：超长 content 走**带标注**截断，不再静默丢弃。
    const blocksDetail = (msg.blocks || []).map((b) => ({
      ...b,
      content:
        typeof b.content === "string"
          ? truncateBlockContent(b.content, t)
          : b.content,
    }));
    const entry = {
      id: msg.id,
      role: msg.role,
      timestamp: msg.timestamp,
      // 1.6：流式开始时间随 JSON 导出
      startedAt: msg.startedAt,
      content:
        typeof msg.content === "string"
          ? // P0-3：tool 角色 content 为"工具结果信封"JSON ⇒ 导出前解码（与 md 侧同源）
            msg.role === "tool"
            ? decodeToolResultContent(msg.content)
            : msg.content
          : "",
      blocks: blocksDetail,
      toolCalls: msg.tool_calls,
      usage: msg.usage,
      error: msg.error,
      agentName: msg.agentName,
      replyToId: msg.replyToId,
      metadata: msg.metadata,
    };
    // P2-7：逐条 stringify（单条体积有界）后按 2 空格缩进拼装，产出与
    // `JSON.stringify({...}, null, 2)` 完全一致；避免整体 stringify 的长同步任务。
    parts.push(indentLines(JSON.stringify(entry, null, 2), 4));
    if (i > 0 && i % EXPORT_YIELD_EVERY === 0) await yieldToEventLoop();
  }
  // P1-3：导出件自证来源——顶层补会话元信息（原实现只输出消息数组，无法判断出处）
  const head =
    `{\n  "session": ${JSON.stringify({
      id: meta.id || null,
      title: meta.title || null,
    })},\n  "exportedAt": ${JSON.stringify(meta.exportedAt)},\n` +
    `  "messageCount": ${parts.length},\n  "messages": [`;
  if (parts.length === 0) return `${head}]\n}`;
  return `${head}\n${parts.join(",\n")}\n  ]\n}`;
}

/**
 * D7（2026-09-27，导出产物实证后定案）：导出时剔除**已被助手消息引用**的 `role:"tool"` 消息。
 *
 * 为什么：同一工具结果会以两种形态出现——① 所属助手消息内的 `🔧 名称 — 摘要`（已有）；
 * ② 独立 `role:"tool"` 消息（content = 工具结果信封）。实测导出件 50 个角色节里
 * 12+ 个是信封节 ⇒ 重复且噪声。
 * **孤儿保留**：未被任何助手消息引用的 tool 结果（如 `sessions_yield`）仍导出，
 * 与前端 N-48 的可见性策略一致（不丢信息）。
 */
function filterExportMessages(messages: Message[]): Message[] {
  // T-⑥01（2026-10-02）：先按 id 去重，再剔除被助手消息消费的 tool 信封。
  // 持久层实测同一 id 会被重复追加（样本逐字 20 次），而本函数是**全部导出格式
  // 唯一的导出前归一化点**（resolveExportMessages 三个分支都经它）⇒ 在此收口。
  const deduped = dedupeMessagesById(messages);
  const consumed = new Set<string>();
  for (const msg of deduped) {
    if (msg.role !== "assistant") continue;
    for (const b of msg.blocks ?? []) {
      const id = b.toolCall?.id ?? b.toolCallId;
      if (id) consumed.add(id);
    }
    for (const tc of msg.tool_calls ?? []) {
      const id = (tc as { id?: string }).id;
      if (id) consumed.add(id);
    }
  }
  const filtered = deduped.filter(
    (m) => m.role !== "tool" || !m.toolCallId || !consumed.has(m.toolCallId),
  );
  return filtered.length === deduped.length ? deduped : filtered;
}

/**
 * 消息级按 id 去重（T-⑥01，2026-10-02 持久层 + 导出产物双向实证）。
 *
 * 背景：`messages.jsonl` 中同一 `id` 会被**重复追加**（样本 `76de12c4-…` 逐字 20 次，
 * 内容/时间戳/metadata 全同），而导出侧此前**只有 tool block 去重、没有消息级去重**
 * ⇒ 重复 id 被逐条渲染，产出"同一时刻两条助手消息 / 同刻同文重复"。
 *
 * 策略：保留**首次出现的位置**（维持会话时序），取**最后一次的载荷**
 * （同 id 的后续写入若携带内容更新，则不应导出旧版本）。
 * 无重复时返回原数组（引用不变，零副作用，与既有去重函数同约定）。
 */
function dedupeMessagesById(messages: Message[]): Message[] {
  const index = new Map<string, number>();
  const out: Message[] = [];
  let changed = false;
  for (const msg of messages) {
    const key = msg.id;
    if (!key) {
      out.push(msg);
      continue;
    }
    const prev = index.get(key);
    if (prev === undefined) {
      index.set(key, out.length);
      out.push(msg);
    } else {
      out[prev] = msg;
      changed = true;
    }
  }
  if (!changed) return messages;
  return out;
}

/**
 * 跨消息归属去重（2026-09-05，与后端读路径 Fix3 同策略）：
 * 同一 toolCallId 只归属首条携带它的消息；后续消息的重复 tool_call 块在此移除，
 * 使 Markdown 导出工具卡数与后端唯一数一致（实测 244 → 239）。
 * 无重复时返回原消息（引用保持，零副作用）。
 */
function dedupeCrossMessageToolBlocks(
  msg: Message,
  seen: Set<string>,
): Message {
  if (msg.role !== "assistant" || !msg.blocks || msg.blocks.length === 0) {
    return msg;
  }
  let changed = false;
  const blocks = [];
  for (const b of msg.blocks) {
    if (b.type === "tool_call") {
      const id = b.toolCallId || b.toolCall?.id;
      if (id) {
        if (seen.has(id)) {
          changed = true;
          continue;
        }
        seen.add(id);
      }
    }
    blocks.push(b);
  }
  return changed ? { ...msg, blocks } : msg;
}

function SessionHeader() {
  const { currentSession, renameSession } = useSessionStore();
  const messages = useChatStore((s) => s.messages);
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  /** P1-2 修复：Escape 取消标记（防止 blur 覆盖取消操作） */
  const cancelledRef = useRef(false);
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleDoubleClick = () => {
    if (currentSession) {
      setEditTitle(currentSession.title);
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    // P1-2 修复：Escape 取消时跳过保存
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setIsEditing(false);
      return;
    }
    if (
      editTitle.trim() &&
      currentSession &&
      editTitle !== currentSession.title
    ) {
      renameSession(currentSession.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      // P1-2 修复：标记取消，防止 blur 覆盖
      cancelledRef.current = true;
      setIsEditing(false);
    }
  };

  const handleCopyId = () => {
    if (currentSession) {
      navigator.clipboard.writeText(currentSession.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 导出按钮点击外部关闭
  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportOpen]);

  /** 导出前统一从持久层拉取最新消息（P0 修复 1.7：两次导出内容一致，不依赖内存快照） */
  const resolveExportMessages = async (): Promise<Message[]> => {
    if (!currentSession) return filterExportMessages(messages);
    try {
      const persisted = await sessionService.getMessages(currentSession.id);
      // 持久层为空时回退内存（断网/未落盘兜底，避免导出空文件）
      return filterExportMessages(persisted.length > 0 ? persisted : messages);
    } catch {
      return filterExportMessages(messages);
    }
  };

  /** 导出元信息（P1-3）：文件名仍用时间戳，元信息写进导出内容本身 */
  const buildExportMeta = (): ExportMeta => ({
    id: currentSession?.id ?? "",
    title: currentSession?.title ?? "",
    exportedAt: new Date().toISOString(),
  });

  /** 组装会话 Markdown（md/html/word/完整版 共用，避免重复构造） */
  const buildSessionMarkdown = async (full = false): Promise<string> => {
    const source = await resolveExportMessages();
    return exportAsMarkdown(
      source,
      {
        user: t("chat.user"),
        assistant: t("chat.assistant"),
        system: t("chat.system"),
        tool: t("chat.tool"),
      },
      buildExportMeta(),
      t,
      { full },
    );
  };

  /** 导出 Markdown（full=true 为 D6 完整版：思考/工具结果不截断、工具调用附参数） */
  const handleExportMarkdown = async (full = false) => {
    setExporting(true);
    try {
      const md = await buildSessionMarkdown(full);
      triggerBlobDownload(
        new Blob([md], { type: "text/markdown;charset=utf-8" }),
        `chat-export-${Date.now()}${full ? "-full" : ""}.md`,
      );
    } catch (e) {
      handleClientError(e, {
        module: "ui:session-header",
        action: full ? "exportMarkdownFull" : "exportMarkdown",
      });
    } finally {
      setExporting(false);
    }
    setExportOpen(false);
  };

  /**
   * 导出 HTML / Word（D2 定案，2026-09-27）：会话级与单条导出对齐，复用既有
   * `utils/exportMessage#exportMessageAsFormat`（md → HTML / Word 壳），**不另立实现**（CS01）。
   */
  const handleExportHtmlOrWord = async (format: "html" | "word") => {
    setExporting(true);
    try {
      const md = await buildSessionMarkdown();
      exportMessageAsFormat(md, format, `chat-export-${Date.now()}`);
    } catch (e) {
      handleClientError(e, {
        module: "ui:session-header",
        action: `export${format}`,
      });
    } finally {
      setExporting(false);
    }
    setExportOpen(false);
  };

  /** 导出 JSON */
  const handleExportJson = async () => {
    setExporting(true);
    try {
      const source = await resolveExportMessages();
      const json = await exportAsJson(source, buildExportMeta(), t);
      triggerBlobDownload(
        new Blob([json], { type: "application/json;charset=utf-8" }),
        `chat-export-${Date.now()}.json`,
      );
    } catch (e) {
      handleClientError(e, {
        module: "ui:session-header",
        action: "exportJson",
      });
    } finally {
      setExporting(false);
    }
    setExportOpen(false);
  };

  return (
    // #20 修复：header 补 relative——详情面板 absolute top-full 需以其为定位基准
    <header className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {currentSession ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-400 flex-shrink-0">💬</span>
              {isEditing ? (
                <input
                  type="text"
                  id="session-title-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-[200px]"
                />
              ) : (
                /* 方案 C #6：title 归还完整标题，操作提示迁到 Tooltip */
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SessionTitle
                        text={currentSession.title}
                        fallback={t("chat.untitledSession")}
                        as="h2"
                        onClick={() => setShowInfo(!showInfo)}
                        onDoubleClick={handleDoubleClick}
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      />
                    }
                  />
                  <TooltipContent>
                    {t("chat.titleEditHint", "单击查看详情 · 双击编辑标题")}
                  </TooltipContent>
                </Tooltip>
              )}
              {!isEditing && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {t("chat.roundCountWithCount", {
                      count: currentSession.roundCount,
                    })}
                  </span>
                  <button
                    onClick={handleCopyId}
                    className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                    title={t("chat.copySessionId", "复制会话 ID")}
                  >
                    {copied ? "✅" : "📋"}
                  </button>
                </div>
              )}
            </div>

            {/* 展开的会话属性面板 */}
            {showInfo && !isEditing && (
              <div className="absolute top-full left-4 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-400 space-y-1.5 min-w-[200px]">
                <div className="flex justify-between gap-4">
                  <span>{t("chat.createdAt", "创建时间")}</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.createdAt
                      ? formatDateTime(currentSession.createdAt)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>{t("chat.updatedAt")}</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.updatedAt
                      ? formatDateTime(currentSession.updatedAt)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>{t("chat.roundCount")}</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.roundCount}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>{t("chat.messageCount")}</span>
                  <span className="text-gray-900 dark:text-gray-200">
                    {currentSession.messageCount}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>{t("chat.sessionId", "会话 ID")}</span>
                  <span className="text-gray-500 font-mono max-w-[120px] truncate">
                    {currentSession.id.slice(0, 12)}...
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("chat.selectSessionHint")}
          </span>
        )}
      </div>

      {/* 右侧：导出按钮 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* 导出按钮 */}
        {currentSession && (
          <div ref={exportRef} className="relative flex-shrink-0">
            <button
              onClick={() => setExportOpen((prev) => !prev)}
              // P2-6（2026-09-27 审计）：空会话/导出中禁用并给出原因——原实现可点，
              // 空会话会下载只含分隔符的空文件且无任何提示
              disabled={exporting || messages.length === 0}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={
                messages.length === 0
                  ? t("chat.exportEmptyHint", "当前会话暂无消息可导出")
                  : t("chat.exportSession")
              }
            >
              {exporting ? (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              )}
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-30">
                <button
                  onClick={() => handleExportMarkdown(false)}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsMarkdown")}
                </button>
                {/* D6（2026-09-27）= B：默认轻量 + 完整版（思考/工具结果不截断、工具调用附参数） */}
                <button
                  onClick={() => handleExportMarkdown(true)}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsMarkdownFull")}
                </button>
                <button
                  onClick={handleExportJson}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsJson")}
                </button>
                {/* D2（2026-09-27）：与会话级导出对齐，补 HTML / Word（复用单条导出渲染） */}
                <button
                  onClick={() => handleExportHtmlOrWord("html")}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsHtml")}
                </button>
                <button
                  onClick={() => handleExportHtmlOrWord("word")}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t("chat.exportAsWord")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default SessionHeader;
