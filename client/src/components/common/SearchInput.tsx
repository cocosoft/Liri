import { useState } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  isDark?: boolean;
  className?: string;
}

function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = '搜索...',
  isDark = false,
  className = '',
}: SearchInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && onSearch) {
      onSearch();
    }
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      <svg
        className={`absolute left-3 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={`w-full pl-10 pr-4 py-2 text-sm rounded-lg border transition-colors ${
          isFocused
            ? isDark
              ? 'border-blue-500 bg-gray-700 text-gray-100'
              : 'border-blue-500 bg-white text-gray-900'
            : isDark
            ? 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400'
            : 'border-gray-300 bg-white text-gray-900 placeholder-gray-400'
        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className={`absolute right-3 p-0.5 rounded ${isDark ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default SearchInput;