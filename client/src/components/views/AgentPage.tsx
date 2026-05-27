import { useEffect, useState } from 'react';
import { agentService } from '../../services/agentService';
import { useAppStore } from '../../stores/appStore';
import { SkeletonCard } from '../common/Skeleton';
import type { AgentTask } from '../../types';

function AgentPage() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskName, setTaskName] = useState('');
  const setActivePage = useAppStore((s) => s.setActivePage);

  const loadTasks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await agentService.listTasks();
      setTasks(items);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleExecute = async () => {
    if (!taskName.trim()) return;
    setError(null);
    try {
      const newTask = await agentService.executeTask(taskName.trim());
      setTasks((prev) => [newTask, ...prev]);
      setTaskName('');
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await agentService.cancelTask(id);
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: 'failed' as const } : t))
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  const statusText: Record<string, string> = {
    pending: '等待中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Agent 任务
          </h2>
          <button
            onClick={() => setActivePage('chat')}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            返回聊天
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExecute()}
            placeholder="输入任务名称..."
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleExecute}
            disabled={!taskName.trim() || isLoading}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg disabled:cursor-not-allowed"
          >
            执行
          </button>
          <button
            onClick={loadTasks}
            disabled={isLoading}
            className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
          >
            刷新
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading && tasks.length === 0 ? (
            <div className="p-4 space-y-3">
              <SkeletonCard count={3} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              暂无任务
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {tasks.map((task) => (
                <li key={task.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {task.name}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          statusColor[task.status] || ''
                        }`}
                      >
                        {statusText[task.status] || task.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.progress !== undefined && (
                        <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                      {(task.status === 'pending' || task.status === 'running') && (
                        <button
                          onClick={() => handleCancel(task.id)}
                          className="text-xs px-2 py-1 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </div>
                  {task.result && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                      {task.result}
                    </p>
                  )}
                  {task.error && (
                    <p className="mt-2 text-xs text-red-500 dark:text-red-400">
                      {task.error}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                    {new Date(task.created_at).toLocaleString('zh-CN')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentPage;
