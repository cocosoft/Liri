import { useEffect, useState } from 'react';
import { useBackendStore } from '../../stores/backendStore';

function Footer() {
  const { status, checkStatus, startBackend, stopBackend, error } = useBackendStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const getStatusColor = () => {
    if (status.running) return 'text-green-500';
    return 'text-red-500';
  };

  const getStatusIcon = () => {
    if (status.running) return '🟢';
    return '🔴';
  };

  const getStatusText = () => {
    if (status.running) return '运行中';
    return '已停止';
  };

  const handleStart = async () => {
    setActionLoading(true);
    await startBackend();
    setActionLoading(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    await stopBackend();
    setActionLoading(false);
  };

  return (
    <footer className="h-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 text-xs text-gray-600 dark:text-gray-400 select-none relative">
      <div className="flex items-center gap-3 flex-1">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"
          title="点击展开详细状态"
        >
          <span>{getStatusIcon()}</span>
          <span>Backend {getStatusText()}</span>
          {status.running ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleStop(); }}
              disabled={actionLoading}
              className="ml-2 px-1.5 py-0.5 text-[10px] bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
            >
              {actionLoading ? '...' : '停止'}
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleStart(); }}
              disabled={actionLoading}
              className="ml-2 px-1.5 py-0.5 text-[10px] bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded transition-colors"
            >
              {actionLoading ? '...' : '启动'}
            </button>
          )}
        </div>

        {status.running && status.port && (
          <>
            <div className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span className="text-gray-400">端口 {status.port}</span>
          </>
        )}

        {status.running && status.pid && (
          <>
            <div className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span className="text-gray-400">PID {status.pid}</span>
          </>
        )}

        <div className="flex-1" />
      </div>

      {isExpanded && (
        <div className="absolute bottom-full mb-1 left-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-xs min-w-[200px] z-50">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">详细状态</h4>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">状态</span>
              <span className={getStatusColor()}>{getStatusText()}</span>
            </div>
            {status.port && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">端口</span>
                <span className="text-gray-900 dark:text-gray-100">{status.port}</span>
              </div>
            )}
            {status.pid && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">PID</span>
                <span className="text-gray-900 dark:text-gray-100">{status.pid}</span>
              </div>
            )}
            {error && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}

export default Footer;
