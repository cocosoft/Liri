import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, FileInput, Trash2 } from "lucide-react";
import { faqService } from "../../../services/faqService";
import { toastError } from "../../../stores/toastStore";
import type { FAQEntry, FAQImportReport } from "../../../types/knowledge";
import { FAQList } from "./FAQList";
import { FAQEditor } from "./FAQEditor";
import { FAQSearchBar } from "./FAQSearchBar";
import { FAQCategoryFilter } from "./FAQCategoryFilter";
import { FAQImportModal } from "./FAQImportModal";

interface FAQPageProps {
  base: string;
  isDark: boolean;
}

export function FAQPage({ base, isDark }: FAQPageProps) {
  const [entries, setEntries] = useState<FAQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEditor, setShowEditor] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FAQEntry | undefined>();
  const [showImport, setShowImport] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // F1：加载竞态序号，只采纳最后一次请求
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    let loadedEntries: FAQEntry[] = [];
    try {
      const [catData] = await Promise.all([
        faqService.categories(base).catch(() => [] as string[]),
      ]);
      if (seq !== loadSeqRef.current) return;
      setCategories(catData ?? []);

      if (searchQuery) {
        const result = await faqService.search(base, searchQuery);
        loadedEntries = result.entries;
      } else {
        const result = await faqService.list(base, {
          category: category || undefined,
        });
        loadedEntries = result.entries;
      }
      if (seq !== loadSeqRef.current) return;
      setEntries(loadedEntries);
      // F3：加载成功后清理不在当前列表中的选中项（切分类/base 后防误删不可见条目）
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(loadedEntries.map((e) => e.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch {
      if (seq !== loadSeqRef.current) return;
      // F1：失败清空脏数据（避免残留上一分类/base 内容）+ 明确错误提示
      setEntries([]);
      setLoadError("加载 FAQ 失败，请重试");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [base, searchQuery, category]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = useCallback(
    async (data: {
      question: string;
      answer: string;
      similarQuestions: string[];
      tags: string[];
      category: string;
      recommended: boolean;
    }) => {
      await faqService.create(base, data);
      await load();
    },
    [base, load],
  );

  const handleUpdate = useCallback(
    async (data: {
      question: string;
      answer: string;
      similarQuestions: string[];
      tags: string[];
      category: string;
      recommended: boolean;
    }) => {
      if (!editingEntry) return;
      await faqService.update(base, editingEntry.id, data);
      setEditingEntry(undefined);
      await load();
    },
    [base, editingEntry, load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      // KB-F1：单条删除加确认（与批量删除 confirm 一致，列表每行删除按钮是高频误触路径）
      if (!window.confirm("确定删除这条 FAQ？此操作不可恢复。")) return;
      try {
        await faqService.delete(base, id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await load();
      } catch (err) {
        toastError(
          "删除 FAQ 失败: " + (err instanceof Error ? err.message : "未知错误"),
        );
      }
    },
    [base, load],
  );

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0 || deleting) return;
    // F2：批量删除加确认 + 防重（不可恢复）
    if (
      !window.confirm(
        `确定删除选中的 ${selectedIds.size} 条 FAQ？此操作不可恢复。`,
      )
    )
      return;
    setDeleting(true);
    try {
      await faqService.batchDelete(base, Array.from(selectedIds));
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      toastError(
        "批量删除失败: " + (err instanceof Error ? err.message : "未知错误"),
      );
    } finally {
      setDeleting(false);
    }
  }, [base, selectedIds, load, deleting]);

  const handleImport = useCallback(
    async (format: "csv" | "json", data: string): Promise<FAQImportReport> => {
      const report = await faqService.import(base, format, data);
      await load();
      return report;
    },
    [base, load],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  }, [selectedIds, entries]);

  return (
    <div className="flex h-full">
      {/* 左侧分类过滤 */}
      <div
        className={`w-40 shrink-0 p-3 border-r ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <FAQCategoryFilter
          categories={categories}
          selected={category}
          onSelect={setCategory}
          isDark={isDark}
        />
      </div>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div
          className={`flex items-center justify-between px-4 py-2.5 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center gap-2">
            <FAQSearchBar onSearch={setSearchQuery} isDark={isDark} />
            {searchQuery && (
              <span
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                {entries.length} 条结果
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                disabled={deleting}
                className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                  isDark
                    ? "text-red-400 hover:bg-red-500/10"
                    : "text-red-500 hover:bg-red-50"
                }`}
              >
                <Trash2 size={12} />
                {deleting ? "删除中..." : `删除 (${selectedIds.size})`}
              </button>
            )}
            <button
              onClick={() => setShowImport(true)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                isDark
                  ? "text-gray-300 hover:bg-gray-800 border border-gray-700"
                  : "text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <FileInput size={12} />
              导入
            </button>
            <button
              onClick={() => {
                setEditingEntry(undefined);
                setShowEditor(true);
              }}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={12} />
              新建
            </button>
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loadError && (
            <div
              className={`mb-2 flex items-center justify-between px-3 py-2 text-xs rounded-lg ${
                isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"
              }`}
            >
              <span>{loadError}</span>
              <button onClick={() => void load()} className="underline">
                重试
              </button>
            </div>
          )}
          {loading ? (
            <div
              className={`text-center py-12 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              加载中...
            </div>
          ) : (
            <FAQList
              entries={entries}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAll}
              onEdit={(e) => {
                setEditingEntry(e);
                setShowEditor(true);
              }}
              onDelete={handleDelete}
              isDark={isDark}
            />
          )}
        </div>
      </div>

      {/* 编辑器弹窗 */}
      {showEditor && (
        <FAQEditor
          isDark={isDark}
          entry={editingEntry}
          onSave={editingEntry ? handleUpdate : handleCreate}
          onClose={() => {
            setShowEditor(false);
            setEditingEntry(undefined);
          }}
        />
      )}

      {/* 导入弹窗 */}
      {showImport && (
        <FAQImportModal
          isDark={isDark}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
