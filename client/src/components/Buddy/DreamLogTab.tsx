import { useEffect, useState } from 'react';
import { dreamService } from '../../services/dreamService';
import type { DreamLogEntry, DreamLogResponse } from '../../types';

const DREAM_TYPE_LABELS: Record<string, string> = {
  'dream:started': '开始',
  'dream:completed': '完成',
  'dream:failed': '失败',
};

const DREAM_TYPE_COLORS: Record<string, string> = {
  'dream:started': 'text-blue-500',
  'dream:completed': 'text-green-500',
  'dream:failed': 'text-red-500',
};

const DREAM_TYPE_BG: Record<string, string> = {
  'dream:started': 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  'dream:completed': 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  'dream:failed': 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

function DreamLogTab() {
  const [data, setData] = useState<DreamLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    loadDreamLogs();
  }, [filter]);

  const loadDreamLogs = async () => {
    setIsLoading(true);
    try {
      const result = await dreamService.getDreamLogs(100, 0, filter || undefined);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'dream:started': return '🌙';
      case 'dream:completed': return '✨';
      case 'dream:failed': return '💤';
      default: return '🌙';
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        加载梦境日志...
      </div>
    );
  }

  return (
    <div>
      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-lg">✨</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">完成</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {data.stats.totalCompleted}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-lg">📚</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">会话</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {data.stats.totalSessions}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-lg">💡</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">洞察</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {data.stats.totalInsights}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-lg">💤</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">失败</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {data.stats.totalFailed}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        {['', 'dream:completed', 'dream:started', 'dream:failed'].map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              filter === type
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {type ? DREAM_TYPE_LABELS[type] : '全部'}
          </button>
        ))}
      </div>

      {(!data?.logs || data.logs.length === 0) ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          暂无梦境日志
        </div>
      ) : (
        <div className="space-y-2">
          {data.logs.map((entry: DreamLogEntry) => (
            <div
              key={entry.id}
              className={`p-3 rounded-lg border ${DREAM_TYPE_BG[entry.type] || 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base flex-shrink-0">
                    {getTypeIcon(entry.type)}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium truncate ${
                      entry.type === 'dream:failed'
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}>
                      {entry.summary}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span className={DREAM_TYPE_COLORS[entry.type] || ''}>
                        {DREAM_TYPE_LABELS[entry.type] || entry.type}
                      </span>
                      <span>{entry.sessionsCount} 条会话</span>
                      {entry.insightsGenerated > 0 && (
                        <span>{entry.insightsGenerated} 条洞察</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DreamLogTab;
