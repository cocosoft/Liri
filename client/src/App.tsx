import { useEffect, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import './components/ChatArea/markdown-theme.css';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import ChatInput from './components/ChatArea/ChatInput';
import ToolPanel from './components/ToolPanel/ToolPanel';
import ConfigPanel from './components/ConfigPanel/ConfigPanel';
import ToastContainer from './components/common/ToastContainer';
import KeyboardShortcutsHelp from './components/common/KeyboardShortcutsHelp';
import DashboardPage from './components/views/DashboardPage';
import FileExplorerPage from './components/views/FileExplorerPage';
import KnowledgePage from './components/views/KnowledgePage';
import AgentPage from './components/views/AgentPage';
import CronPage from './components/views/CronPage';
import ChannelsPage from './components/views/ChannelsPage';
import SettingsPage from './components/views/SettingsPage';
import BuddyPage from './components/views/BuddyPage';
import { FirstRunWizard } from './components/views/FirstRunWizard';
import { useSessionStore } from './stores/sessionStore';
import { useAppStore } from './stores/appStore';
import { useBackendStore } from './stores/backendStore';
import { useKeyboard } from './hooks/useKeyboard';
import { useBuddyNotification } from './hooks/useBuddyNotification';
import { sseService } from './services/sseService';
import { appConfigService } from './services/appConfigService';

function App() {
  const { loadSessions, createSession, sessions, currentSession } = useSessionStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const _setNavigate = useAppStore((s) => s._setNavigate);
  const checkBackendStatus = useBackendStore((s) => s.checkStatus);
  const location = useLocation();
  const navigate = useNavigate();
  const [showFirstRun, setShowFirstRun] = useState(true);

  useKeyboard();
  useBuddyNotification();

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

    checkBackendStatus();

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
    const page = location.pathname.replace('/', '') || 'chat';
    setActivePage(page as any);
  }, [location.pathname, setActivePage]);

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex page-transition-enter">
        <Routes>
          <Route path="/" element={
            <main className="flex-1 flex flex-col page-transition-enter">
              <ChatArea />
              <ChatInput />
            </main>
          } />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/files" element={<FileExplorerPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/cron" element={<CronPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/buddy" element={<BuddyPage />} />
        </Routes>
      </div>
      <ToolPanel />
      <ConfigPanel />
      <ToastContainer />
      <KeyboardShortcutsHelp />
      {showFirstRun && <FirstRunWizard onComplete={() => setShowFirstRun(false)} />}
    </div>
  );
}

export default App;
