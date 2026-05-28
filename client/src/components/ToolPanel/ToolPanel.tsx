import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';

function ContextPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions, createSession } = useSessionStore();
  const [isExpanded, setIsExpanded] = useState(true);

  const currentRoute = location.pathname.replace('/', '') || 'chat';

  const handleNewSession = () => {
    const title = `新会话 ${sessions.length + 1}`;
    createSession(title);
    navigate('/');
  };

  const renderChatContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">快捷操作</h3>
        <div className="space-y-1">
          <button
            onClick={handleNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <span>🆕</span>
            <span>新建会话</span>
          </button>
          <button
            onClick={() => navigate('/knowledge')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <span>📚</span>
            <span>搜索知识库</span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">最近会话</h3>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {sessions.slice(0, 5).map((session) => (
            <button
              key={session.id}
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors truncate"
            >
              <span>💬</span>
              <span className="truncate">{session.title || '未命名会话'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderKnowledgeContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">快捷操作</h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate('/knowledge/enhanced')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <span>🔍</span>
            <span>RAG增强搜索</span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">热门文档</h3>
        <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
          <p className="px-3 py-2">暂无热门文档</p>
        </div>
      </div>
    </div>
  );

  const renderCostContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">实时概览</h3>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">今日消费</span>
            <span className="font-medium text-gray-900 dark:text-white">¥0.00</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">本周消费</span>
            <span className="font-medium text-gray-900 dark:text-white">¥0.00</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCronContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">快捷操作</h3>
        <div className="space-y-1">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
          >
            <span>➕</span>
            <span>创建定时任务</span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">运行中的任务</h3>
        <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
          暂无运行中的任务
        </div>
      </div>
    </div>
  );

  const renderFilesContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">快捷操作</h3>
        <div className="space-y-1">
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors">
            <span>📤</span>
            <span>上传文件</span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">最近文件</h3>
        <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
          暂无最近文件
        </div>
      </div>
    </div>
  );

  const renderDashboardContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">系统状态</h3>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-gray-600 dark:text-gray-400">Backend</span>
            <span className="ml-auto text-gray-900 dark:text-white">运行中</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDefaultContext = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">快速导航</h3>
        <div className="space-y-1">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <span>💬</span>
            <span>返回聊天</span>
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm transition-colors"
          >
            <span>📊</span>
            <span>查看仪表盘</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderContextContent = () => {
    switch (currentRoute) {
      case 'chat':
      case '':
        return renderChatContext();
      case 'knowledge':
      case 'knowledge/enhanced':
        return renderKnowledgeContext();
      case 'cost':
        return renderCostContext();
      case 'cron':
        return renderCronContext();
      case 'files':
        return renderFilesContext();
      case 'dashboard':
        return renderDashboardContext();
      default:
        return renderDefaultContext();
    }
  };

  return (
    <div
      className={`bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col ${
        isExpanded ? 'w-64' : 'w-12'
      }`}
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-end">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 dark:text-gray-400 transition-colors"
          title={isExpanded ? '收起面板' : '展开面板'}
        >
          {isExpanded ? '◀' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-3">
          {renderContextContent()}
        </div>
      )}
    </div>
  );
}

export default ContextPanel;