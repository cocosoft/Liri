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
import { useAppStore } from "./stores/appStore";
import { useConfigStore } from "./stores/configStore";
import { useKeyboard } from "./hooks/useKeyboard";
import { useBuddyNotification } from "./hooks/useBuddyNotification";
import { useInitApp } from "./hooks/useInitApp";

function App() {
  const setActivePage = useAppStore((s) => s.setActivePage);
  const _setNavigate = useAppStore((s) => s._setNavigate);
  const { config } = useConfigStore();
  const location = useLocation();
  const navigate = useNavigate();

  const { initState, completeWizard } = useInitApp();

  useKeyboard();
  useBuddyNotification();

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
            {useRoutes(routes)}
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