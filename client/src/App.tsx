import { Suspense, useEffect, useState } from "react";
import { useRoutes, useLocation, useNavigate } from "react-router-dom";
import "./components/ChatArea/markdown-theme.css";
import Sidebar, { MobileBottomNav } from "./components/Sidebar/Sidebar";
import Header from "./components/common/Header";
import Footer from "./components/common/Footer";
import ConfigPanel from "./components/ConfigPanel/ConfigPanel";
import ToastContainer from "./components/common/ToastContainer";
import KeyboardShortcutsHelp from "./components/common/KeyboardShortcutsHelp";
import { FirstRunWizard } from "./components/views/FirstRunWizard";
import { LLMSetupGuide } from "./components/views/LLMSetupGuide";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { OperationStatusBar } from "./components/common/OperationStatusBar";
import { TooltipProvider } from "./components/ui/tooltip";
import routes from "./routes";
import { useConfigStore } from "./stores/configStore";
import { useChatStore } from "./stores/chat";
import { useSessionStore } from "./stores/sessionStore";
import { useNavigationStore } from "./stores/navigationStore";
import type { AppPage } from "./stores/navigationStore";
import { useRootStore } from "./stores/root-store";
import { registerBuiltinModules } from "./stores/root-store/moduleRegistry";
import { useKeyboard } from "./hooks/useKeyboard";
import { useBuddyNotification } from "./hooks/useBuddyNotification";
import { useNotificationSSE } from "./hooks/useNotificationSSE";
import NotificationPanel from "./components/views/NotificationPanel";
import { useInitApp } from "./hooks/useInitApp";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useAutoCreateSession } from "./hooks/useAutoCreateSession";
import SleepConfirmNotice from "./components/common/SleepConfirmNotice";
import EstopBanner from "./components/common/EstopBanner";
import QuickNoteModal from "./components/common/QuickNoteModal";
import GlobalSearchModal from "./components/ChatArea/GlobalSearchModal";

function App() {
  const syncActivePage = useNavigationStore((s) => s.syncActivePage);
  const _setNavigate = useNavigationStore((s) => s._setNavigate);
  const { config } = useConfigStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { initState, completeWizard } = useInitApp();

  // LLM 配置引导：ready 后检测是否已配置 AI 模型
  const [showLLMGuide, setShowLLMGuide] = useState(false);
  const [llmGuideChecked, setLlmGuideChecked] = useState(false);

  // D-j：全局速记浮层（Ctrl+Shift+N，由 useKeyboard 派发 open-quick-note 事件）
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  useEffect(() => {
    const open = () => setQuickNoteOpen(true);
    window.addEventListener("open-quick-note", open);
    return () => window.removeEventListener("open-quick-note", open);
  }, []);

  // H7/E-4：全局搜索（⌘K + Header 按钮）上提到应用层——应用级能力不寄生 UI 组件
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener("open-global-search", open);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("open-global-search", open);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // H6/E-5：自动更新轮询上提到应用层（原挂 Header 生命周期，Header 若被条件渲染则静默停止）
  const { startPeriodicCheck, stopPeriodicCheck } = useAutoUpdate();
  useEffect(() => {
    startPeriodicCheck(86400000);
    return () => stopPeriodicCheck();
  }, [startPeriodicCheck, stopPeriodicCheck]);

  useEffect(() => {
    if (initState.phase === "ready" && !llmGuideChecked) {
      setShowLLMGuide(true);
      setLlmGuideChecked(true);
    }
  }, [initState.phase, llmGuideChecked]);

  // Root Store: 工作空间初始化（与现有 stores 并行）
  const rootCurrentWorkspaceId = useRootStore((s) => s.currentWorkspaceId);
  const rootCreateWorkspace = useRootStore((s) => s.createWorkspace);
  const rootSwitchWorkspace = useRootStore((s) => s.switchWorkspace);

  // ⚠️ useRoutes 必须无条件调用，放在条件 return 之前
  // 否则初始化阶段走 early return 时不调用 useRoutes，
  // 初始化完成后才调用，会导致 React Hooks 顺序变化 → 白屏/崩溃
  const routeElement = useRoutes(routes);

  useKeyboard();
  useBuddyNotification();
  useNotificationSSE();
  useAutoCreateSession(); // Phase 7: URL 导航 → SessionHub 自动创建模块 session
  // useSessionBridge / useWorkspaceSync 已移除：同步逻辑已内置到 sessionStore / workspaceStore 中

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

  // 路由同步到 activePage（仅状态，不导航——导航会抹掉 query，破坏 /office?view=calendar 等深链）
  useEffect(() => {
    const path = location.pathname.replace("/", "");
    const page = path === "" ? "home" : path;
    syncActivePage(page as AppPage);
  }, [location.pathname, syncActivePage]);

  // 知识库"发送到对话"事件监听
  useEffect(() => {
    function handleAppendKnowledge(e: Event) {
      const detail = (e as CustomEvent).detail as
        { title: string; content: string } | undefined;
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
    return () =>
      window.removeEventListener(
        "liri:append-knowledge",
        handleAppendKnowledge,
      );
  }, [navigate]);

  // Root Store: 首次启动时自动创建默认工作空间 + 注册模块
  useEffect(() => {
    if (initState.phase !== "ready") return;

    // 注册内置模块视图组件
    registerBuiltinModules();

    if (rootCurrentWorkspaceId) return;

    // 创建默认工作空间
    const wtId = rootCreateWorkspace({
      name: "默认工作空间",
      path: ".",
      workspaceSource: "system",
    });
    rootSwitchWorkspace(wtId);
  }, [
    initState.phase,
    rootCurrentWorkspaceId,
    rootCreateWorkspace,
    rootSwitchWorkspace,
  ]);

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
        <EstopBanner />
        <Header />
        <OperationStatusBar />
        <ToastContainer />
        <NotificationPanel />
        <QuickNoteModal
          open={quickNoteOpen}
          onClose={() => setQuickNoteOpen(false)}
        />
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          isDark={config.theme === "dark"}
        />
        <div className="flex flex-1 overflow-hidden">
          <div className="hidden lg:block">
            <Sidebar />
          </div>
          <div className="flex-1 flex page-transition-enter overflow-hidden">
            <ErrorBoundary>
              <Suspense fallback={null}>{routeElement}</Suspense>
            </ErrorBoundary>
          </div>
        </div>
        <Footer />
        <MobileBottomNav />
        <ConfigPanel />
        <KeyboardShortcutsHelp />
        <SleepConfirmNotice />
        {initState.phase === "first_run_wizard" && (
          <FirstRunWizard onComplete={completeWizard} />
        )}
        {showLLMGuide && (
          <LLMSetupGuide onDismiss={() => setShowLLMGuide(false)} />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
