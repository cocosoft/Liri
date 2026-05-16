import { useEffect } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import ChatInput from './components/ChatArea/ChatInput';
import ToolPanel from './components/ToolPanel/ToolPanel';
import ConfigPanel from './components/ConfigPanel/ConfigPanel';
import { useSessionStore } from './stores/sessionStore';
import { useKeyboard } from './hooks/useKeyboard';

function App() {
  const { loadSessions, createSession, sessions, currentSession } = useSessionStore();

  useKeyboard();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // 只有在加载完成且没有会话时才创建新会话
    if (sessions.length === 0 && !currentSession) {
      createSession('第一个会话');
    }
  }, [sessions.length, currentSession, createSession]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        <ChatArea />
        <ChatInput />
      </main>
      <ToolPanel />
      <ConfigPanel />
    </div>
  );
}

export default App;
