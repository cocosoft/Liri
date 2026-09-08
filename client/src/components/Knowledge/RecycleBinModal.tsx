/**
 * RecycleBinModal — 回收站查看/恢复/永久删除（P2#18）
 */
import { useEffect, useState } from "react";
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
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await knowledgeService.listTrash());
    } catch {
      setItems([]);
      toastError("加载回收站失败，请检查后端连接");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const restore = async (item: TrashItem) => {
    if (busyPath) return;
    setBusyPath(item.docPath);
    try {
      const ok = await knowledgeService.restoreTrash(item.docPath);
      if (ok) {
        await load();
        onChanged();
      } else {
        toastError("恢复失败");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusyPath(null);
    }
  };

  const purge = async (item: TrashItem) => {
    if (busyPath) return;
    if (!window.confirm(`永久删除 ${item.fileName}？此操作不可恢复。`)) return;
    setBusyPath(item.docPath);
    try {
      const ok = await knowledgeService.purgeTrash(item.docPath);
      if (ok) {
        await load();
      } else {
        toastError("永久删除失败");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "永久删除失败");
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
          <h3 className="text-sm font-medium">回收站</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <p className="text-xs text-gray-400 text-center py-6">加载中...</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">回收站为空</p>
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
                    恢复
                  </button>
                  <button
                    disabled={busyPath === item.docPath}
                    onClick={() => void purge(item)}
                    className="text-[10px] px-2 py-0.5 rounded border text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                  >
                    永久删除
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
