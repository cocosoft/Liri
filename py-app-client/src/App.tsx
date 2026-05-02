import { useEffect } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import ChatInput from './components/ChatArea/ChatInput';
import ToolPanel from './components/ToolPanel/ToolPanel';
import ConfigPanel from './components/ConfigPanel/ConfigPanel';
import { useSessionStore } from './stores/sessionStore';
import { useKeyboard } from './hooks/useKeyboard';

function App() {
  const { loadSessions, createSession, sessions } = useSessionStore();

  useKeyboard();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (sessions.length === 0) {
      createSession('第一个会话');
    }
  }, [sessions.length, createSession]);

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