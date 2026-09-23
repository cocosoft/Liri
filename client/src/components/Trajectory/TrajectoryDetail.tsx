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
 * TrajectoryDetail — 事件详情底部面板
 *
 * 点击行后从底部弹出，展示完整 data JSON。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LiriEvent } from "@/types";
import { ClampedBody } from "../common/ClampedBody";
// P1-3（2026-09-22）：复用既有 Markdown 渲染器（不新建渲染器）
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";
// P2-3（2026-09-22）：JSON 树（替换非工具事件的纯文本 JSON 展示）
import { JsonTree } from "../common/JsonTree";
// TR-12-B（2026-09-22）：按 refSeq 一跳还原"模型当时看到的输入"
import { resolveModelInputSnapshot } from "@/stores/chat/resolveModelInputSnapshot";

interface Props {
  event: LiriEvent;
  onClose: () => void;
  /**
   * TR-12-B（2026-09-22）：当前已加载事件（窗口内）。
   *
   * `context/model-input` 的载荷采用**引用式去重**（全量只在变化时落），
   * 需据此按 `refSeq`/`toolsRefSeq` 一跳还原"模型当时看到的输入"。
   * 缺省（未传）时不展示该分区 —— 不影响既有调用方。
   */
  allEvents?: LiriEvent[];
}

export function TrajectoryDetail({ event, onClose, allEvents }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const jsonText = useMemo(() => {
    try {
      return JSON.stringify(event.data, null, 2);
    } catch {
      return String(event.data);
    }
  }, [event]);

  const timeStr = useMemo(() => {
    return new Date(event.time).toLocaleString("zh-CN", { hour12: false });
  }, [event]);

  // TR-12-B（2026-09-22）：模型输入快照（引用式去重 ⇒ 需按 seq 一跳还原）
  const modelInput = useMemo(
    () =>
      allEvents && allEvents.length > 0
        ? resolveModelInputSnapshot(allEvents)
        : null,
    [allEvents],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // @ignore-catch — 剪贴板不可用时静默
    }
  };

  // P5（2026-08-25）：工具事件字段分区块（参数 / 结果 / 错误）
  const data = (event.data ?? {}) as Record<string, unknown>;
  const hasArgs = typeof data.arguments === "object" && data.arguments !== null;
  const hasResult = data.result !== undefined && data.result !== null;
  const hasError = data.error !== undefined && data.error !== null;
  const stringifyField = (v: unknown): string =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  const showFieldSections = hasArgs || hasResult || hasError;

  // ── P1-3（2026-09-22）检查器增强：Markdown 正文 / 计时 / 用量 ──────────
  // 原则：**只展示事件里真实存在的数据**，不虚构缺失项。
  // - Markdown：复用 `MarkdownRenderer`（`data.content` / `data.summary` / `data.message`）
  // - 计时：`metric/timing` 事件的 `ttft/duration/tokens/stage`
  // - 用量：`context/compaction` 的 `beforeTokens/afterTokens`（+ 摘要信封 usage，若有）
  // - schema：**未做** —— 事件流中不存在"请求头/工具清单"数据源（不做虚构展示）
  // 注：以下三项**刻意不用 useMemo** —— `data` 由 `(event.data ?? {})` 派生，每次渲染
  // 都是新对象引用（既有的 `hasArgs/hasResult/hasError` 同此），包 useMemo 只会造成
  // "每次依赖都变"的虚假 memo（react-hooks/exhaustive-deps 报此问题）；三者计算量都很小。
  const markdownText =
    [data.content, data.summary, data.message].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    ) ?? null;
  const [mdMode, setMdMode] = useState<"markdown" | "raw">("markdown");

  const timing =
    event.type === "metric/timing"
      ? (data as {
          ttfb?: number;
          ttft?: number;
          duration?: number;
          tokens?: number;
          stage?: string;
          // TR-12-A（2026-09-22）：请求级用量分桶（与后端同一契约）
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        })
      : null;

  const compaction =
    event.type === "context/compaction"
      ? (data as {
          beforeTokens?: number;
          afterTokens?: number;
          summaryEnvelope?: { model?: string; usage?: Record<string, number> };
        })
      : null;

  return (
    <div className="pointer-events-auto border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 max-h-[50%] flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
            #{event.seq}
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {event.type}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* P5：复制 JSON */}
          <button
            onClick={handleCopy}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              copied
                ? "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700"
                : "text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            aria-label={t("trajectory.detail.copyJson")}
          >
            {copied
              ? t("trajectory.detail.copied")
              : t("trajectory.detail.copyJson")}
          </button>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            aria-label={t("trajectory.detail.close")}
          >
            ✕
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3 text-xs">
        <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 mb-3">
          <dt className="text-gray-500 dark:text-gray-400">seq</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {event.seq}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">time</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {timeStr}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">sessionId</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
            {event.sessionId}
          </dd>
          {event.sourceEventSeqs && event.sourceEventSeqs.length > 0 && (
            <>
              <dt className="text-gray-500 dark:text-gray-400">sources</dt>
              <dd className="font-mono text-gray-900 dark:text-gray-100">
                {event.sourceEventSeqs.join(", ")}
              </dd>
            </>
          )}
          {event.ignorable && (
            <>
              <dt className="text-gray-500 dark:text-gray-400">ignorable</dt>
              <dd className="font-mono text-amber-600 dark:text-amber-400">
                true
              </dd>
            </>
          )}
        </dl>

        {/* P1-3：Markdown 正文（可切原文）——复用既有渲染器 */}
        {markdownText && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-gray-500 dark:text-gray-400">
                {t("trajectory.detail.body")}
              </span>
              <button
                onClick={() =>
                  setMdMode((m) => (m === "markdown" ? "raw" : "markdown"))
                }
                className="px-1.5 py-0.5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                {mdMode === "markdown"
                  ? t("trajectory.detail.viewRaw")
                  : t("trajectory.detail.renderMarkdown")}
              </button>
            </div>
            {mdMode === "markdown" ? (
              <div className="text-gray-900 dark:text-gray-100">
                <MarkdownRenderer content={markdownText} />
              </div>
            ) : (
              <ClampedBody text={markdownText} />
            )}
          </div>
        )}

        {/* P1-3：计时与用量分桶（metric/timing 事件）
            TR-12-A（2026-09-22）：新增请求级用量分桶（input/output/cache） */}
        {timing &&
          (timing.ttft !== undefined ||
            timing.duration !== undefined ||
            timing.tokens !== undefined ||
            timing.inputTokens !== undefined ||
            timing.outputTokens !== undefined ||
            timing.cacheReadTokens !== undefined ||
            timing.cacheCreationTokens !== undefined) && (
            <div className="mb-3">
              <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                {t("trajectory.detail.timing")}
              </div>
              <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
                {timing.stage !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">stage</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.stage}
                    </dd>
                  </>
                )}
                {timing.ttfb !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">ttfb</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.ttfb} ms
                    </dd>
                  </>
                )}
                {timing.ttft !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">ttft</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.ttft} ms
                    </dd>
                  </>
                )}
                {timing.duration !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">
                      duration
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.duration} ms
                    </dd>
                  </>
                )}
                {timing.tokens !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">tokens</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.tokens}
                    </dd>
                  </>
                )}
                {timing.inputTokens !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">input</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.inputTokens}
                    </dd>
                  </>
                )}
                {timing.outputTokens !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">output</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.outputTokens}
                    </dd>
                  </>
                )}
                {timing.cacheReadTokens !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">
                      cacheRead
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.cacheReadTokens}
                    </dd>
                  </>
                )}
                {timing.cacheCreationTokens !== undefined && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">
                      cacheCreation
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {timing.cacheCreationTokens}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

        {/* TR-12-B（2026-09-22）：模型输入快照 —— 工具清单 + 系统提示词分段
            引用式去重：未变单元只记 refSeq，正文经 resolveModelInputSnapshot 一跳还原 */}
        {modelInput && (
          <div className="mb-3">
            <div className="text-gray-500 dark:text-gray-400 mb-0.5">
              {t("trajectory.detail.modelInputTitle")}
            </div>
            {modelInput.toolsHash !== undefined && (
              <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
                <dt className="text-gray-500 dark:text-gray-400">
                  {t("trajectory.detail.modelInputTools")}
                </dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">
                  {modelInput.toolsRefSeq !== undefined
                    ? t("trajectory.detail.modelInputRef", {
                        seq: modelInput.toolsRefSeq,
                      })
                    : t("trajectory.detail.modelInputInline", {
                        count:
                          modelInput.toolsSchemas?.length ??
                          modelInput.toolsCount ??
                          0,
                      })}
                </dd>
              </dl>
            )}
            {modelInput.sections.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {modelInput.sections.map((s) => (
                  <li
                    key={s.name}
                    className="font-mono text-xs text-gray-700 dark:text-gray-300"
                  >
                    {s.name}
                    {" · "}
                    {s.refSeq !== undefined
                      ? t("trajectory.detail.modelInputSectionRef", {
                          seq: s.refSeq,
                        })
                      : t("trajectory.detail.modelInputSectionInline", {
                          chars: s.content?.length ?? 0,
                        })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* P1-3：用量（压缩事件的 beforeTokens/afterTokens；摘要信封 usage 若有） */}
        {compaction &&
          (compaction.beforeTokens !== undefined ||
            compaction.afterTokens !== undefined) && (
            <div className="mb-3">
              <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                {t("trajectory.detail.usage")}
              </div>
              <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
                <dt className="text-gray-500 dark:text-gray-400">before</dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">
                  {compaction.beforeTokens ?? "—"}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">after</dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">
                  {compaction.afterTokens ?? "—"}
                </dd>
                {typeof compaction.beforeTokens === "number" &&
                  typeof compaction.afterTokens === "number" &&
                  compaction.beforeTokens > 0 && (
                    <>
                      <dt className="text-gray-500 dark:text-gray-400">
                        {t("trajectory.detail.reduced")}
                      </dt>
                      <dd className="font-mono text-emerald-600 dark:text-emerald-400">
                        {compaction.beforeTokens - compaction.afterTokens} (
                        {Math.round(
                          (1 -
                            compaction.afterTokens / compaction.beforeTokens) *
                            100,
                        )}
                        %)
                      </dd>
                    </>
                  )}
                {compaction.summaryEnvelope?.usage && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">
                      {t("trajectory.detail.summaryUsage")}
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
                      {Object.entries(compaction.summaryEnvelope.usage)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

        {showFieldSections ? (
          /* P5：工具事件字段聚焦（参数 / 结果 / 错误分区块） */
          <div className="space-y-2">
            {hasArgs && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  arguments
                </div>
                <ClampedBody text={stringifyField(data.arguments)} />
              </div>
            )}
            {hasResult && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  result
                </div>
                <ClampedBody text={stringifyField(data.result)} />
              </div>
            )}
            {hasError && (
              <div>
                <div className="text-gray-500 dark:text-gray-400 mb-0.5">
                  error
                </div>
                <ClampedBody text={stringifyField(data.error)} />
              </div>
            )}
          </div>
        ) : (
          /* 非工具事件：完整 data —— **JSON 树**（P2-3，2026-09-22）
             替换原先的纯文本 `ClampedBody`：可折叠 + 类型着色，内部限高滚动。
             "复制 JSON" 按钮仍复制**完整原文** ⇒ 展示层截断不损失信息。 */
          <div>
            <div className="text-gray-500 dark:text-gray-400 mb-0.5">data</div>
            <JsonTree value={event.data} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 默认导出（2026-09-22 修复预存缺陷）：
 * 本组件此前**只有具名导出**，而消费方 `ChatInspector.tsx:20` 用的是默认导入
 * ⇒ ESM 下拿到 `undefined`，选中记录时详情面板渲染 `undefined` 会抛
 * "Element type is invalid"（因该模块当时无组件级测试而长期潜伏）。
 * 对齐同目录 `TrajectoryPlayer` 的"具名 + 默认"双导出惯例（不修改消费方）。
 */
export default TrajectoryDetail;
