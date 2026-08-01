/**
 * ProjectView — 项目视图（/workspace/:workspaceId）
 *
 * 组合 SessionHistorySidebar + ChatArea，首次进入自动创建首个会话。
 * 顶部栏显示项目名称、路径和删除操作。
 */
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRootStore } from "@/stores/root-store";
import { chatCoordinator } from "@/stores/chat/chatCoordinator";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import SessionHistorySidebar from "@/components/ChatArea/SessionHistorySidebar";
import ChatArea from "@/components/ChatArea/ChatArea";

export default function ProjectView() {
  const { workspaceId, sessionId } = useParams<{
    workspaceId: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();
  const inited = useRef(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const switchWorktree = useRootStore((s) => s.switchWorktree);
  const switchSession = useRootStore((s) => s.switchSession);
  const createChatSession = useRootStore((s) => s.createChatSession);
  const deleteWorktree = useRootStore((s) => s.deleteWorktree);
  const wt = useRootStore((s) =>
    workspaceId ? s.worktrees[workspaceId] : undefined,
  );

  // 进入项目时初始化
  useEffect(() => {
    if (!workspaceId || !wt || inited.current) return;
    inited.current = true;
    const wid = workspaceId;

    async function init() {
      await switchWorktree(wid);

      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.worktreeId === wid,
      );
      if (projSessions.length === 0) {
        const id = await createChatSession("对话 1");
        if (id) {
          navigate(`/workspace/${wid}/${id.id}`, { replace: true });
        }
      }
    }

    init().catch((e) => {
      handleClientError(e, {
        module: "workspace:projectView",
        action: "init",
      });
    });
  }, [workspaceId]);

  // 切换到指定会话
  useEffect(() => {
    if (sessionId) {
      switchSession(sessionId);
    }
  }, [sessionId]);

  // 删除项目
  const handleDelete = async () => {
    if (!workspaceId) return;
    setDeleting(true);
    try {
      await chatCoordinator.stopMessage();

      // 级联删除该工作空间下的所有会话（后端 API）
      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.worktreeId === workspaceId,
      );
      for (const s of projSessions) {
        try {
          await sessionService.delete(s.id);
        } catch {
          // 单个会话删除失败不阻塞整体流程
        }
      }

      // 删除工作空间（后端 API + 前端状态）
      await deleteWorktree(workspaceId);

      navigate("/chat", { replace: true });
    } catch (e) {
      setDeleting(false);
      handleClientError(e, {
        module: "workspace:projectView",
        action: "deleteProject",
      });
    }
  };

  if (!wt) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        项目不存在
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">📁</span>
          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {wt.name}
          </span>
          {wt.path && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate hidden sm:inline">
              {wt.path}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="text-sm text-gray-400 hover:text-red-500 transition-colors px-2 py-1"
          title="删除项目"
        >
          删除
        </button>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 min-h-0">
        <SessionHistorySidebar />
        <ChatArea />
      </div>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(false);
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
              删除项目
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              将删除「{wt.name}」及其下的所有会话，此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
