import { useEffect, useState } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { useMemoryStore } from '../../stores/memoryStore';
import type { MemoryType } from '../../services/memoryService';
import MemorySearch from '../Memory/MemorySearch';
import MemoryList from '../Memory/MemoryList';
import MemoryWeightChart from '../Memory/MemoryWeightChart';
import MemorySyncingStatus from '../Memory/MemorySyncingStatus';

function MemoryPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';

  const {
    memories,
    total,
    weights,
    syncStatus,
    selectedMemory,
    error,
    loadMemories,
    searchMemories,
    loadWeights,
    loadSyncStatus,
    triggerSync,
    deleteMemory,
    setSelectedMemory,
  } = useMemoryStore();

  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'weight'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');

  useEffect(() => {
    loadMemories({ sortBy, sortOrder });
    loadWeights();
    loadSyncStatus();
  }, [loadMemories, loadWeights, loadSyncStatus, sortBy, sortOrder]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadSyncStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadSyncStatus]);

  const handleSearch = (query: string, type: MemoryType | undefined) => {
    if (query.trim()) {
      searchMemories({ query, type, limit: 20 });
    } else {
      loadMemories({ sortBy, sortOrder });
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这条记忆吗？')) {
      await deleteMemory(id);
      loadMemories({ sortBy, sortOrder });
      if (selectedMemory?.id === id) {
        setSelectedMemory(null);
      }
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const TYPE_LABELS: Record<MemoryType, string> = {
    user_preference: '用户偏好',
    project_context: '项目上下文',
    conversation: '对话记录',
    knowledge: '知识库',
    system: '系统',
  };

  return (
    <div className={`flex-1 overflow-y-auto flex flex-col ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            记忆管理器
          </h1>
          <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            管理和查看系统记忆，共 {total} 条
          </p>
        </div>

        {error && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${isDark ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {error}
          </div>
        )}

        <MemorySearch isDark={isDark} onSearch={handleSearch} />

        <div className="flex items-center justify-between mt-4 mb-4">
          <div className="flex items-center gap-3">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as MemoryType | 'all')}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="all">全部类型</option>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'createdAt' | 'updatedAt' | 'weight')}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="updatedAt">按更新时间</option>
              <option value="createdAt">按创建时间</option>
              <option value="weight">按权重</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              {sortOrder === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            共 {total} 条记忆
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <MemoryList
              memories={memories}
              isDark={isDark}
              onSelect={setSelectedMemory}
              selectedId={selectedMemory?.id}
            />
          </div>

          <div className="space-y-4">
            <MemoryWeightChart weights={weights} isDark={isDark} />
            <MemorySyncingStatus
              status={syncStatus}
              isDark={isDark}
              onTriggerSync={triggerSync}
            />
          </div>
        </div>

        {selectedMemory && (
          <div className={`mt-6 p-4 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {TYPE_LABELS[selectedMemory.type]}
                  </span>
                  <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    权重: {selectedMemory.weight}
                  </span>
                </div>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  创建于 {formatDate(selectedMemory.createdAt)}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  更新于 {formatDate(selectedMemory.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDelete(selectedMemory.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    isDark ? 'bg-red-900/30 text-red-400 hover:bg-red-800/30' : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                >
                  删除
                </button>
                <button
                  onClick={() => setSelectedMemory(null)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className={`mt-4 p-4 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
              <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                记忆内容
              </h4>
              <p className={`text-sm whitespace-pre-wrap ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {selectedMemory.content}
              </p>
            </div>
            {selectedMemory.summary && (
              <div className={`mt-4 p-4 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-blue-50'}`}>
                <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  摘要
                </h4>
                <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {selectedMemory.summary}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MemoryPage;