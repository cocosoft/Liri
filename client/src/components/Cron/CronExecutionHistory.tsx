import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';

interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'success' | 'failed' | 'running';
  output: string;
  error?: string;
}

function CronExecutionHistory() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';
  const [records] = useState<ExecutionRecord[]>([
    { id: '1', taskId: '1', taskName: '数据备份', startTime: '2026-05-28 10:00:00', endTime: '2026-05-28 10:05:00', duration: 300, status: 'success', output: '备份完成: 100MB' },
    { id: '2', taskId: '2', taskName: '日志清理', startTime: '2026-05-28 09:00:00', endTime: '2026-05-28 09:02:00', duration: 120, status: 'failed', output: '', error: '磁盘空间不足' },
    { id: '3', taskId: '1', taskName: '数据备份', startTime: '2026-05-27 10:00:00', endTime: '2026-05-27 10:04:00', duration: 240, status: 'success', output: '备份完成: 95MB' },
    { id: '4', taskId: '3', taskName: '健康检查', startTime: '2026-05-28 08:30:00', endTime: '2026-05-28 08:30:05', duration: 5, status: 'success', output: '系统正常' },
    { id: '5', taskId: '2', taskName: '日志清理', startTime: '2026-05-26 09:00:00', endTime: '2026-05-26 09:01:00', duration: 60, status: 'failed', output: '', error: '权限不足' },
  ]);
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const filteredRecords = filter === 'all' ? records : records.filter((r) => r.status === filter);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'success':
        return isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700';
      case 'failed':
        return isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700';
      case 'running':
        return isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700';
      default:
        return isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success': return '成功';
      case 'failed': return '失败';
      case 'running': return '运行中';
      default: return status;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">执行历史</h3>
        <div className="flex gap-2">
          {(['all', 'success', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : isDark
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? '全部' : f === 'success' ? '成功' : '失败'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filteredRecords.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">暂无执行记录</p>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-700/30' : 'border-gray-200 bg-gray-50'}`}
            >
              <button
                onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                className="w-full p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusStyle(record.status)}`}>
                      {getStatusText(record.status)}
                    </span>
                    <span className={`text-sm font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {record.taskName}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {record.startTime}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatDuration(record.duration)}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === record.id ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </button>

              {expandedId === record.id && (
                <div className={`px-3 pb-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'} pt-3`}>
                  {record.output && (
                    <div className="mb-2">
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>输出:</span>
                      <pre className={`mt-1 text-xs p-2 rounded ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'}`}>
                        {record.output}
                      </pre>
                    </div>
                  )}
                  {record.error && (
                    <div>
                      <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>错误:</span>
                      <pre className={`mt-1 text-xs p-2 rounded ${isDark ? 'bg-red-900/20 text-red-300' : 'bg-red-50 text-red-700'}`}>
                        {record.error}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default CronExecutionHistory;