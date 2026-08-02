/**
 * ProjectsPage — 项目中心页（/projects）
 *
 * 参考 Microsoft Copilot Projects 页面布局：三栏结构
 *  ┌───────────┬─────────────────────────────────────┬───────────────────┐
 *  │ 左栏       │ 中栏                               │ 右栏 Creations    │
 *  │ 项目列表   │ 顶部标题 + 欢迎大标题 + 聊天区       │ Sources/Creations │
 *  │           │                                     │ 生成操作按钮      │
 *  └───────────┴─────────────────────────────────────┴───────────────────┘
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useRootStore } from "@/stores/root-store";
import { useChatStore } from "@/stores/chat";
import { chatCoordinator } from "@/stores/chat/chatCoordinator";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { triggerEngineHook } from "@/services/projectArtifactService";
import CreateProjectModal from "@/components/Workspace/CreateProjectModal";
import ChatArea from "@/components/ChatArea/ChatArea";
import { ProjectMaterialsPanel } from "@/components/project/ProjectMaterialsPanel";
import { ProjectDeliverablesPanel } from "@/components/project/ProjectDeliverablesPanel";
import { ProjectHistoryPanel } from "@/components/project/ProjectHistoryPanel";
import {
  DashboardIcon,
  ModelIcon,
  KnowledgeIcon,
  FileIcon,
  ZapIcon,
  UsersIcon,
} from "@/assets/icons";

/* ---------- 常量 ---------- */

interface CreationItem {
  id: string;
  label: string;
  path: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const CREATION_ITEMS: CreationItem[] = [
  {
    id: "summary",
    label: "摘要",
    path: "summary",
    description: "基于项目输入生成内容摘要与核心要点。",
    icon: ZapIcon,
  },
  {
    id: "podcast",
    label: "播客",
    path: "podcast",
    description: "将项目内容转化为可播放的对话式语音节目。",
    icon: UsersIcon,
  },
  {
    id: "study-guide",
    label: "学习指南",
    path: "study-guide",
    description: "生成分章节的结构化学习大纲与知识脉络。",
    icon: KnowledgeIcon,
  },
  {
    id: "quiz",
    label: "测验",
    path: "quiz",
    description: "围绕项目主题生成自测题目与答案解析。",
    icon: ModelIcon,
  },
  {
    id: "flashcards",
    label: "闪卡",
    path: "flashcards",
    description: "生成正反面问答记忆卡，用于复习和记忆。",
    icon: FileIcon,
  },
];

/** 按 id 查 CreationItem（供子页面读取） */
export function getCreationItem(id: string): CreationItem | undefined {
  return CREATION_ITEMS.find((c) => c.id === id);
}

/* ---------- 组件 ---------- */

export default function ProjectsPage() {
  // 模态框 & 选中状态
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSmartMenu, setShowSmartMenu] = useState(false);
  const inited = useRef<string | null>(null);
  const lastProcessedMsgId = useRef<string | null>(null);

  // Root Store 订阅
  const worktrees = useRootStore((s) => s.worktrees);
  const sessions = useRootStore((s) => s.sessions);
  const switchWorktree = useRootStore((s) => s.switchWorktree);
  const createChatSession = useRootStore((s) => s.createChatSession);
  const deleteWorktree = useRootStore((s) => s.deleteWorktree);
  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);
  const messages = useChatStore((s) => s.messages);

  useEffect(() => {
    enterModule({ moduleType: "project" });
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  // 隐性引擎钩子：检测新 assistant 消息并触发分析
  useEffect(() => {
    if (!selectedProjectId || messages.length === 0) return;

    const lastAssistantMsg = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistantMsg) return;
    if (lastProcessedMsgId.current === lastAssistantMsg.id) return;
    lastProcessedMsgId.current = lastAssistantMsg.id;

    triggerEngineHook(selectedProjectId, lastAssistantMsg.content).catch(() => {
      /* 隐性引擎失败不阻塞 UI */
    });
  }, [messages, selectedProjectId]);

  // 仅显示用户创建的项目（workspaceSource === "user"）
  const projects = useMemo(
    () => Object.values(worktrees).filter((w) => w.workspaceSource === "user"),
    [worktrees],
  );

  const selectedProject = selectedProjectId
    ? worktrees[selectedProjectId]
    : undefined;

  /* ---- 进入项目时初始化：切换 worktree + 自动创建首个会话 ---- */
  useEffect(() => {
    if (
      !selectedProjectId ||
      !selectedProject ||
      inited.current === selectedProjectId
    )
      return;
    inited.current = selectedProjectId;
    const wid = selectedProjectId;

    async function init() {
      await switchWorktree(wid);
      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.worktreeId === wid,
      );
      if (projSessions.length === 0) {
        await createChatSession("对话 1");
      }
    }
    init().catch((e) =>
      handleClientError(e, {
        module: "projects:page",
        action: "initProject",
      }),
    );
  }, [selectedProjectId, selectedProject, switchWorktree, createChatSession]);

  const handleSelectProject = (id: string) => {
    if (id !== selectedProjectId) {
      inited.current = null;
      setSelectedProjectId(id);
    }
  };

  /* ---- 删除项目 ---- */
  const handleDelete = async () => {
    if (!selectedProjectId) return;
    setDeleting(true);
    try {
      await chatCoordinator.stopMessage();
      const state = useRootStore.getState();
      const projSessions = Object.values(state.sessions).filter(
        (s) => s.worktreeId === selectedProjectId,
      );
      for (const s of projSessions) {
        try {
          await sessionService.delete(s.id);
        } catch {
          /* @ignore-catch 单个会话删除失败不阻塞 */
        }
      }
      await deleteWorktree(selectedProjectId);
      setSelectedProjectId(null);
      setShowDeleteConfirm(false);
    } catch (e) {
      setDeleting(false);
      handleClientError(e, {
        module: "projects:page",
        action: "deleteProject",
      });
    }
  };

  const getSessionCount = (workspaceId: string) =>
    Object.values(sessions).filter((s) => s.worktreeId === workspaceId).length;

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-1 h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* ======================================== */}
      {/*  左栏：项目列表                           */}
      {/* ======================================== */}
      <aside className="w-56 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <DashboardIcon
              size={16}
              className="text-gray-500 dark:text-gray-400"
            />
            项目
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            title="新建项目"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>

        {/* 项目列表 */}
        <div className="flex-1 overflow-y-auto">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-3">
              <DashboardIcon
                size={32}
                className="mb-2 text-gray-300 dark:text-gray-600"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                暂无项目
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-2 text-xs text-blue-600 dark:text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
              >
                创建第一个项目
              </button>
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectProject(p.id)}
                className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                  selectedProjectId === p.id
                    ? "bg-gray-100 dark:bg-gray-800 border-l-2 border-l-blue-600 dark:border-l-blue-500"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <DashboardIcon
                    size={14}
                    className="text-gray-400 dark:text-gray-500 flex-shrink-0"
                  />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {p.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-6">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {getSessionCount(p.id)} 个会话
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ======================================== */}
      {/*  中栏：项目主区域                          */}
      {/* ======================================== */}
      <main className="flex-1 flex flex-col min-w-0">
        {selectedProject ? (
          <>
            {/* ---------- 顶部标题栏 ---------- */}
            <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base font-medium text-gray-800 dark:text-gray-100 truncate">
                  {selectedProject.name}
                </span>
              </div>
              <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                {/* 搜索图标 */}
                <button
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="搜索"
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
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </button>
                {/* 删除/设置菜单 */}
                <div className="relative">
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="项目操作"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            {/* ---------- 内容主体（ChatArea 包裹） ---------- */}
            <div className="flex-1 min-h-0 flex flex-col relative bg-white dark:bg-gray-900">
              {/* 无消息时显示欢迎大标题 */}
              {!hasMessages && (
                <div className="px-8 pt-16 pb-6 flex justify-center">
                  <h1 className="text-2xl md:text-3xl font-semibold text-gray-800 dark:text-gray-100 text-center leading-tight">
                    准备开始「{selectedProject.name}」项目了吗？
                  </h1>
                </div>
              )}

              {/* ChatArea：消息列表 + 输入框 — fluid 模式，项目页全宽无 max-w-3xl 居中 */}
              <div className="flex-1 min-h-0">
                <ChatArea fluid />
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-500">
            <DashboardIcon
              size={48}
              className="mb-3 text-gray-300 dark:text-gray-700"
            />
            <p className="text-lg mb-1 font-medium text-gray-700 dark:text-gray-300">
              请选择一个项目
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-600">
              从左侧列表中选择项目开始
            </p>
          </div>
        )}
      </main>

      {/* ======================================== */}
      {/*  右栏：资料 / 成果 / 讨论记录              */}
      {/* ======================================== */}
      <aside className="w-72 border-l border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
        {/* -- 项目资料 -- */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            项目资料
          </div>
          <div className="max-h-40 overflow-y-auto">
            {selectedProjectId ? (
              <ProjectMaterialsPanel projectId={selectedProjectId} />
            ) : (
              <div className="p-4 text-sm text-gray-400 text-center">请先选择项目</div>
            )}
          </div>
        </div>

        {/* -- 成果 -- */}
        <div className="flex-1 overflow-y-auto border-b border-gray-100 dark:border-gray-800">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            成果
          </div>
          {selectedProjectId ? (
            <ProjectDeliverablesPanel projectId={selectedProjectId} />
          ) : (
            <div className="p-4 text-sm text-gray-400 text-center">请先选择项目</div>
          )}
        </div>

        {/* -- 讨论记录 -- */}
        <div className="max-h-48 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            讨论记录
          </div>
          {selectedProjectId ? (
            <ProjectHistoryPanel projectId={selectedProjectId} />
          ) : (
            <div className="p-4 text-sm text-gray-400 text-center">请先选择项目</div>
          )}
        </div>
      </aside>

      {/* ---------- Smart 菜单（输入框左侧下拉，浮层预留位） ---------- */}
      {showSmartMenu && (
        <div className="fixed z-50" onClick={() => setShowSmartMenu(false)} />
      )}

      {/* ---------- 新建项目弹窗 ---------- */}
      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} />
      )}

      {/* ---------- 删除确认弹窗 ---------- */}
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
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              这将删除{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                「{selectedProject?.name}」
              </span>{" "}
              及其下所有会话。此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deleting ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
