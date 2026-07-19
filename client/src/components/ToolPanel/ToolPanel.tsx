import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/sessionStore";
import { cronService } from "../../services/cronService";
import { knowledgeService } from "../../services/knowledgeService";
import type { CronTask, KnowledgeBase } from "../../types";
import { PlusIcon, KnowledgeIcon, ChatIcon, Trash2Icon, FileIcon, SearchIcon, DevIcon, SettingsIcon, UserIcon, KeyIcon, ShieldIcon, BookOpenIcon, KeyboardIcon, InfoIcon, ChevronLeftIcon, ChevronRightIcon, UploadIcon, SlidersIcon, ModelIcon, CronIcon, HomeIcon, DashboardIcon, SkillIcon, McpIcon, TaskIcon } from "../../assets/icons";

/** 根据当前路由路径判断所属页面分类 */
function getRouteGroup(pathname: string): string {
  const p = pathname.replace(/^\//, "").split("/")[0] || "chat";
  // 顶级路由直接匹配
  const topLevel = ["chat", "knowledge", "cost", "cron", "files", "dashboard",
    "settings", "models", "tasks", "buddy", "memory", "dream"];
  if (topLevel.includes(p)) return p;
  // 子路由分组
  if (["dev", "terminal", "logs", "sandbox", "media", "autoreply", "voice-stt"].includes(p)) return "dev";
  if (p === "market" || p === "skill-market" || p === "skills") return "market";
  if (p === "user" || p === "apikeys" || p === "oauth" || p === "permissions") return "user";
  if (p === "help" || p === "docs" || p === "shortcuts") return "help";
  return "default";
}

function ContextPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    sessions,
    currentSession,
    createSession,
    switchSession,
    loadSessions,
    deleteSession,
    clearAllSessions,
  } = useSessionStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [cronTasks, setCronTasks] = useState<CronTask[]>([]);
  const [cronLoading, setCronLoading] = useState(true);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);

  useEffect(() => {
    let mounted = true;
    loadSessions().catch(() => {});
    cronService
      .list()
      .then((data) => {
        if (mounted) {
          setCronTasks(data);
          setCronLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setCronLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadSessions]);

  useEffect(() => {
    let mounted = true;
    knowledgeService
      .listBases()
      .then((bases) => {
        if (mounted) setKnowledgeBases(bases);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const currentRoute = getRouteGroup(location.pathname);

  const handleNewSession = () => {
    const title = `新会话 ${sessions.length + 1}`;
    createSession(title);
    navigate("/chat");
  };

  const renderChatContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          快捷操作
        </h3>
        <div className="space-y-1">
          <button
            onClick={handleNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <PlusIcon size={16} />
            <span>新建会话</span>
          </button>
          <button
            onClick={() => navigate("/knowledge")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <KnowledgeIcon size={16} />
            <span>搜索知识库</span>
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            最近会话
          </h3>
          {sessions.length > 0 && (
            <button
              onClick={() => {
                if (confirm("确定要清除所有会话记录吗？此操作不可恢复。")) {
                  clearAllSessions();
                }
              }}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
              title="清除所有会话"
            >
              清除全部
            </button>
          )}
        </div>
        <div className="space-y-1 h-full overflow-y-auto">
          {sessions.map((session) => {
            const isActive = currentSession?.id === session.id;
            return (
              <div
                key={session.id}
                className={`relative flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400"
                    : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                }`}
              >
                <button
                    onClick={() => {
                      switchSession(session.id);
                      navigate("/chat");
                    }}
                    className="flex-1 flex items-center gap-2 truncate text-left"
                  >
                    <ChatIcon size={16} />
                    <span className="truncate">
                      {session.title || "未命名会话"}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(
                          `确定要删除会话 "${session.title || "未命名会话"}" 吗？`,
                        )
                      ) {
                        deleteSession(session.id);
                      }
                    }}
                    className="opacity-0 hover:opacity-100 transition-opacity p-1 hover:text-red-500 dark:hover:text-red-400"
                  >
                    <Trash2Icon size={14} />
                  </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderKnowledgeContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          快捷操作
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/knowledge")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <KnowledgeIcon size={16} />
            <span>浏览知识库</span>
          </button>
          <button
            onClick={() => navigate("/knowledge")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <SearchIcon size={16} />
            <span>RAG 检索</span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          知识库
          <span className="ml-1 text-xs text-gray-400">
            ({knowledgeBases.length})
          </span>
        </h3>
        {knowledgeBases.length > 0 ? (
          <div className="space-y-1">
            {knowledgeBases.map((kb) => (
              <div
                key={kb.name}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors cursor-pointer"
                onClick={() => navigate("/knowledge")}
              >
                <FileIcon size={16} />
                <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                  {kb.label}
                </span>
                <span className="text-xs text-gray-400">{kb.docCount}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
            暂无知识库
          </div>
        )}
      </div>
    </div>
  );

  const renderCostContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          实时概览
        </h3>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">今日消费</span>
            <span className="font-medium text-gray-900 dark:text-white">
              ¥0.00
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">本周消费</span>
            <span className="font-medium text-gray-900 dark:text-white">
              ¥0.00
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCronContext = () => {
    const runningTasks = cronTasks.filter(
      (t) => t.enabled && t.status === "running",
    );
    const idleTasks = cronTasks.filter(
      (t) => t.enabled && t.status !== "running",
    );

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            快捷操作
          </h3>
          <div className="space-y-1">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors">
              <PlusIcon size={16} />
              <span>创建定时任务</span>
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            运行中的任务
            {runningTasks.length > 0 && (
              <span className="ml-1 text-xs text-blue-500">
                ({runningTasks.length})
              </span>
            )}
          </h3>
          {cronLoading ? (
            <div className="text-sm text-gray-400 px-3 py-2">加载中...</div>
          ) : runningTasks.length > 0 ? (
            <div className="space-y-1">
              {runningTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400 truncate">
                    {task.name}
                  </span>
                </div>
              ))}
            </div>
          ) : idleTasks.length > 0 ? (
            <div className="space-y-1">
              {idleTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      task.status === "error" ? "bg-red-500" : "bg-yellow-400"
                    }`}
                  />
                  <span className="text-gray-600 dark:text-gray-400 truncate">
                    {task.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
              暂无任务
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            任务统计
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
              <span className="block text-lg font-bold text-gray-900 dark:text-white">
                {cronTasks.length}
              </span>
              <span className="text-gray-500 dark:text-gray-400">总数</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
              <span className="block text-lg font-bold text-green-600">
                {runningTasks.length}
              </span>
              <span className="text-gray-500 dark:text-gray-400">运行中</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
              <span className="block text-lg font-bold text-yellow-600">
                {idleTasks.length}
              </span>
              <span className="text-gray-500 dark:text-gray-400">待命中</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFilesContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          快捷操作
        </h3>
        <div className="space-y-1">
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors">
              <UploadIcon size={16} />
              <span>上传文件</span>
            </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          最近文件
        </h3>
        <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
          暂无最近文件
        </div>
      </div>
    </div>
  );

  const renderDashboardContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          系统状态
        </h3>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-gray-600 dark:text-gray-400">Backend</span>
            <span className="ml-auto text-gray-900 dark:text-white">
              运行中
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDevContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          开发者工具
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/terminal")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <DevIcon size={16} />
            <span>终端</span>
          </button>
          <button
            onClick={() => navigate("/logs")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <SearchIcon size={16} />
            <span>日志查看</span>
          </button>
          <button
            onClick={() => navigate("/sandbox")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <SettingsIcon size={16} />
            <span>沙箱</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderMarketContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          市场
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/market")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <SkillIcon size={16} />
            <span>浏览技能市场</span>
          </button>
          <button
            onClick={() => navigate("/market")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <McpIcon size={16} />
            <span>浏览 MCP 市场</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderUserContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          用户中心
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/user")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <UserIcon size={16} />
            <span>个人资料</span>
          </button>
          <button
            onClick={() => navigate("/user")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <KeyIcon size={16} />
            <span>API 密钥</span>
          </button>
          <button
            onClick={() => navigate("/user")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <ShieldIcon size={16} />
            <span>权限管理</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderHelpContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          帮助
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/help")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <BookOpenIcon size={16} />
            <span>帮助文档</span>
          </button>
          <button
            onClick={() => navigate("/help")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <KeyboardIcon size={16} />
            <span>快捷键</span>
          </button>
          <button
            onClick={() => navigate("/help")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <InfoIcon size={16} />
            <span>关于 Liri</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderSettingsContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          设置
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/settings")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <SettingsIcon size={16} />
            <span>通用配置</span>
          </button>
          <button
            onClick={() => navigate("/settings")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <SlidersIcon size={16} />
            <span>深层配置</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderModelsContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          模型管理
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/models")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <ModelIcon size={16} />
            <span>浏览模型</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderTasksContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          任务中心
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/tasks")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <TaskIcon size={16} />
            <span>新建任务</span>
          </button>
          <button
            onClick={() => navigate("/cron")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <CronIcon size={16} />
            <span>定时任务</span>
          </button>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          运行中的 Cron
        </h3>
        {cronLoading ? (
          <div className="text-sm text-gray-400 px-3 py-2">加载中...</div>
        ) : (
          <div className="space-y-1">
            {cronTasks.filter((t) => t.enabled && t.status === "running")
              .length > 0 ? (
              cronTasks
                .filter((t) => t.enabled && t.status === "running")
                .slice(0, 5)
                .map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-2 rounded text-sm"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span className="text-gray-600 dark:text-gray-400 truncate">
                      {task.name}
                    </span>
                  </div>
                ))
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                暂无运行中的任务
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderDefaultContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          快速导航
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <HomeIcon size={16} />
            <span>返回聊天</span>
          </button>
          <button
            onClick={() => navigate("/chat")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <ChatIcon size={16} />
            <span>开始新会话</span>
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <DashboardIcon size={16} />
            <span>查看仪表盘</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderContextContent = () => {
    switch (currentRoute) {
      case "chat":
        return renderChatContext();
      case "knowledge":
        return renderKnowledgeContext();
      case "cost":
        return renderCostContext();
      case "cron":
        return renderCronContext();
      case "files":
        return renderFilesContext();
      case "dashboard":
        return renderDashboardContext();
      case "dev":
        return renderDevContext();
      case "market":
        return renderMarketContext();
      case "user":
        return renderUserContext();
      case "help":
        return renderHelpContext();
      case "settings":
        return renderSettingsContext();
      case "models":
        return renderModelsContext();
      case "tasks":
        return renderTasksContext();
      default:
        return renderDefaultContext();
    }
  };

  return (
    <div
      className={`bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col ${
        isExpanded ? "w-64" : "w-12"
      }`}
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-end">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 dark:text-gray-400 transition-colors"
          title={isExpanded ? "收起面板" : "展开面板"}
        >
          {isExpanded ? <ChevronLeftIcon size={16} /> : <ChevronRightIcon size={16} />}
        </button>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-3">
          {renderContextContent()}
        </div>
      )}
    </div>
  );
}

export default ContextPanel;
