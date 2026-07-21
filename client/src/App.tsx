import { Suspense, useEffect } from "react";
import { useRoutes, useLocation, useNavigate } from "react-router-dom";
import "./components/ChatArea/markdown-theme.css";
import Sidebar, { MobileBottomNav } from "./components/Sidebar/Sidebar";
import Header from "./components/common/Header";
import Footer from "./components/common/Footer";
import { RightPanelRouter } from "./components/common/RightPanelRouter";
import ConfigPanel from "./components/ConfigPanel/ConfigPanel";
import ToastContainer from "./components/common/ToastContainer";
import KeyboardShortcutsHelp from "./components/common/KeyboardShortcutsHelp";
import { FirstRunWizard } from "./components/views/FirstRunWizard";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";
import routes from "./routes";
import { useConfigStore } from "./stores/configStore";
import { useChatStore } from "./stores/chatStore";
import { useSessionStore } from "./stores/sessionStore";
import { useNavigationStore } from "./stores/navigationStore";
import { useRootStore } from "./stores/root-store";
import { registerBuiltinModules } from "./stores/root-store/moduleRegistry";
import { useKeyboard } from "./hooks/useKeyboard";
import { useBuddyNotification } from "./hooks/useBuddyNotification";
import { useInitApp } from "./hooks/useInitApp";
import { useAutoCreateSession } from "./hooks/useAutoCreateSession";

function App() {
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const _setNavigate = useNavigationStore((s) => s._setNavigate);
  const { config } = useConfigStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { initState, completeWizard } = useInitApp();

  // Root Store: 工作空间初始化（与现有 stores 并行）
  const rootCurrentWorktreeId = useRootStore((s) => s.currentWorktreeId);
  const rootCreateWorktree = useRootStore((s) => s.createWorktree);
  const rootSwitchWorktree = useRootStore((s) => s.switchWorktree);

  // ⚠️ useRoutes 必须无条件调用，放在条件 return 之前
  // 否则初始化阶段走 early return 时不调用 useRoutes，
  // 初始化完成后才调用，会导致 React Hooks 顺序变化 → 白屏/崩溃
  const routeElement = useRoutes(routes);

  useKeyboard();
  useBuddyNotification();
  useAutoCreateSession(); // Phase 7: URL 导航 → SessionHub 自动创建模块 session
  // useSessionBridge / useWorktreeSync 已移除：同步逻辑已内置到 sessionStore / workspaceStore 中

  // 主题切换
  useEffect(() => {
    if (config.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [config.theme]);

  // 导航同步
  useEffect(() => {
    _setNavigate(navigate);
  }, [_setNavigate, navigate]);

  // 路由同步到 activePage
  useEffect(() => {
    const path = location.pathname.replace("/", "");
    const page = path === "" ? "home" : path;
    setActivePage(page as any);
  }, [location.pathname, setActivePage]);

  // 知识库"发送到对话"事件监听
  useEffect(() => {
    function handleAppendKnowledge(e: Event) {
      const detail = (e as CustomEvent).detail as { title: string; content: string } | undefined;
      if (!detail?.content) return;

      const sessionState = useSessionStore.getState();
      const sessionId = sessionState.currentSession?.id;
      if (!sessionId) {
        // 无当前会话时，先导航到聊天页让系统自动创建会话
        navigate("/");
        return;
      }

      const chatState = useChatStore.getState();
      const systemMsg = {
        id: crypto.randomUUID(),
        role: "system" as const,
        content: `[知识库文档: ${detail.title}]\n\n${detail.content}`,
        timestamp: Date.now(),
        session_id: sessionId,
      };
      chatState.addMessage(systemMsg);

      // 导航到聊天页
      navigate("/");
    }

    window.addEventListener("liri:append-knowledge", handleAppendKnowledge);
    return () => window.removeEventListener("liri:append-knowledge", handleAppendKnowledge);
  }, [navigate]);

  // Root Store: 首次启动时自动创建默认工作空间 + 注册模块
  useEffect(() => {
    if (initState.phase !== "ready") return;

    // 注册内置模块视图组件
    registerBuiltinModules();

    if (rootCurrentWorktreeId) return;

    // 创建默认工作空间
    const wtId = rootCreateWorktree({ name: "默认工作空间", path: "." });
    rootSwitchWorktree(wtId);
  }, [initState.phase, rootCurrentWorktreeId, rootCreateWorktree, rootSwitchWorktree]);

  // 初始化未完成 / 加载失败时显示过渡态
  if (initState.phase !== "ready" && initState.phase !== "first_run_wizard") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        {initState.phase === "error" ? (
          <div className="text-center">
            <div className="text-red-500 text-lg mb-2">初始化失败</div>
            <div className="text-sm text-gray-500">{initState.error}</div>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">正在初始化...</div>
        )}
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden lg:block">
          <Sidebar />
        </div>
        <div className="flex-1 flex page-transition-enter overflow-hidden">
          <ErrorBoundary>
          <Suspense fallback={null}>
            {routeElement}
          </Suspense>
          </ErrorBoundary>
        </div>
      {/* 右侧面板：配置驱动 */}
        <RightPanelRouter />
      </div>
      <Footer />
      <MobileBottomNav />
      <ConfigPanel />
      <ToastContainer />
      <KeyboardShortcutsHelp />
      {initState.phase === "first_run_wizard" && (
        <FirstRunWizard onComplete={completeWizard} />
      )}
    </div>
    </TooltipProvider>
  );
}

export default App;