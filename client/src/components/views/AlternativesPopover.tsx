/**
 * 备选翻译弹窗
 *
 * 点击译文中的词时弹出，显示备选翻译列表。
 * 支持点击外部/Esc 关闭，点击备选项替换当前词。
 */

import { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AlternativeTranslation } from "../../services/translateService";

interface AlternativesPopoverProps {
  word: string;
  alternatives: AlternativeTranslation[];
  loading: boolean;
  position: { x: number; y: number } | null;
  isDark: boolean;
  onSelect: (translation: string) => void;
  onClose: () => void;
}

function AlternativesPopover({
  word,
  alternatives,
  loading,
  position,
  isDark,
  onSelect,
  onClose,
}: AlternativesPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClickOutside, handleKeyDown]);

  if (!position) return null;

  const bgColor = isDark ? "bg-gray-800" : "bg-white";
  const borderColor = isDark ? "border-gray-600" : "border-gray-200";
  const textColor = isDark ? "text-gray-200" : "text-gray-800";
  const mutedColor = isDark ? "text-gray-400" : "text-gray-500";
  const hoverBg = isDark ? "hover:bg-gray-700" : "hover:bg-gray-100";
  const posColor = isDark ? "text-gray-500" : "text-gray-400";

  // 智能定位：避开屏幕边缘
  const popoverStyle: React.CSSProperties = {
    position: "fixed",
    left: `${position.x}px`,
    top: `${position.y}px`,
    zIndex: 9999,
    transform: "translate(-50%, -100%)",
    marginTop: "-8px",
  };

  return (
    <div
      ref={popoverRef}
      style={popoverStyle}
      className={`rounded-lg border shadow-xl py-2 min-w-[180px] max-w-[280px] animate-[fadeIn_0.15s_ease-out] ${bgColor} ${borderColor}`}
    >
      {/* 标题 */}
      <div className={`px-3 py-1 text-xs font-medium ${mutedColor}`}>
        "{word}" {t("translate.alternatives") || "备选翻译"}
      </div>

      {loading ? (
        <div className={`px-3 py-2 text-xs ${mutedColor}`}>
          {t("common.loading")}
        </div>
      ) : alternatives.length === 0 ? (
        <div className={`px-3 py-2 text-xs ${mutedColor}`}>
          {t("translate.noAlternatives") || "无备选结果"}
        </div>
      ) : (
        <div className="max-h-[200px] overflow-y-auto">
          {alternatives.map((alt, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(alt.translation)}
              className={`w-full px-3 py-1.5 text-left text-sm border-0 cursor-pointer transition-colors flex items-center justify-between ${hoverBg} ${textColor}`}
            >
              <span className="font-medium">{alt.translation}</span>
              <span className={`text-xs ml-2 ${posColor}`}>
                {alt.pos ? alt.pos : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 底部箭头 */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent`}
        style={{ borderTopColor: isDark ? "#1f2937" : "#ffffff" }}
      />
    </div>
  );
}

export default AlternativesPopover;
