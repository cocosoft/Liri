import { useEffect, useState } from 'react';
import { useCronStore } from '../../stores/cronStore';
import { SkeletonCard } from '../common/Skeleton';

function CronPage() {
  const { tasks, isLoading, loadTasks, toggleTask, deleteTask, runTaskNow } = useCronStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            定时任务
          </h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            新建任务
          </button>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            <SkeletonCard count={3} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            暂无定时任务
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {task.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        task.status === 'running'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : task.status === 'error'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {task.status === 'running' ? '运行中' : task.status === 'error' ? '错误' : '空闲'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {task.description}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                    <span>Cron: {task.expression}</span>
                    {task.lastRun && <span>上次: {new Date(task.lastRun).toLocaleString()}</span>}
                    {task.nextRun && <span>下次: {new Date(task.nextRun).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => runTaskNow(task.id)}
                    className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded"
                    title="立即执行"
                  >
                    执行
                  </button>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={() => toggleTask(task.id, !task.enabled)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                  </label>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CronPage;
