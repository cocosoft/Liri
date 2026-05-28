import { useEffect, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import './components/ChatArea/markdown-theme.css';
import Sidebar from './components/Sidebar/Sidebar';
import Header from './components/common/Header';
import Footer from './components/common/Footer';
import ChatArea from './components/ChatArea/ChatArea';
import ChatInput from './components/ChatArea/ChatInput';
import ToolPanel from './components/ToolPanel/ToolPanel';
import ConfigPanel from './components/ConfigPanel/ConfigPanel';
import ToastContainer from './components/common/ToastContainer';
import KeyboardShortcutsHelp from './components/common/KeyboardShortcutsHelp';
import AuthGuard from './components/common/AuthGuard';
import LoginPage from './components/views/LoginPage';
import ApiKeyPage from './components/views/ApiKeyPage';
import MonitorPage from './components/views/MonitorPage';
import LogViewerPage from './components/views/LogViewerPage';
import MemoryPage from './components/views/MemoryPage';
import SkillPage from './components/views/SkillPage';
import DashboardPage from './components/views/DashboardPage';
import FileExplorerPage from './components/views/FileExplorerPage';
import TerminalPage from './components/views/TerminalPage';
import CostPage from './components/views/CostPage';
import PluginsPage from './components/views/PluginsPage';
import HelpPage from './components/views/HelpPage';
import SandboxPage from './components/views/SandboxPage';
import PermissionPage from './components/views/PermissionPage';
import KnowledgePage from './components/views/KnowledgePage';
import KnowledgeEnhancedPage from './components/views/KnowledgeEnhancedPage';
import AgentPage from './components/views/AgentPage';
import AgentAdvancedPage from './components/views/AgentAdvancedPage';
import CronPage from './components/views/CronPage';
import ChannelsPage from './components/views/ChannelsPage';
import ChannelsDeepPage from './components/views/ChannelsDeepPage';
import SettingsPage from './components/views/SettingsPage';
import ConfigDeepPage from './components/views/ConfigDeepPage';
import BuddyPage from './components/views/BuddyPage';
import OAuthPage from './components/views/OAuthPage';
import MediaPage from './components/views/MediaPage';
import AutoReplyPage from './components/views/AutoReplyPage';
import HomePage from './components/views/HomePage';
import { FirstRunWizard } from './components/views/FirstRunWizard';
import { useSessionStore } from './stores/sessionStore';
import { useAppStore } from './stores/appStore';
import { useBackendStore } from './stores/backendStore';
import { useConfigStore } from './stores/configStore';
import { useKeyboard } from './hooks/useKeyboard';
import { useBuddyNotification } from './hooks/useBuddyNotification';
import { sseService } from './services/sseService';
import { appConfigService } from './services/appConfigService';
import { initBackendUrlFromConfig } from './services/backendUrl';

function App() {
  const { loadSessions, createSession, sessions, currentSession } = useSessionStore();
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
    if (config.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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

    sseService.on('heartbeat', checkBackendStatus);
    sseService.connect();

    return () => {
      sseService.off('heartbeat', checkBackendStatus);
      sseService.disconnect();
    };
  }, [checkBackendStatus, showFirstRun]);

  useEffect(() => {
    _setNavigate(navigate);
  }, [_setNavigate, navigate]);

  useEffect(() => {
    if (sessions.length === 0 && !currentSession) {
      createSession('第一个会话');
    }
  }, [sessions.length, currentSession, createSession]);

  useEffect(() => {
    const path = location.pathname.replace('/', '');
    const page = path === '' ? 'home' : path;
    setActivePage(page as any);
  }, [location.pathname, setActivePage]);

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex page-transition-enter overflow-hidden">
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/apikeys" element={<ApiKeyPage />} />
          <Route path="/" element={<AuthGuard><HomePage /></AuthGuard>} />
          <Route path="/chat" element={
            <main className="flex-1 flex flex-col page-transition-enter">
              <ChatArea />
              <ChatInput />
            </main>
          } />
          <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
          <Route path="/monitor" element={<AuthGuard><MonitorPage /></AuthGuard>} />
          <Route path="/logs" element={<AuthGuard><LogViewerPage /></AuthGuard>} />
          <Route path="/files" element={<AuthGuard><FileExplorerPage /></AuthGuard>} />
          <Route path="/terminal" element={<AuthGuard><TerminalPage /></AuthGuard>} />
          <Route path="/cost" element={<AuthGuard><CostPage /></AuthGuard>} />
          <Route path="/plugins" element={<AuthGuard><PluginsPage /></AuthGuard>} />
          <Route path="/help" element={<AuthGuard><HelpPage /></AuthGuard>} />
          <Route path="/sandbox" element={<AuthGuard><SandboxPage /></AuthGuard>} />
          <Route path="/permissions" element={<AuthGuard><PermissionPage /></AuthGuard>} />
          <Route path="/oauth" element={<AuthGuard><OAuthPage /></AuthGuard>} />
          <Route path="/media" element={<AuthGuard><MediaPage /></AuthGuard>} />
          <Route path="/autoreply" element={<AuthGuard><AutoReplyPage /></AuthGuard>} />
          <Route path="/knowledge" element={<AuthGuard><KnowledgePage /></AuthGuard>} />
          <Route path="/knowledge/enhanced" element={<AuthGuard><KnowledgeEnhancedPage /></AuthGuard>} />
          <Route path="/memory" element={<AuthGuard><MemoryPage /></AuthGuard>} />
          <Route path="/skills" element={<AuthGuard><SkillPage /></AuthGuard>} />
          <Route path="/agent" element={<AuthGuard><AgentPage /></AuthGuard>} />
          <Route path="/agent/advanced" element={<AuthGuard><AgentAdvancedPage /></AuthGuard>} />
          <Route path="/cron" element={<AuthGuard><CronPage /></AuthGuard>} />
          <Route path="/channels" element={<AuthGuard><ChannelsPage /></AuthGuard>} />
          <Route path="/channels/deep" element={<AuthGuard><ChannelsDeepPage /></AuthGuard>} />
          <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
          <Route path="/settings/deep" element={<AuthGuard><ConfigDeepPage /></AuthGuard>} />
          <Route path="/buddy" element={<AuthGuard><BuddyPage /></AuthGuard>} />
          </Routes>
        </div>
        <ToolPanel />
      </div>
      <Footer />
      <ConfigPanel />
      <ToastContainer />
      <KeyboardShortcutsHelp />
      {showFirstRun && <FirstRunWizard onComplete={() => setShowFirstRun(false)} />}
    </div>
  );
}

export default App;
