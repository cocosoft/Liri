import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  datasourceService,
  type DataSourceConfig,
  type SyncResult,
} from "../../../services/datasourceService";
import { Plus, Trash2, RefreshCw, Rss, Globe } from "lucide-react";

interface DataSourcePageProps {
  isDark: boolean;
}

const TYPE_LABELS: Record<
  string,
  { icon: typeof Rss; label: string; desc: string }
> = {
  rss: { icon: Rss, label: "RSS/Atom Feed", desc: "从 RSS 源同步文章到知识库" },
};

export function DataSourcePage({ isDark }: DataSourcePageProps) {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<DataSourceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [saving, setSaving] = useState(false); // F7：保存防重
  // L5：同步竞态序号——多源可并行同步，只采纳最近一次的结果
  const syncSeqRef = useRef(0);

  // Editor form state
  const [form, setForm] = useState({
    type: "rss",
    url: "",
    intervalMs: 3600000,
    maxItems: 20,
    knowledgeBase: "",
    enabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfigs(await datasourceService.list());
      setError(""); // D2：成功后清理错误提示
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("knowledge.datasource.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (saving) return; // F7：防重，避免重复创建数据源
    setSaving(true);
    setError("");
    try {
      await datasourceService.create(form);
      setShowEditor(false);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("knowledge.datasource.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [form, load, saving, t]);

  const handleDelete = useCallback(
    async (type: string) => {
      if (!confirm(t("knowledge.datasource.deleteConfirm", { type }))) return;
      try {
        await datasourceService.delete(type);
        // KB-D1：await 刷新，保证删除成功后列表与错误清理时序确定
        await load();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("knowledge.datasource.deleteFailed"),
        );
      }
    },
    [load, t],
  );

  const handleSync = useCallback(
    async (type: string) => {
      const seq = ++syncSeqRef.current;
      setSyncing(type);
      setSyncResult(null);
      try {
        const r = await datasourceService.sync(type);
        // L5：仅当仍是最近一次同步时更新结果，避免多源并行时慢响应覆盖快响应
        if (seq === syncSeqRef.current) setSyncResult(r);
        setError("");
      } catch (e) {
        if (seq === syncSeqRef.current) {
          setError(
            e instanceof Error
              ? e.message
              : t("knowledge.datasource.syncFailed"),
          );
        }
      } finally {
        if (seq === syncSeqRef.current) setSyncing(null);
      }
    },
    [t],
  );

  return (
    <div className="flex flex-col h-full">
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}
          >
            {t("knowledge.datasource.title")}
          </span>
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            {t("knowledge.datasource.count", { count: configs.length })}
          </span>
        </div>
        <button
          onClick={() => setShowEditor(true)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          <Plus size={12} />
          {t("knowledge.datasource.add")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {syncResult && (
          <div
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              syncResult.failed > 0
                ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                : "bg-green-500/10 text-green-600 dark:text-green-400"
            }`}
          >
            {t("knowledge.datasource.syncSummary", {
              added: syncResult.added,
              updated: syncResult.updated,
              failed: syncResult.failed,
            })}
            {syncResult.errors.map((e, i) => (
              <div key={i}>
                {e.item}: {e.error}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-sm text-gray-500">
            {t("common.loading")}
          </div>
        ) : configs.length === 0 ? (
          <div
            className={`text-center py-8 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            <Globe size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t("knowledge.datasource.empty")}</p>
            <p className="text-xs mt-1">
              {t("knowledge.datasource.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {configs.map((c) => {
              const info = TYPE_LABELS[c.type] ?? {
                icon: Globe,
                label: c.type,
                desc: "",
              };
              const Icon = info.icon;
              return (
                <div
                  key={c.type}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${isDark ? "border-gray-700 bg-gray-800/50" : "border-gray-200 bg-white"}`}
                >
                  <Icon
                    size={18}
                    className={isDark ? "text-blue-400" : "text-blue-500"}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                      >
                        {info.label}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          c.enabled
                            ? "bg-green-500/20 text-green-600 dark:text-green-400"
                            : "bg-gray-500/20 text-gray-500"
                        }`}
                      >
                        {c.enabled ? t("common.enable") : t("common.disable")}
                      </span>
                    </div>
                    <div
                      className={`text-xs truncate mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {c.url}
                    </div>
                    <div
                      className={`text-[10px] mt-0.5 ${isDark ? "text-gray-600" : "text-gray-400"}`}
                    >
                      {t("knowledge.datasource.intervalSummary", {
                        minutes: Math.round(c.intervalMs / 60000),
                        max: c.maxItems ?? 20,
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleSync(c.type)}
                      disabled={syncing === c.type}
                      className={`p-1.5 rounded transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700" : "text-gray-400 hover:bg-gray-100"}`}
                      title={t("knowledge.datasource.syncNow")}
                    >
                      <RefreshCw
                        size={14}
                        className={syncing === c.type ? "animate-spin" : ""}
                      />
                    </button>
                    <button
                      onClick={() => handleDelete(c.type)}
                      className={`p-1.5 rounded transition-colors ${isDark ? "text-gray-400 hover:bg-red-500/20 hover:text-red-400" : "text-gray-400 hover:bg-red-50 hover:text-red-500"}`}
                      title={t("common.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑器弹窗 */}
      {showEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowEditor(false)}
        >
          <div
            className={`w-full max-w-md rounded-xl shadow-xl p-4 space-y-3 ${isDark ? "bg-gray-900 border border-gray-700" : "bg-white border border-gray-200"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}
            >
              {t("knowledge.datasource.addTitle")}
            </h3>

            <label className="block">
              <span
                className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("knowledge.datasource.typeLabel")}
              </span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
              >
                <option value="rss">RSS/Atom Feed</option>
              </select>
            </label>

            <label className="block">
              <span
                className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                URL
              </span>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/feed.xml"
                className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
              />
            </label>

            <div className="flex gap-2">
              <label className="block flex-1">
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("knowledge.datasource.intervalLabel")}
                </span>
                <input
                  type="number"
                  value={Math.round(form.intervalMs / 60000)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      // L5：同步间隔下限 5 分钟，防止 0 分钟疯狂轮询
                      intervalMs:
                        Math.max(5, parseInt(e.target.value) || 60) * 60000,
                    })
                  }
                  min={5}
                  className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
                />
              </label>
              <label className="block flex-1">
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("knowledge.datasource.maxItemsLabel")}
                </span>
                <input
                  type="number"
                  value={form.maxItems ?? 20}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxItems: parseInt(e.target.value) || 20,
                    })
                  }
                  min={1}
                  max={100}
                  className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowEditor(false)}
                className={`text-xs px-3 py-1.5 rounded-lg ${isDark ? "text-gray-400 hover:bg-gray-800" : "text-gray-500 hover:bg-gray-100"}`}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={!form.url || saving}
                className={`text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50`}
              >
                {saving
                  ? t("knowledge.datasource.adding")
                  : t("knowledge.datasource.add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
