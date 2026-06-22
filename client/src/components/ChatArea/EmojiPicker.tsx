/**
 * Emoji 表情选择器组件
 *
 * 从 ChatInput 中提取，支持分类浏览和选择表情符号。
 * 点击表情后自动触发 onSelect 回调，点击外部区域触发 onClose。
 */
import { useState } from "react";
import EMOJI_CATEGORIES from "../../utils/emojiData";

function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState(0);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 z-20 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-gray-700">
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(idx)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeCategory === idx
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className="p-2 max-h-64 overflow-y-auto">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_CATEGORIES[activeCategory].icons.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onSelect(emoji);
                  onClose();
                }}
                className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default EmojiPicker;