import { memo } from "react";

interface DomainFilterProps {
  domains: string[];
  selectedDomain: string;
  onSelect: (domain: string) => void;
  isDark: boolean;
}

export const DomainFilter = memo(function DomainFilter({
  domains,
  selectedDomain,
  onSelect,
  isDark,
}: DomainFilterProps) {
  if (domains.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
        域:
      </span>
      <select
        value={selectedDomain}
        onChange={(e) => onSelect(e.target.value)}
        className={`text-xs rounded px-2 py-1 border ${
          isDark
            ? "bg-gray-800 border-gray-700 text-gray-300"
            : "bg-white border-gray-200 text-gray-700"
        } focus:outline-none focus:border-blue-400`}
      >
        <option value="">全部</option>
        {domains.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
});
