import type { LogEntry } from '../../types';

interface LogViewerProps {
  logs: LogEntry[];
  isDark?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

const LEVEL_STYLES = {
  debug: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', label: 'DEBUG' },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400', label: 'INFO' },
  warn: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-600 dark:text-yellow-400', label: 'WARN' },
  error: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400', label: 'ERROR' },
};

function LogViewer({ logs, isDark = false, onLoadMore, hasMore = false }: LogViewerProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className={`divide-y ${isDark ? 'divide-gray-700' : 'divide-gray-100'}`}>
        {logs.length === 0 ? (
          <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            暂无日志
          </div>
        ) : (
          logs.map((log) => {
            const style = LEVEL_STYLES[log.level];
            return (
              <div
                key={log.id}
                className={`p-3 flex items-start gap-3 hover:${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}
              >
                <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${style.bg} ${style.text}`}>
                  {style.label}
                </span>
                <span className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {formatTime(log.timestamp)}
                </span>
                {log.source && (
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    [{log.source}]
                  </span>
                )}
                <span className={`flex-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
      {hasMore && onLoadMore && (
        <div className={`p-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            onClick={onLoadMore}
            className={`w-full py-2 text-sm rounded-lg border ${isDark ? 'border-gray-600 text-gray-400 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}

export default LogViewer;