import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Tag } from "lucide-react";

interface SearchTargetFilterProps {
  onTagsChange: (tags: string[]) => void;
  isDark: boolean;
  tags?: string[];
}

export const SearchTargetFilter = memo(function SearchTargetFilter({
  onTagsChange,
  isDark,
  tags: initialTags,
}: SearchTargetFilterProps) {
  const { t } = useTranslation();
  const [activeTags, setActiveTags] = useState<string[]>(initialTags ?? []);
  const [input, setInput] = useState("");
  const [showInput, setShowInput] = useState(false);

  const addTag = useCallback(() => {
    const tag = input.trim().toLowerCase();
    if (tag && !activeTags.includes(tag)) {
      const next = [...activeTags, tag];
      setActiveTags(next);
      onTagsChange(next);
    }
    setInput("");
    setShowInput(false);
  }, [input, activeTags, onTagsChange]);

  const removeTag = useCallback(
    (tag: string) => {
      const next = activeTags.filter((tg) => tg !== tag);
      setActiveTags(next);
      onTagsChange(next);
    },
    [activeTags, onTagsChange],
  );

  return (
    <div className="flex items-center gap-1.5">
      <Tag size={12} className={isDark ? "text-gray-500" : "text-gray-400"} />
      {activeTags.map((tag) => (
        <span
          key={tag}
          className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 cursor-default ${
            isDark
              ? "bg-blue-500/20 text-blue-400"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {tag}
          <button onClick={() => removeTag(tag)} className="hover:text-red-400">
            <X size={10} />
          </button>
        </span>
      ))}
      {showInput ? (
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTag();
            if (e.key === "Escape") setShowInput(false);
          }}
          onBlur={() => {
            if (!input) setShowInput(false);
          }}
          placeholder={t("knowledge.tagFilterPlaceholder")}
          className={`text-[10px] px-2 py-0.5 rounded border outline-none w-20 ${
            isDark
              ? "bg-gray-800 border-gray-600 text-gray-200"
              : "bg-white border-gray-300 text-gray-700"
          }`}
          autoFocus
        />
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className={`text-[10px] px-1.5 py-0.5 rounded border border-dashed ${
            isDark
              ? "border-gray-600 text-gray-500 hover:border-gray-500"
              : "border-gray-300 text-gray-400 hover:border-gray-400"
          }`}
        >
          {t("knowledge.addTagShort")}
        </button>
      )}
    </div>
  );
});
