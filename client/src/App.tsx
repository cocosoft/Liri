import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import "./components/ChatArea/markdown-theme.css";
import Sidebar, { MobileBottomNav } from "./components/Sidebar/Sidebar";
import Header from "./components/common/Header";
import Footer from "./components/common/Footer";
import ChatArea from "./components/ChatArea/ChatArea";
import ChatInput from "./components/ChatArea/ChatInput";
import SessionHeader from "./components/ChatArea/SessionHeader";
import ToolPanel from "./components/ToolPanel/ToolPanel";
import FilePreviewPanel from "./components/ChatArea/FilePreviewPanel";
import SessionHistorySidebar from "./components/ChatArea/SessionHistorySidebar";
import ConfigPanel from "./components/ConfigPanel/ConfigPanel";
import ToastContainer from "./components/common/ToastContainer";
import KeyboardShortcutsHelp from "./components/common/KeyboardShortcutsHelp";
import AuthGuard from "./components/common/AuthGuard";
import LoginPage from "./components/views/LoginPage";
import MemoryPage from "./components/views/MemoryPage";
import SkillPage from "./components/views/SkillPage";
import DashboardPage from "./components/views/DashboardPage";
import FileExplorerPage from "./components/views/FileExplorerPage";
import CostPage from "./components/views/CostPage";
import KnowledgePage from "./components/views/KnowledgePage";
import AgentPage from "./components/views/AgentPage";
import AgentAdvancedPage from "./components/views/AgentAdvancedPage";
import CronPage from "./components/views/CronPage";
import DreamPage from "./components/views/DreamPage";
import TaskCenterPage from "./components/views/TaskCenterPage";
import ChannelsPage from "./components/views/ChannelsPage";
import SettingsPage from "./components/views/SettingsPage";
import BuddyPage from "./components/views/BuddyPage";
import SkillMarketPage from "./components/views/SkillMarketPage";
import UserPage from "./components/views/UserPage";
import HelpPage from "./components/views/HelpPage";
import MCPMarketPage from "./components/views/MCPMarketPage";
import ModelPage from "./components/views/ModelPage";
import DevPage from "./components/views/DevPage";
import HomePage from "./components/views/HomePage";
import { FirstRunWizard } from "./components/views/FirstRunWizard";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";
import { useSessionStore } from "./stores/sessionStore";
import { useAppStore } from "./stores/appStore";
import { useBackendStore } from "./stores/backendStore";
import { useConfigStore } from "./stores/configStore";
import { useKeyboard } from "./hooks/useKeyboard";
import { useBuddyNotification } from "./hooks/useBuddyNotification";
import { sseService } from "./services/sseService";
import { appConfigService } from "./services/appConfigService";
import { initBackendUrlFromConfig } from "./services/backendUrl";

function App() {
  const { loadSessions } = useSessionStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const _setNavigate = useAppStore((s) => s._setNavigate);
  const checkBackendStatus = useBackendStore((s) => s.checkStatus);
  const { config, loadConfig } = useConfigStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [showFirstRun, setShowFirstRun] = useState(true);

  useKeyboard();
  useBuddyNotification();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [config.theme]);

  useEffect(() => {
    appConfigService.isFirstRun().then((firstRun) => {
      setShowFirstRun(firstRun);
    });
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (showFirstRun) return;

    const initBackend = async () => {
      const { initBrowserMode } = useBackendStore.getState();
      await initBrowserMode();
      await initBackendUrlFromConfig();
      await checkBackendStatus();
      const { status, startBackend } = useBackendStore.getState();
      if (!status.running) {
        await startBackend();
      }
    };
    initBackend();

    sseService.on("heartbeat", checkBackendStatus);
    sseService.connect();

    return () => {
      sseService.off("heartbeat", checkBackendStatus);
      sseService.disconnect();
    };
  }, [checkBackendStatus, showFirstRun]);

  useEffect(() => {
    _setNavigate(navigate);
  }, [_setNavigate, navigate]);

  useEffect(() => {
    const path = location.pathname.replace("/", "");
    const page = path === "" ? "home" : path;
    setActivePage(page as any);
  }, [location.pathname, setActivePage]);

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
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <HomePage />
                </AuthGuard>
              }
            />
            <Route
              path="/chat"
              element={
                <div className="flex flex-1 page-transition-enter overflow-hidden">
                  <SessionHistorySidebar />
                  <main className="flex-1 flex flex-col min-w-0">
                    <SessionHeader />
                    <ChatArea />
                    <ChatInput />
                  </main>
                </div>
              }
            />
            <Route
              path="/dashboard"
              element={
                <AuthGuard>
                  <DashboardPage />
                </AuthGuard>
              }
            />
            <Route
              path="/files"
              element={
                <AuthGuard>
                  <FileExplorerPage />
                </AuthGuard>
              }
            />
            <Route
              path="/cost"
              element={
                <AuthGuard>
                  <CostPage />
                </AuthGuard>
              }
            />
            <Route
              path="/knowledge"
              element={
                <AuthGuard>
                  <KnowledgePage />
                </AuthGuard>
              }
            />
            <Route
              path="/dev"
              element={<Navigate to="/dev/terminal" replace />}
            />
            <Route
              path="/dev/:subPage"
              element={
                <AuthGuard>
                  <DevPage />
                </AuthGuard>
              }
            />

            <Route
              path="/memory"
              element={
                <AuthGuard>
                  <MemoryPage />
                </AuthGuard>
              }
            />
            <Route
              path="/skills"
              element={
                <AuthGuard>
                  <SkillPage />
                </AuthGuard>
              }
            />
            <Route
              path="/agent"
              element={
                <AuthGuard>
                  <AgentPage />
                </AuthGuard>
              }
            />
            <Route
              path="/agent/advanced"
              element={
                <AuthGuard>
                  <AgentAdvancedPage />
                </AuthGuard>
              }
            />
            <Route
              path="/cron"
              element={
                <AuthGuard>
                  <CronPage />
                </AuthGuard>
              }
            />
            <Route
              path="/dream"
              element={
                <AuthGuard>
                  <DreamPage />
                </AuthGuard>
              }
            />
            <Route
              path="/tasks"
              element={
                <AuthGuard>
                  <TaskCenterPage />
                </AuthGuard>
              }
            />
            <Route
              path="/channels"
              element={
                <AuthGuard>
                  <ChannelsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard>
                  <SettingsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/user"
              element={
                <AuthGuard>
                  <UserPage />
                </AuthGuard>
              }
            />
            <Route
              path="/help"
              element={
                <AuthGuard>
                  <HelpPage />
                </AuthGuard>
              }
            />
            <Route
              path="/buddy"
              element={
                <AuthGuard>
                  <BuddyPage />
                </AuthGuard>
              }
            />
            <Route
              path="/market/skills"
              element={
                <AuthGuard>
                  <SkillMarketPage />
                </AuthGuard>
              }
            />
            <Route
              path="/market/mcp"
              element={
                <AuthGuard>
                  <MCPMarketPage />
                </AuthGuard>
              }
            />
            <Route
              path="/models"
              element={
                <AuthGuard>
                  <ModelPage />
                </AuthGuard>
              }
            />
            <Route
              path="/plans"
              element={<Navigate to="/tasks" replace />}
            />
            <Route
              path="/semantic"
              element={<Navigate to="/knowledge" replace />}
            />
            {/* 开发者工具路由归集 */}
            <Route
              path="/logs"
              element={<Navigate to="/dev/logs" replace />}
            />
            <Route
              path="/voice-stt"
              element={<Navigate to="/dev/stt-test" replace />}
            />
            <Route
              path="/terminal"
              element={<Navigate to="/dev/terminal" replace />}
            />
            <Route
              path="/sandbox"
              element={<Navigate to="/dev/sandbox" replace />}
            />
            <Route
              path="/media"
              element={<Navigate to="/dev/media" replace />}
            />
            <Route
              path="/autoreply"
              element={<Navigate to="/dev/autoreply" replace />}
            />
          </Routes>
          </ErrorBoundary>
        </div>
      {/* 右侧面板：按页面联动 */}
        {(() => {
          // 全宽页面（不显示右侧面板）
          const fullWidthPages = ["/settings", "/help", "/user", "/dashboard", "/login",
            "/buddy", "/dream", "/memory", "/skills", "/market/skills", "/market/mcp"];
          if (fullWidthPages.includes(location.pathname)) return null;

          // 聊天页面显示文件预览
          if (location.pathname === "/chat" || location.pathname === "/") {
            return <FilePreviewPanel />;
          }

          // 其余页面显示上下文面板
          return <ToolPanel />;
        })()}
      </div>
      <Footer />
      <MobileBottomNav />
      <ConfigPanel />
      <ToastContainer />
      <KeyboardShortcutsHelp />
      {showFirstRun && (
        <FirstRunWizard onComplete={() => setShowFirstRun(false)} />
      )}
    </div>
    </TooltipProvider>
  );
}

export default App;
