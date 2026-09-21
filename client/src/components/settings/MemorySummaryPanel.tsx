/**
 * MemorySummaryPanel — 记忆摘要面板（A3 设置抽屉 memory tab）
 *
 * 轻量替代：不整塞 MemoryPage（493+ 行），仅展示总数与最近 3 条，
 * 完整管理跳转 /settings?nav=memory（复用 SettingsPage ?nav= 深链）。
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMemoryStore } from "../../stores/memoryStore";
import { useSettingsPanelStore } from "../../stores/settingsPanelStore";

function MemorySummaryPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const memories = useMemoryStore((s) => s.memories);
  const total = useMemoryStore((s) => s.total);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const loadMemories = useMemoryStore((s) => s.loadMemories);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);

  // 挂载时刷新列表（与 MemoryPage 同源 loadMemories）
  useEffect(() => {
    loadMemories({ limit: 3 }).catch(() => {
      /* @ignore-catch 加载失败不阻塞抽屉展示 */
    });
  }, [loadMemories]);

  const recent = useMemo(
    () => [...memories].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [memories],
  );

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {t("memory.total")}
        </span>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {isLoading ? "…" : total}
        </span>
      </div>

      {!isLoading && recent.length === 0 ? (
        <div className="py-6 text-sm text-gray-400 dark:text-gray-500 text-center">
          {t("memory.noMemories")}
        </div>
      ) : (
        <div className="space-y-2">
          {(isLoading ? [] : recent).map((m) => (
            <div
              key={m.id}
              className="rounded-md border border-gray-100 dark:border-gray-700 px-3 py-2"
            >
              <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-1">
                {m.summary || m.content}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500 line-clamp-1">
                {m.content}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          navigate("/settings?nav=memory");
          closePanel();
        }}
        className="w-full text-left px-2 py-1.5 rounded text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800"
      >
        {t("memory.openFull")} →
      </button>
    </div>
  );
}

export default MemorySummaryPanel;
