/**
 * 工作项页（路由 `/work`）
 *
 * 2026-10-22「收边界」：本页原为**工作台标签壳**（`workStore` 驱动 9 个视图标签），
 * 而那 9 个视图与 `navRegistry` 的工作台目录**指向同一批页面组件**
 * （`workbenchViews.ts` 直接复用各页默认导出；`rules` 视图更是设置页 `CustomRulesPanel`
 * 的适配器）⇒ 与 `/workbench` 形成了两套工作面，且 `/plans` `/semantic` 早已重定向到
 * `/tasks` `/knowledge`。标签壳已退役。
 *
 * 本页只保留它**独有**的能力：项目工作项的新建 / 列表 / 删除，以及「进入规划」入口；
 * 其余功能一律走 `/workbench` 目录或设置抽屉。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { useRootStore } from "@/stores/root-store";
import type { WorkItemStatus } from "@/stores/workStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:workItems");

/** 工作项状态 → i18n key（`WorkItemStatus` 全成员穷尽映射，避免在 JSX 里堆条件） */
const WORK_ITEM_STATUS_KEYS: Record<WorkItemStatus, string> = {
  pending: "workspace.workItemStatusPending",
  running: "workspace.workItemStatusRunning",
  paused: "workspace.workItemStatusPaused",
  review: "workspace.workItemStatusReview",
  done: "workspace.workItemStatusDone",
  failed: "workspace.workItemStatusFailed",
};

export default function WorkItemsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 工作项入口（Spec: `.trae/specs/plan-do-mode.md` B3 / §4 Q4）
  // 工作项归属于**用户项目工作空间**（`workspaceSource === "user"`）；系统工作空间
  // （chat 等）在后端没有对应记录，故此处给出提示而不是造一个必然失败的入口。
  const isUserWorkspace = useRootStore(
    (s) => s.worktrees[s.currentWorkspaceId ?? ""]?.workspaceSource === "user",
  );
  const currentWorkspaceId = useRootStore((s) => s.currentWorkspaceId);
  const openWorkspace = useRootStore((s) => s.openWorkspace);
  const createWorkItem = useRootStore((s) => s.createWorkItem);
  const [workItemTitle, setWorkItemTitle] = useState("");
  const [creatingWorkItem, setCreatingWorkItem] = useState(false);

  // 工作项列表（V-37，2026-09-14）：删除入口需要"列表宿主"
  const deleteWorkItem = useRootStore((s) => s.deleteWorkItem);
  const currentWorktree = useRootStore(
    (s) => s.worktrees[s.currentWorkspaceId ?? ""],
  );
  const workItems = currentWorktree?.workItems ?? [];
  const [pendingDeleteItem, setPendingDeleteItem] = useState<{
    id: string;
    title: string;
  } | null>(null);
  // 删除失败的可见反馈：此前只记日志 ⇒ 对"本地存在但后端已无"的陈旧条目会表现为
  // **点了没反应**（刷新后又回来）。此处把失败显式告知用户，不静默吞掉
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * V-38（2026-09-14）：进入本页时以**后端为事实来源对账工作项**。
   *
   * `openWorkspace` 会用后端结果**整体替换**该 worktree 的 `workItems` ⇒ 清掉
   * "仅存于 localStorage、后端已无"的陈旧条目。同一工作空间只对账一次（ref 守卫）。
   */
  const reconciledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentWorkspaceId || !isUserWorkspace) return;
    if (reconciledRef.current === currentWorkspaceId) return;
    reconciledRef.current = currentWorkspaceId;
    void openWorkspace(currentWorkspaceId);
  }, [currentWorkspaceId, isUserWorkspace, openWorkspace]);

  /**
   * 进入规划模式（Spec: `.trae/specs/plan-do-mode.md`）
   *
   * 与「进入工作模式」（`do`）对称：在**当前项目**开一个 `mode:'plan'` 的工作空间会话并切过去
   * —— 这是让 `plan` 模式可用的入口（此前唯一调用方只传 `'do'`，plan 分支永远跑不到）。
   * 标题复用下方输入框（与「新建工作项」共用；为空时按钮禁用，不臆造默认标题）。
   */
  const handleEnterPlanning = async (): Promise<void> => {
    const title = workItemTitle.trim();
    if (!title) return;
    const { currentWorkspaceId } = useRootStore.getState();
    if (!currentWorkspaceId) return;
    setCreatingWorkItem(true);
    try {
      const { workspaceService } = await import("@/services/workspaceService");
      // V-24 方案 B：currentWorkspaceId 是**项目 id**，需换成年后端**工作空间 id**
      const backendWsId =
        await workspaceService.resolveBackendWorkspaceId(currentWorkspaceId);
      if (!backendWsId) {
        throw new Error(
          `无法解析项目所属工作空间（projectId=${currentWorkspaceId}），未创建规划会话`,
        );
      }
      const session = await workspaceService.createSession(backendWsId, {
        title,
        mode: "plan",
      });
      const { useSessionStore } = await import("@/stores/sessionStore");
      // **先刷新列表再切换**：新建的 workspace 会话此刻还不在本地列表里，
      // 直接 switch 会被判定为"幽灵会话"并回退到最近会话（实测：聊天区不跟随切换，
      // 日志 `loadChatSessions:current 返回幽灵会话，回退最近会话`）
      await useSessionStore.getState().loadSessions();
      await useSessionStore.getState().switchSession(session.id);
      // 规划是"对话里做的事"，故跳聊天页（路由 `/chat`，routes/index.tsx）
      navigate("/chat");
    } catch (err) {
      logger.error(`进入规划失败: ${String(err)}`);
    } finally {
      setCreatingWorkItem(false);
    }
  };

  const handleCreateWorkItem = async (): Promise<void> => {
    const title = workItemTitle.trim();
    if (!title) return;
    setCreatingWorkItem(true);
    try {
      await createWorkItem(title);
      setWorkItemTitle("");
    } catch (err) {
      // 后端写入失败：此处只记录，界面错误态由 root-store.error 承载
      logger.error(`新建工作项失败: ${String(err)}`);
    } finally {
      setCreatingWorkItem(false);
    }
  };

  /**
   * 确认删除工作项（V-37）
   *
   * 先关闭对话框再发起请求（`ConfirmDialog` 自带 300ms 防连点）。失败时**必须让用户看见**
   * ——store 是"先落后端再改本地"，失败时条目仍在（不会假删除），若只记日志则表现为
   * "点了没反应"。
   */
  const handleConfirmDeleteWorkItem = async (): Promise<void> => {
    const target = pendingDeleteItem;
    setPendingDeleteItem(null);
    if (!target) return;
    setDeleteError(null);
    try {
      await deleteWorkItem(target.id);
    } catch (err) {
      logger.error(`删除工作项失败: ${String(err)}`);
      setDeleteError(t("workspace.deleteWorkItemFailed"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center gap-3 px-4 pt-4">
        <h1 className="shrink-0 text-base font-semibold text-gray-800 dark:text-gray-100">
          {t("workspace.workItemsTitle")}
        </h1>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {t("workspace.workItemsHint")}
        </span>
      </header>

      {/* 新建工作项（B3）：工作项的宿主是项目工作空间，故非项目时只给提示 */}
      <div className="mt-3 flex items-center gap-2 px-4">
        {isUserWorkspace ? (
          <>
            <input
              value={workItemTitle}
              onChange={(event) => setWorkItemTitle(event.target.value)}
              placeholder={t("workspace.workItemPlaceholder")}
              aria-label={t("workspace.workItemPlaceholder")}
              className="h-7 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
            <button
              type="button"
              disabled={!workItemTitle.trim() || creatingWorkItem}
              onClick={() => {
                void handleCreateWorkItem();
              }}
              className="shrink-0 rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
            >
              {t("workspace.newWorkItem")}
            </button>
            <button
              type="button"
              disabled={!workItemTitle.trim() || creatingWorkItem}
              onClick={() => {
                void handleEnterPlanning();
              }}
              title={t("workspace.enterPlanningHint")}
              className="shrink-0 rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
            >
              {t("workspace.enterPlanning")}
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("workspace.needProject")}
          </span>
        )}
      </div>

      {/* 工作项列表（V-37）：仅项目工作空间有工作项；删除入口 hover 显现 + 二次确认 */}
      {isUserWorkspace && workItems.length > 0 && (
        <ul className="mt-2 space-y-1 px-4">
          {workItems.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
            >
              <span
                className="truncate text-xs text-gray-700 dark:text-gray-200"
                title={item.title}
              >
                {item.title}
              </span>
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                {t(WORK_ITEM_STATUS_KEYS[item.status])}
              </span>
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                aria-label={`${t("common.delete")} ${item.title}`}
                onClick={() =>
                  setPendingDeleteItem({ id: item.id, title: item.title })
                }
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 删除失败的可见反馈（不静默吞掉，见 handleConfirmDeleteWorkItem） */}
      {isUserWorkspace && deleteError !== null && (
        <p className="mt-1 px-4 text-xs text-red-500" role="alert">
          {deleteError}
        </p>
      )}

      <ConfirmDialog
        open={pendingDeleteItem !== null}
        title={t("workspace.deleteWorkItemTitle")}
        message={t("workspace.deleteWorkItemConfirm", {
          title: pendingDeleteItem?.title ?? "",
        })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          void handleConfirmDeleteWorkItem();
        }}
        onCancel={() => setPendingDeleteItem(null)}
      />
    </div>
  );
}
