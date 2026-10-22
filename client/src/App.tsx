import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useKeyboard } from "./hooks/useKeyboard";
import { useBuddyNotification } from "./hooks/useBuddyNotification";
import { useNotificationSSE } from "./hooks/useNotificationSSE";
import NotificationPanel from "./components/views/NotificationPanel";
import SettingsPanel from "./components/settings/SettingsPanel";
import { useInitApp } from "./hooks/useInitApp";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useAutoCreateSession } from "./hooks/useAutoCreateSession";
import SleepConfirmNotice from "./components/common/SleepConfirmNotice";
import EstopBanner from "./components/common/EstopBanner";
import QuickNoteModal from "./components/common/QuickNoteModal";
import GlobalSearchModal from "./components/ChatArea/GlobalSearchModal";
import { APP_EVENTS } from "./constants/events";

function App() {
  const { t } = useTranslation();
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
    window.addEventListener(APP_EVENTS.openQuickNote, open);
    return () => window.removeEventListener(APP_EVENTS.openQuickNote, open);
  }, []);

  // H7/E-4：全局搜索（⌘K + Header 按钮）上提到应用层——应用级能力不寄生 UI 组件
  const [searchOpen, setSearchOpen] = useState(false);
  // §4.2-4（方案 B）：`/search 关键词` 经同一事件通道携带关键词
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  useEffect(() => {
    const open = (e: Event) => {
      const query = (e as CustomEvent<{ query?: string }>).detail?.query ?? "";
      setSearchInitialQuery(query);
      setSearchOpen(true);
    };
    window.addEventListener(APP_EVENTS.openGlobalSearch, open);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchInitialQuery("");
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(APP_EVENTS.openGlobalSearch, open);
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
        content: `${t("chat.knowledgeDocRef", { title: detail.title })}\n\n${detail.content}`,
        timestamp: Date.now(),
        session_id: sessionId,
      };
      chatState.addMessage(systemMsg);

      // 导航到聊天页
      navigate("/");
    }

    window.addEventListener(APP_EVENTS.appendKnowledge, handleAppendKnowledge);
    return () =>
      window.removeEventListener(
        APP_EVENTS.appendKnowledge,
        handleAppendKnowledge,
      );
  }, [navigate, t]);

  // Root Store: 首次启动时自动创建默认工作空间
  useEffect(() => {
    if (initState.phase !== "ready") return;

    if (rootCurrentWorkspaceId) return;

    // 创建默认工作空间
    const wtId = rootCreateWorkspace({
      name: t("workspace.defaultName"),
      path: ".",
      workspaceSource: "system",
    });
    rootSwitchWorkspace(wtId);
  }, [
    initState.phase,
    rootCurrentWorkspaceId,
    rootCreateWorkspace,
    rootSwitchWorkspace,
    t,
  ]);

  // 初始化未完成 / 加载失败时显示过渡态
  if (initState.phase !== "ready" && initState.phase !== "first_run_wizard") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        {initState.phase === "error" ? (
          <div className="text-center">
            <div className="text-red-500 text-lg mb-2">
              {t("common.initFailed")}
            </div>
            <div className="text-sm text-gray-500">{initState.error}</div>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">
            {t("common.initializing")}
          </div>
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
        <SettingsPanel />
        <QuickNoteModal
          open={quickNoteOpen}
          onClose={() => setQuickNoteOpen(false)}
        />
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => {
            setSearchOpen(false);
            setSearchInitialQuery("");
          }}
          isDark={config.theme === "dark"}
          initialQuery={searchInitialQuery}
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
        {/* 移动端底栏是 fixed（脱离文档流）⇒ 必须显式让出等高的占位，
            否则最底部的状态栏会被底栏压住（768 视口实测：Footer y=992..1024、
            底栏 y=975..1024，状态栏完全不可见）。高度取底栏实测高度 50px。 */}
        <div className="lg:hidden h-[50px] shrink-0" aria-hidden="true" />
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
