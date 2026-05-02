import { useSessionStore } from '../../stores/sessionStore';

function Sidebar() {
  const {
    sessions,
    currentSession,
    createSession,
    switchSession,
    deleteSession,
  } = useSessionStore();

  const handleCreateSession = () => {
    const title = `新会话 ${sessions.length + 1}`;
    createSession(title);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSession(id);
  };

  return (
    <aside className="w-64 bg-gray-800 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-bold">PY_APP</h2>
      </div>

      <div className="p-4 border-b border-gray-700">
        <button
          onClick={handleCreateSession}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors"
        >
          + 新建会话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => switchSession(session.id)}
              className={`p-3 rounded cursor-pointer transition-colors group ${
                currentSession?.id === session.id
                  ? 'bg-gray-700'
                  : 'hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{session.title}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {session.message_count} 条消息
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  className="ml-2 p-1 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {sessions.length === 0 && (
          <p className="text-gray-400 text-center text-sm mt-8">
            暂无会话，点击上方按钮创建
          </p>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;