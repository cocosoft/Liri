import { useState } from "react";

interface MemorySearchProps {
  isDark: boolean;
  onSearch: (query: string) => void;
}

function MemorySearch({ isDark, onSearch }: MemorySearchProps) {
  const [query, setQuery] = useState("");

  const handleSearch = () => {
    onSearch(query);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className={`relative flex-1 min-w-[200px] max-w-[500px]`}>
        <svg
          className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
            isDark ? "text-gray-500" : "text-gray-400"
          }`}
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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="搜索记忆..."
          className={`w-full pl-10 pr-4 py-2 rounded-lg text-sm ${
            isDark
              ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
              : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
          } border focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
        <button
          onClick={handleSearch}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${
            isDark
              ? "bg-gray-600 hover:bg-gray-500"
              : "bg-gray-100 hover:bg-gray-200"
          } transition-colors`}
        >
          <svg
            className="w-4 h-4"
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
        </button>
      </div>
    </div>
  );
}

export default MemorySearch;
