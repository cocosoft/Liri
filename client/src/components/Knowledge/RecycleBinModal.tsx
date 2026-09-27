/**
 * RecycleBinModal — 回收站查看/恢复/永久删除（P2#18）
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeService } from "../../services/knowledgeService";
import { toastError } from "../../stores/toastStore";

interface TrashItem {
  docPath: string;
  fileName: string;
  trashedAt: number;
}

export function RecycleBinModal({
  isDark,
  onClose,
  onChanged,
}: {
  isDark: boolean;
  onClose: () => void;
  /** 恢复/删除后通知父级刷新列表 */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await knowledgeService.listTrash());
    } catch {
      setItems([]);
      toastError(t("knowledge.loadTrashFailed"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [t]);

  const restore = async (item: TrashItem) => {
    if (busyPath) return;
    setBusyPath(item.docPath);
    try {
      const ok = await knowledgeService.restoreTrash(item.docPath);
      if (ok) {
        await load();
        onChanged();
      } else {
        toastError(t("knowledge.restoreFailed"));
      }
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("knowledge.restoreFailed"),
      );
    } finally {
      setBusyPath(null);
    }
  };

  const purge = async (item: TrashItem) => {
    if (busyPath) return;
    if (!window.confirm(t("knowledge.purgeConfirm", { name: item.fileName })))
      return;
    setBusyPath(item.docPath);
    try {
      const ok = await knowledgeService.purgeTrash(item.docPath);
      if (ok) {
        await load();
      } else {
        toastError(t("knowledge.purgeFailed"));
      }
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("knowledge.purgeFailed"),
      );
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-xl border shadow-xl flex flex-col max-h-[70vh] ${isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium">{t("knowledge.recycleBin")}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            {t("common.close")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <p className="text-xs text-gray-400 text-center py-6">
              {t("common.loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              {t("knowledge.recycleBinEmpty")}
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.docPath}
                className={`rounded-lg border px-3 py-2 ${isDark ? "border-gray-700 bg-gray-800/40" : "border-gray-200 bg-gray-50"}`}
              >
                <div className="text-xs font-medium break-all">
                  {item.fileName}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 break-all">
                  {item.docPath}
                  <span className="ml-1">
                    ·{" "}
                    {new Date(item.trashedAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </span>
                </div>
                <div className="flex gap-2 mt-1.5">
                  <button
                    disabled={busyPath === item.docPath}
                    onClick={() => void restore(item)}
                    className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {t("knowledge.restoreLabel")}
                  </button>
                  <button
                    disabled={busyPath === item.docPath}
                    onClick={() => void purge(item)}
                    className="text-[10px] px-2 py-0.5 rounded border text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                  >
                    {t("knowledge.purgeLabel")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
