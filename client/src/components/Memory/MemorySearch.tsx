import { useState } from 'react';
import type { MemoryType } from '../../services/memoryService';

interface MemorySearchProps {
  isDark: boolean;
  onSearch: (query: string, type: MemoryType | undefined) => void;
}

const TYPE_OPTIONS: { value: MemoryType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'user_preference', label: '用户偏好' },
  { value: 'project_context', label: '项目上下文' },
  { value: 'conversation', label: '对话记录' },
  { value: 'knowledge', label: '知识库' },
  { value: 'system', label: '系统' },
];

function MemorySearch({ isDark, onSearch }: MemorySearchProps) {
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<MemoryType | 'all'>('all');

  const handleSearch = () => {
    const type = selectedType === 'all' ? undefined : selectedType;
    onSearch(query, type);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className={`relative flex-1 min-w-[200px] max-w-[400px]`}>
        <svg
          className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="搜索记忆..."
          className={`w-full pl-10 pr-4 py-2 rounded-lg text-sm ${
            isDark
              ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
              : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
          } border focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
        <button
          onClick={handleSearch}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${
            isDark ? 'bg-gray-600 hover:bg-gray-500' : 'bg-gray-100 hover:bg-gray-200'
          } transition-colors`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>

      <select
        value={selectedType}
        onChange={(e) => setSelectedType(e.target.value as MemoryType | 'all')}
        className={`px-3 py-2 rounded-lg text-sm border ${
          isDark
            ? 'bg-gray-700 border-gray-600 text-white'
            : 'bg-white border-gray-300 text-gray-700'
        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default MemorySearch;