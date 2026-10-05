import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { goalService } from "../../services/goalService";
import type { TaskGoalDto, TaskGoalStatus } from "../../types/events";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:goalBar");

/**
 * 终态判据（与后端 `isTerminalGoalStatus` 同口径）：
 * `completed` / `failed` / `cancelled` / `budget_limited`。
 */
const TERMINAL_STATUSES: ReadonlySet<TaskGoalStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "budget_limited",
]);

function isTerminal(status: TaskGoalStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 预算输入解析：空 / 非正 / 非有限数 ⇒ `undefined`（不传 tokenBudget） */
function parseBudget(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

interface GoalBarProps {
  sessionId: string;
}

/**
 * GoalBar — 聊天区会话级「目标条」（X11，2026-10-05）
 *
 * 展示当前未终结目标（objective / 状态 / 进度 `tokensUsed[/tokenBudget]`）+
 * 内联创建/编辑表单 + 历史目标折叠列表。无未终结目标时仅显示"＋ 设目标"入口。
 *
 * ⚠️ 与 PDCA `/goal`（`goal_metrics`）分治（Spec `goal-entity.md` §D6），不混放。
 */
function GoalBar({ sessionId }: GoalBarProps) {
  const { t } = useTranslation();
  const [goals, setGoals] = useState<TaskGoalDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftObjective, setDraftObjective] = useState("");
  const [draftBudget, setDraftBudget] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editObjective, setEditObjective] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const refresh = useCallback(async () => {
    const list = await goalService.list({ sessionId });
    setGoals(list);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeGoals = goals.filter((g) => !isTerminal(g.status));
  const historyGoals = goals.filter((g) => isTerminal(g.status));

  const resetCreateForm = () => {
    setCreating(false);
    setDraftObjective("");
    setDraftBudget("");
  };

  const handleCreate = async () => {
    const objective = draftObjective.trim();
    if (!objective) return;
    const created = await goalService.create({
      objective,
      sessionId,
      tokenBudget: parseBudget(draftBudget),
    });
    if (!created) {
      // 失败保留草稿，用户可修正后重试（不静默清空）
      logger.warn("创建目标失败，保留草稿", { sessionId });
      return;
    }
    resetCreateForm();
    await refresh();
  };

  const startEdit = (goal: TaskGoalDto) => {
    setEditingId(goal.id);
    setEditObjective(goal.objective);
    setEditBudget(
      goal.tokenBudget !== undefined ? String(goal.tokenBudget) : "",
    );
  };

  const handleSaveEdit = async (id: string) => {
    const objective = editObjective.trim();
    if (!objective) return;
    const changes: { objective?: string; tokenBudget?: number } = { objective };
    const budget = parseBudget(editBudget);
    if (budget !== undefined) changes.tokenBudget = budget;
    const updated = await goalService.update(id, changes);
    if (!updated) {
      logger.warn("更新目标失败", { sessionId, goalId: id });
      return;
    }
    setEditingId(null);
    await refresh();
  };

  const statusLabel = (status: TaskGoalStatus): string =>
    t(`goalBar.status.${status}`);

  const progressLabel = (goal: TaskGoalDto): string =>
    goal.tokenBudget !== undefined
      ? t("goalBar.progress", {
          used: goal.tokensUsed,
          budget: goal.tokenBudget,
        })
      : t("goalBar.progressNoBudget", { used: goal.tokensUsed });

  return (
    <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/60 px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0">
            🎯 {t("goalBar.title")}
          </span>
          {activeGoals.length === 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {t("goalBar.noActive")}
            </span>
          )}
        </div>
        {activeGoals.length === 0 && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/70 transition-colors shrink-0"
          >
            {t("goalBar.setGoal")}
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-2 space-y-2">
          <textarea
            value={draftObjective}
            onChange={(e) => setDraftObjective(e.target.value)}
            placeholder={t("goalBar.objectivePlaceholder")}
            rows={2}
            className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            value={draftBudget}
            onChange={(e) => setDraftBudget(e.target.value)}
            inputMode="numeric"
            placeholder={t("goalBar.budgetPlaceholder")}
            className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              {t("goalBar.create")}
            </button>
            <button
              type="button"
              onClick={resetCreateForm}
              className="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t("goalBar.cancel")}
            </button>
          </div>
        </div>
      )}

      {activeGoals.map((goal) => (
        <div
          key={goal.id}
          className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-2.5 py-2"
        >
          {editingId === goal.id ? (
            <div className="space-y-2">
              <textarea
                value={editObjective}
                onChange={(e) => setEditObjective(e.target.value)}
                rows={2}
                className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                value={editBudget}
                onChange={(e) => setEditBudget(e.target.value)}
                inputMode="numeric"
                placeholder={t("goalBar.budgetPlaceholder")}
                className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveEdit(goal.id)}
                  className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  {t("goalBar.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {t("goalBar.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-800 dark:text-gray-100 break-words">
                  {goal.objective}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {statusLabel(goal.status)} · {progressLabel(goal)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(goal)}
                className="text-[11px] px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors shrink-0"
              >
                {t("goalBar.edit")}
              </button>
            </div>
          )}
        </div>
      ))}

      {historyGoals.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {t("goalBar.historyToggle", { count: historyGoals.length })}
          </button>
          {historyOpen && (
            <ul className="mt-1 space-y-1">
              {historyGoals.map((goal) => (
                <li
                  key={goal.id}
                  className="text-[11px] text-gray-500 dark:text-gray-400 break-words"
                >
                  <span className="text-gray-400 dark:text-gray-500">
                    [{statusLabel(goal.status)}]
                  </span>{" "}
                  {goal.objective}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default GoalBar;
