/**
 * BatchActionBar — 批量操作栏 (Phase 1 W1)
 *
 * 选中文件后显示：批量加标签、移动、删除、取消。
 */
import { useTranslation } from "react-i18next";
import type { KnowledgeBase } from "../../types";
import { knowledgeService } from "../../services/knowledgeService";
import { useState } from "react";
import { toastError } from "../../stores/toastStore";

interface BatchActionBarProps {
  isDark: boolean;
  selectedFileIds: Set<string>;
  selectedBase: string | null;
  bases: KnowledgeBase[];
  onOpenBatchTag: () => void;
  onClearSelection: () => void;
  onRefresh: () => void;
}

function BatchActionBar({
  isDark,
  selectedFileIds,
  selectedBase,
  bases,
  onOpenBatchTag,
  onClearSelection,
  onRefresh,
}: BatchActionBarProps) {
  const { t } = useTranslation();
  const count = selectedFileIds.size;
  // KB-BATCH（2026-08-27）：批量操作期间禁用按钮 + 失败提示，避免 unhandled rejection
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;

  async function handleMove(target: string) {
    if (!target || count === 0 || busy) return;
    setBusy(true);
    const ids = [...selectedFileIds];
    const failed: string[] = [];
    try {
      for (const id of ids) {
        try {
          await knowledgeService.updateDoc(id, "", undefined, { base: target });
        } catch {
          // 逐条失败收集，避免"部分成功"无明细
          failed.push(id);
        }
      }
      onClearSelection();
      onRefresh();
      if (failed.length > 0) {
        // Phase 2-11：明确"成功 N/M 条"，失败明细可排查
        toastError(
          t("knowledge.batchMoveSummary", {
            ok: ids.length - failed.length,
            total: ids.length,
            failedPart:
              failed.length > 0
                ? t("knowledge.batchMoveFailedPart", { failed: failed.length })
                : "",
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchDelete() {
    if (busy) return; // F8：移动/删除进行中防并发
    if (!confirm(t("knowledge.batchDeleteConfirm", { count }))) return;
    setBusy(true);
    try {
      await knowledgeService.batchDelete([...selectedFileIds]);
      onClearSelection();
      onRefresh();
    } catch (err) {
      toastError(
        err instanceof Error
          ? err
          : new Error(t("knowledge.batchDeleteFailed")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`sticky top-0 z-10 px-2 py-1.5 mb-1.5 rounded-md flex items-center justify-between ${
        isDark
          ? "bg-blue-900/40 border border-blue-800"
          : "bg-blue-50 border border-blue-200"
      }`}
    >
      <span
        className={`text-xs font-medium ${isDark ? "text-blue-300" : "text-blue-700"}`}
      >
        {t("knowledge.selectedCount", { count })}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenBatchTag}
          disabled={busy}
          className={`px-2 py-0.5 text-[10px] rounded disabled:opacity-40 ${
            isDark
              ? "bg-blue-800 text-blue-200 hover:bg-blue-700"
              : "bg-blue-200 text-blue-700 hover:bg-blue-300"
          }`}
        >
          {t("knowledge.batchAddTags")}
        </button>
        <select
          value=""
          disabled={busy}
          onChange={async (e) => {
            const target = e.target.value;
            if (!target) return;
            (e.target as HTMLSelectElement).value = "";
            await handleMove(target);
          }}
          className={`text-[10px] px-1.5 py-0.5 rounded disabled:opacity-40 ${
            isDark
              ? "bg-gray-700 border-gray-600 text-gray-300"
              : "bg-gray-100 border-gray-300 text-gray-600"
          } border focus:outline-none cursor-pointer`}
        >
          <option value="">{t("knowledge.moveTo")}</option>
          {bases
            .filter((b) => b.name !== selectedBase)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
        <button
          onClick={handleBatchDelete}
          disabled={busy}
          className={`px-2 py-0.5 text-[10px] rounded disabled:opacity-40 ${
            isDark
              ? "bg-red-900/50 text-red-300 hover:bg-red-800/60"
              : "bg-red-100 text-red-600 hover:bg-red-200"
          }`}
        >
          {t("common.delete")}
        </button>
        <button
          onClick={onClearSelection}
          className={`px-2 py-0.5 text-[10px] rounded ${
            isDark
              ? "text-gray-400 hover:text-gray-200"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export default BatchActionBar;
