import { memo, useState, useCallback } from "react";
import { Search } from "lucide-react";

interface FAQSearchBarProps {
  onSearch: (query: string) => void;
  isDark: boolean;
}

export const FAQSearchBar = memo(function FAQSearchBar({
  onSearch,
  isDark,
}: FAQSearchBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(value.trim());
    },
    [value, onSearch],
  );

  const handleClear = useCallback(() => {
    setValue("");
    onSearch("");
  }, [onSearch]);

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border flex-1 max-w-xs ${
          isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
        }`}
      >
        <Search
          size={14}
          className={isDark ? "text-gray-500" : "text-gray-400"}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索 FAQ..."
          className={`text-xs bg-transparent outline-none flex-1 ${
            isDark
              ? "text-gray-300 placeholder:text-gray-600"
              : "text-gray-700 placeholder:text-gray-400"
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={`text-xs ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}
          >
            ×
          </button>
        )}
      </div>
    </form>
  );
});
