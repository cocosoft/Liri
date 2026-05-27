import { useEffect } from 'react';
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
import { useSessionStore } from './stores/sessionStore';
import { useAppStore } from './stores/appStore';
import { useBackendStore } from './stores/backendStore';
import { useKeyboard } from './hooks/useKeyboard';

function App() {
  const { loadSessions, createSession, sessions, currentSession } = useSessionStore();
  const activePage = useAppStore((s) => s.activePage);
  const checkBackendStatus = useBackendStore((s) => s.checkStatus);

  useKeyboard();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 15000);
    return () => clearInterval(interval);
  }, [checkBackendStatus]);

  useEffect(() => {
    if (sessions.length === 0 && !currentSession) {
      createSession('第一个会话');
    }
  }, [sessions.length, currentSession, createSession]);

  const renderPage = () => {
    const page = (() => {
      switch (activePage) {
        case 'dashboard':
          return <DashboardPage key="dashboard" />;
        case 'files':
          return <FileExplorerPage key="files" />;
        case 'knowledge':
          return <KnowledgePage key="knowledge" />;
        case 'agent':
          return <AgentPage key="agent" />;
        default:
          return (
            <main key="chat" className="flex-1 flex flex-col page-transition-enter">
              <ChatArea />
              <ChatInput />
            </main>
          );
      }
    })();
    return <div className="flex-1 flex page-transition-enter">{page}</div>;
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      {renderPage()}
      <ToolPanel />
      <ConfigPanel />
      <ToastContainer />
      <KeyboardShortcutsHelp />
    </div>
  );
}

export default App;
