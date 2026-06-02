import type { Memory } from '../../services/memoryService';

interface MemoryListProps {
  memories: Memory[];
  isDark: boolean;
  onSelect: (memory: Memory) => void;
  selectedId?: string | null;
  onDelete: (id: string) => void;
  onEdit: (memory: Memory) => void;
}

const TYPE_LABELS: Record<Memory['type'], string> = {
  user_preference: '用户偏好',
  project_context: '项目上下文',
  conversation: '对话记录',
  knowledge: '知识库',
  system: '系统',
};

const TYPE_COLORS: Record<Memory['type'], string> = {
  user_preference: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  project_context: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  conversation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  knowledge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  system: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

function MemoryList({ memories, isDark, onSelect, selectedId, onDelete, onEdit }: MemoryListProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 80) return 'text-green-500';
    if (weight >= 50) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (memories.length === 0) {
    return (
      <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p>暂无记忆条目</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {memories.map((memory) => (
        <div
          key={memory.id}
          className={`group relative p-4 rounded-lg border transition-colors ${
            selectedId === memory.id
              ? isDark
                ? 'bg-blue-900/30 border-blue-500'
                : 'bg-blue-50 border-blue-500'
              : isDark
              ? 'bg-gray-800 border-gray-700 hover:bg-gray-700'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
        >
          <div
            onClick={() => onSelect(memory)}
            className="cursor-pointer"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[memory.type]}`}>
                  {TYPE_LABELS[memory.type]}
                </span>
                <span className={`text-xs ${getWeightColor(memory.weight)} font-medium`}>
                  权重: {memory.weight}
                </span>
              </div>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {formatDate(memory.updatedAt)}
              </span>
            </div>
            <p className={`text-sm line-clamp-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {memory.summary || memory.content.substring(0, 100)}...
            </p>
            {memory.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {memory.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(memory); }}
              className={`p-1 rounded text-xs ${isDark ? 'hover:bg-gray-600 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-400 hover:text-blue-600'}`}
              title="编辑"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(memory.id); }}
              className={`p-1 rounded text-xs ${isDark ? 'hover:bg-gray-600 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-600'}`}
              title="删除"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default MemoryList;