import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useAppStore } from '../../stores/appStore';
import ConfirmDialog from '../common/ConfirmDialog';
import BackendStatusBadge from './BackendStatusBadge';

function Sidebar() {
  const {
    sessions,
    currentSession,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useSessionStore();

  const { activePage, setActivePage } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleCreateSession = () => {
    const title = `新会话 ${sessions.length + 1}`;
    createSession(title);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteSession(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleDoubleClick = (id: string, title: string) => {
    setEditingId(id);
    setEditingTitle(title);
  };

  const handleRenameConfirm = () => {
    if (editingId && editingTitle.trim()) {
      renameSession(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-64 bg-gray-800 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700 space-y-1">
        <h2 className="text-lg font-bold">PY_APP</h2>
        <BackendStatusBadge />
      </div>

      <div className="p-2 border-b border-gray-700">
        <nav className="space-y-1">
          <button
            onClick={() => setActivePage('chat')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activePage === 'chat'
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            聊天
          </button>
          <button
            onClick={() => setActivePage('dashboard')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activePage === 'dashboard'
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            仪表盘
          </button>
          <button
            onClick={() => setActivePage('files')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activePage === 'files'
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            文件浏览
          </button>
          <button
            onClick={() => setActivePage('knowledge')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activePage === 'knowledge'
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            知识库
          </button>
          <button
            onClick={() => setActivePage('agent')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activePage === 'agent'
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Agent
          </button>
        </nav>
      </div>

      <div className="p-4 border-b border-gray-700 space-y-2">
        <button
          onClick={handleCreateSession}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors"
        >
          + 新建会话
        </button>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-700 rounded border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => switchSession(session.id)}
              onDoubleClick={() => handleDoubleClick(session.id, session.title)}
              className={`p-3 rounded cursor-pointer transition-colors group ${
                currentSession?.id === session.id
                  ? 'bg-gray-700'
                  : 'hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  {editingId === session.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={handleRenameConfirm}
                      onKeyDown={handleRenameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full px-1 py-0.5 text-sm bg-gray-600 rounded border border-blue-500 text-white focus:outline-none"
                    />
                  ) : (
                    <p className="font-medium truncate text-sm">{session.title}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {session.message_count} 条消息
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteClick(e, session.id)}
                  className="ml-2 p-1 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除会话"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredSessions.length === 0 && (
          <p className="text-gray-400 text-center text-sm mt-8">
            {searchQuery ? '未找到匹配的会话' : '暂无会话，点击上方按钮创建'}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除此会话吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

export default Sidebar;
